using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using WordOllama.Contracts;

namespace WordOllama.Core;

/// <summary>
/// Deterministic cross-platform DOCX comparer. It aligns structural blocks before
/// classifying changes, then emits token-level edits for modified blocks. The result
/// remains approximate because Office.js cannot create Word's native Compare document.
/// </summary>
public sealed class OpenXmlDocumentComparer : IDocumentComparer
{
    private const int MaxDocumentBytes = 50 * 1024 * 1024;
    private const long MaxDocumentXmlCharacters = 64L * 1024 * 1024;
    private const long MaxLcsCells = 4_000_000;
    private const long MaxGapCells = 100_000;
    private const long MaxTokenLcsCells = 100_000;
    private static readonly XNamespace W =
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static readonly Regex TokenPattern = new(
        @"\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public async Task<DocumentCompareResponse> CompareAsync(
        Stream originalDocx,
        Stream revisedDocx,
        bool ignoreCase = false,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(originalDocx);
        ArgumentNullException.ThrowIfNull(revisedDocx);

        var original = await ReadBlocksAsync(originalDocx, cancellationToken);
        var revised = await ReadBlocksAsync(revisedDocx, cancellationToken);
        var matches = FindExactMatches(original, revised, ignoreCase, cancellationToken);
        var result = new ComparisonAccumulator();
        var originalCursor = 0;
        var revisedCursor = 0;

        foreach (var match in matches)
        {
            EmitGap(
                original,
                originalCursor,
                match.OriginalIndex - originalCursor,
                revised,
                revisedCursor,
                match.RevisedIndex - revisedCursor,
                ignoreCase,
                result,
                cancellationToken);
            result.Unchanged++;
            originalCursor = match.OriginalIndex + 1;
            revisedCursor = match.RevisedIndex + 1;
        }

        EmitGap(
            original,
            originalCursor,
            original.Count - originalCursor,
            revised,
            revisedCursor,
            revised.Count - revisedCursor,
            ignoreCase,
            result,
            cancellationToken);

        return new DocumentCompareResponse(
            original.Count,
            revised.Count,
            result.Changes,
            IsApproximate: true,
            new DocumentCompareSummary(
                result.Added,
                result.Removed,
                result.Modified,
                result.Unchanged,
                result.TableCellChanges,
                result.HeadingChanges),
            Algorithm: "structural-lcs-v2");
    }

    private static async Task<IReadOnlyList<DocumentBlock>> ReadBlocksAsync(
        Stream input,
        CancellationToken cancellationToken)
    {
        await using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        var total = 0;
        while (true)
        {
            var read = await input.ReadAsync(chunk.AsMemory(0, chunk.Length), cancellationToken);
            if (read == 0) break;
            total += read;
            if (total > MaxDocumentBytes)
            {
                throw new InvalidDataException("DOCX input exceeds the 50 MB comparison limit.");
            }
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }
        buffer.Position = 0;

        using var archive = new ZipArchive(buffer, ZipArchiveMode.Read, leaveOpen: false);
        var entry = archive.GetEntry("word/document.xml")
            ?? throw new InvalidDataException("DOCX does not contain word/document.xml.");
        if (entry.Length > MaxDocumentXmlCharacters)
        {
            throw new InvalidDataException("DOCX document.xml exceeds the 64 MB expanded XML limit.");
        }

        await using var entryStream = entry.Open();
        var settings = new XmlReaderSettings
        {
            Async = true,
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = MaxDocumentXmlCharacters,
        };
        using var reader = XmlReader.Create(entryStream, settings);
        var document = await XDocument.LoadAsync(reader, LoadOptions.None, cancellationToken);
        return ExtractBlocks(document);
    }

    private static IReadOnlyList<DocumentBlock> ExtractBlocks(XDocument document)
    {
        var body = document.Descendants(W + "body").FirstOrDefault()
            ?? throw new InvalidDataException("DOCX document.xml does not contain a Word body.");
        var tables = body.Descendants(W + "tbl").Select((element, index) => (element, index))
            .ToDictionary(item => item.element, item => item.index + 1);
        var blocks = new List<DocumentBlock>();

        foreach (var paragraph in body.Descendants(W + "p"))
        {
            var index = blocks.Count + 1;
            var style = paragraph.Element(W + "pPr")?.Element(W + "pStyle")?
                .Attribute(W + "val")?.Value;
            var cell = paragraph.Ancestors(W + "tc").FirstOrDefault();
            var row = paragraph.Ancestors(W + "tr").FirstOrDefault();
            var table = paragraph.Ancestors(W + "tbl").FirstOrDefault();
            var blockType = cell is null ? "paragraph" : "tableCell";
            string location;
            if (cell is not null && row is not null && table is not null)
            {
                var tableIndex = tables.TryGetValue(table, out var locatedTable) ? locatedTable : 1;
                var rowIndex = table.Elements(W + "tr").TakeWhile(item => item != row).Count() + 1;
                var cellIndex = row.Elements(W + "tc").TakeWhile(item => item != cell).Count() + 1;
                var cellParagraphIndex = cell.Descendants(W + "p").TakeWhile(item => item != paragraph).Count() + 1;
                location = $"table:{tableIndex}/row:{rowIndex}/cell:{cellIndex}/paragraph:{cellParagraphIndex}";
            }
            else
            {
                location = $"paragraph:{index}";
            }

            blocks.Add(new DocumentBlock(index, ReadParagraphText(paragraph), blockType, style, location));
        }

        return blocks;
    }

    private static string ReadParagraphText(XElement paragraph)
    {
        var text = new StringBuilder();
        foreach (var element in paragraph.Descendants())
        {
            if (element.Name == W + "t") text.Append(element.Value);
            else if (element.Name == W + "tab") text.Append('\t');
            else if (element.Name == W + "br" || element.Name == W + "cr") text.Append('\n');
            else if (element.Name == W + "noBreakHyphen") text.Append('\u2011');
        }
        return text.ToString();
    }

    private static IReadOnlyList<BlockMatch> FindExactMatches(
        IReadOnlyList<DocumentBlock> original,
        IReadOnlyList<DocumentBlock> revised,
        bool ignoreCase,
        CancellationToken cancellationToken)
    {
        if ((long)original.Count * revised.Count <= MaxLcsCells)
        {
            return FindLcsMatches(original, revised, ignoreCase, cancellationToken);
        }

        var matches = new List<BlockMatch>();
        var prefix = 0;
        while (prefix < original.Count && prefix < revised.Count &&
               KeysEqual(original[prefix], revised[prefix], ignoreCase))
        {
            matches.Add(new BlockMatch(prefix, prefix));
            prefix++;
        }

        var suffix = 0;
        while (suffix < original.Count - prefix && suffix < revised.Count - prefix &&
               KeysEqual(original[original.Count - suffix - 1], revised[revised.Count - suffix - 1], ignoreCase))
        {
            suffix++;
        }

        matches.AddRange(FindUniqueIncreasingMatches(
            original,
            prefix,
            original.Count - prefix - suffix,
            revised,
            prefix,
            revised.Count - prefix - suffix,
            ignoreCase,
            cancellationToken));
        for (var index = suffix; index > 0; index--)
        {
            matches.Add(new BlockMatch(original.Count - index, revised.Count - index));
        }
        return matches;
    }

    private static IReadOnlyList<BlockMatch> FindLcsMatches(
        IReadOnlyList<DocumentBlock> original,
        IReadOnlyList<DocumentBlock> revised,
        bool ignoreCase,
        CancellationToken cancellationToken)
    {
        var lengths = new int[original.Count + 1, revised.Count + 1];
        for (var left = original.Count - 1; left >= 0; left--)
        {
            cancellationToken.ThrowIfCancellationRequested();
            for (var right = revised.Count - 1; right >= 0; right--)
            {
                lengths[left, right] = KeysEqual(original[left], revised[right], ignoreCase)
                    ? lengths[left + 1, right + 1] + 1
                    : Math.Max(lengths[left + 1, right], lengths[left, right + 1]);
            }
        }

        var matches = new List<BlockMatch>();
        var originalIndex = 0;
        var revisedIndex = 0;
        while (originalIndex < original.Count && revisedIndex < revised.Count)
        {
            if (KeysEqual(original[originalIndex], revised[revisedIndex], ignoreCase))
            {
                matches.Add(new BlockMatch(originalIndex++, revisedIndex++));
            }
            else if (lengths[originalIndex + 1, revisedIndex] >= lengths[originalIndex, revisedIndex + 1])
            {
                originalIndex++;
            }
            else
            {
                revisedIndex++;
            }
        }
        return matches;
    }

    private static IReadOnlyList<BlockMatch> FindUniqueIncreasingMatches(
        IReadOnlyList<DocumentBlock> original,
        int originalStart,
        int originalCount,
        IReadOnlyList<DocumentBlock> revised,
        int revisedStart,
        int revisedCount,
        bool ignoreCase,
        CancellationToken cancellationToken)
    {
        var comparer = ignoreCase ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
        var originalPositions = new Dictionary<string, List<int>>(comparer);
        var revisedPositions = new Dictionary<string, List<int>>(comparer);
        AddPositions(original, originalStart, originalCount, originalPositions);
        AddPositions(revised, revisedStart, revisedCount, revisedPositions);
        var candidates = originalPositions
            .Where(item => item.Value.Count == 1 && item.Key.Length > 2 &&
                revisedPositions.TryGetValue(item.Key, out var positions) && positions.Count == 1)
            .Select(item => new BlockMatch(item.Value[0], revisedPositions[item.Key][0]))
            .OrderBy(item => item.OriginalIndex)
            .ToArray();
        if (candidates.Length == 0) return Array.Empty<BlockMatch>();

        var tails = new int[candidates.Length];
        var tailCandidate = new int[candidates.Length];
        var previous = Enumerable.Repeat(-1, candidates.Length).ToArray();
        var length = 0;
        for (var index = 0; index < candidates.Length; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var value = candidates[index].RevisedIndex;
            var low = 0;
            var high = length;
            while (low < high)
            {
                var middle = (low + high) / 2;
                if (tails[middle] < value) low = middle + 1;
                else high = middle;
            }
            tails[low] = value;
            previous[index] = low > 0 ? tailCandidate[low - 1] : -1;
            tailCandidate[low] = index;
            if (low == length) length++;
        }

        var result = new BlockMatch[length];
        var current = tailCandidate[length - 1];
        for (var index = length - 1; index >= 0; index--)
        {
            result[index] = candidates[current];
            current = previous[current];
        }
        return result;

        static void AddPositions(
            IReadOnlyList<DocumentBlock> blocks,
            int start,
            int count,
            IDictionary<string, List<int>> positions)
        {
            for (var index = start; index < start + count; index++)
            {
                var key = GetBlockKey(blocks[index]);
                if (!positions.TryGetValue(key, out var indexes))
                {
                    indexes = [];
                    positions[key] = indexes;
                }
                indexes.Add(index);
            }
        }
    }

    private static void EmitGap(
        IReadOnlyList<DocumentBlock> original,
        int originalStart,
        int originalCount,
        IReadOnlyList<DocumentBlock> revised,
        int revisedStart,
        int revisedCount,
        bool ignoreCase,
        ComparisonAccumulator result,
        CancellationToken cancellationToken)
    {
        if (originalCount == 0)
        {
            var anchor = originalStart > 0 ? original[originalStart - 1] : null;
            for (var index = 0; index < revisedCount; index++)
            {
                result.AddAdded(revised[revisedStart + index], anchor);
            }
            return;
        }
        if (revisedCount == 0)
        {
            for (var index = 0; index < originalCount; index++) result.AddRemoved(original[originalStart + index]);
            return;
        }
        if ((long)originalCount * revisedCount > MaxGapCells)
        {
            var paired = Math.Min(originalCount, revisedCount);
            for (var index = 0; index < paired; index++)
            {
                var anchor = originalStart + index > 0 ? original[originalStart + index - 1] : null;
                EmitPair(
                    original[originalStart + index],
                    revised[revisedStart + index],
                    ignoreCase,
                    result,
                    anchor);
            }
            for (var index = paired; index < originalCount; index++) result.AddRemoved(original[originalStart + index]);
            var additionAnchorIndex = originalStart + originalCount - 1;
            var additionAnchor = additionAnchorIndex >= 0 ? original[additionAnchorIndex] : null;
            for (var index = paired; index < revisedCount; index++)
            {
                result.AddAdded(revised[revisedStart + index], additionAnchor);
            }
            return;
        }

        var costs = new double[originalCount + 1, revisedCount + 1];
        for (var left = originalCount; left >= 0; left--)
        {
            cancellationToken.ThrowIfCancellationRequested();
            for (var right = revisedCount; right >= 0; right--)
            {
                if (left == originalCount) costs[left, right] = revisedCount - right;
                else if (right == revisedCount) costs[left, right] = originalCount - left;
                else
                {
                    var substitution = SubstitutionCost(
                        original[originalStart + left], revised[revisedStart + right], ignoreCase) +
                        costs[left + 1, right + 1];
                    costs[left, right] = Math.Min(substitution,
                        Math.Min(1 + costs[left + 1, right], 1 + costs[left, right + 1]));
                }
            }
        }

        var originalOffset = 0;
        var revisedOffset = 0;
        while (originalOffset < originalCount || revisedOffset < revisedCount)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (originalOffset == originalCount)
            {
                var anchorIndex = originalStart + originalOffset - 1;
                result.AddAdded(
                    revised[revisedStart + revisedOffset++],
                    anchorIndex >= 0 ? original[anchorIndex] : null);
                continue;
            }
            if (revisedOffset == revisedCount)
            {
                result.AddRemoved(original[originalStart + originalOffset++]);
                continue;
            }
            var left = original[originalStart + originalOffset];
            var right = revised[revisedStart + revisedOffset];
            var diagonal = SubstitutionCost(left, right, ignoreCase) + costs[originalOffset + 1, revisedOffset + 1];
            var removal = 1 + costs[originalOffset + 1, revisedOffset];
            var addition = 1 + costs[originalOffset, revisedOffset + 1];
            if (diagonal <= removal + 0.000001 && diagonal <= addition + 0.000001)
            {
                var anchorIndex = originalStart + originalOffset - 1;
                EmitPair(
                    left,
                    right,
                    ignoreCase,
                    result,
                    anchorIndex >= 0 ? original[anchorIndex] : null);
                originalOffset++;
                revisedOffset++;
            }
            else if (addition < removal)
            {
                var anchorIndex = originalStart + originalOffset - 1;
                result.AddAdded(right, anchorIndex >= 0 ? original[anchorIndex] : null);
                revisedOffset++;
            }
            else
            {
                result.AddRemoved(left);
                originalOffset++;
            }
        }
    }

    private static void EmitPair(
        DocumentBlock original,
        DocumentBlock revised,
        bool ignoreCase,
        ComparisonAccumulator result,
        DocumentBlock? insertionAnchor)
    {
        if (KeysEqual(original, revised, ignoreCase)) result.Unchanged++;
        else if (TextSimilarity(original.Text, revised.Text, ignoreCase) < 0.2)
        {
            result.AddRemoved(original);
            result.AddAdded(revised, insertionAnchor);
        }
        else result.AddModified(original, revised, CreateTextChanges(original.Text, revised.Text, ignoreCase));
    }

    private static double SubstitutionCost(DocumentBlock original, DocumentBlock revised, bool ignoreCase)
    {
        if (KeysEqual(original, revised, ignoreCase)) return 0;
        var similarity = TextSimilarity(original.Text, revised.Text, ignoreCase);
        return similarity < 0.2 ? 2.1 : 1.0 - (0.5 * similarity);
    }

    private static double TextSimilarity(string original, string revised, bool ignoreCase)
    {
        if (string.Equals(original, revised,
                ignoreCase ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal)) return 1;
        if (original.Length == 0 || revised.Length == 0) return 0;
        var left = ignoreCase ? original.ToUpperInvariant() : original;
        var right = ignoreCase ? revised.ToUpperInvariant() : revised;
        if (left.Length == 1 || right.Length == 1) return left[0] == right[0] ? 1 : 0;
        var leftPairs = Enumerable.Range(0, left.Length - 1)
            .Select(index => left.Substring(index, 2)).ToHashSet(StringComparer.Ordinal);
        var rightPairs = Enumerable.Range(0, right.Length - 1)
            .Select(index => right.Substring(index, 2)).ToHashSet(StringComparer.Ordinal);
        var intersection = leftPairs.Count(pair => rightPairs.Contains(pair));
        return (2.0 * intersection) / (leftPairs.Count + rightPairs.Count);
    }

    private static IReadOnlyList<DocumentTextDiff> CreateTextChanges(
        string original,
        string revised,
        bool ignoreCase)
    {
        var left = Tokenize(original);
        var right = Tokenize(revised);
        if ((long)left.Count * right.Count > MaxTokenLcsCells)
        {
            return CreateFocusedCharacterChange(original, revised, ignoreCase);
        }

        var comparer = ignoreCase ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
        var lengths = new int[left.Count + 1, right.Count + 1];
        for (var leftIndex = left.Count - 1; leftIndex >= 0; leftIndex--)
        {
            for (var rightIndex = right.Count - 1; rightIndex >= 0; rightIndex--)
            {
                lengths[leftIndex, rightIndex] = comparer.Equals(left[leftIndex].Text, right[rightIndex].Text)
                    ? lengths[leftIndex + 1, rightIndex + 1] + 1
                    : Math.Max(lengths[leftIndex + 1, rightIndex], lengths[leftIndex, rightIndex + 1]);
            }
        }

        var matches = new List<(int Left, int Right)>();
        var leftCursor = 0;
        var rightCursor = 0;
        while (leftCursor < left.Count && rightCursor < right.Count)
        {
            if (comparer.Equals(left[leftCursor].Text, right[rightCursor].Text))
            {
                matches.Add((leftCursor++, rightCursor++));
            }
            else if (lengths[leftCursor + 1, rightCursor] >= lengths[leftCursor, rightCursor + 1]) leftCursor++;
            else rightCursor++;
        }

        var changes = new List<DocumentTextDiff>();
        leftCursor = 0;
        rightCursor = 0;
        foreach (var match in matches)
        {
            AddTokenGap(left, leftCursor, match.Left - leftCursor, right, rightCursor, match.Right - rightCursor, original, revised, changes);
            leftCursor = match.Left + 1;
            rightCursor = match.Right + 1;
        }
        AddTokenGap(left, leftCursor, left.Count - leftCursor, right, rightCursor, right.Count - rightCursor, original, revised, changes);
        return changes;
    }

    private static IReadOnlyList<DocumentTextDiff> CreateFocusedCharacterChange(
        string original,
        string revised,
        bool ignoreCase)
    {
        var comparison = ignoreCase ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        var prefix = 0;
        while (prefix < original.Length && prefix < revised.Length &&
               original.AsSpan(prefix, 1).Equals(revised.AsSpan(prefix, 1), comparison)) prefix++;
        var suffix = 0;
        while (suffix < original.Length - prefix && suffix < revised.Length - prefix &&
               original.AsSpan(original.Length - suffix - 1, 1).Equals(revised.AsSpan(revised.Length - suffix - 1, 1), comparison)) suffix++;
        var originalLength = original.Length - prefix - suffix;
        var revisedLength = revised.Length - prefix - suffix;
        return
        [
            new DocumentTextDiff(
                originalLength == 0 ? "added" : revisedLength == 0 ? "removed" : "modified",
                prefix,
                originalLength,
                prefix,
                revisedLength,
                originalLength == 0 ? null : original.Substring(prefix, originalLength),
                revisedLength == 0 ? null : revised.Substring(prefix, revisedLength))
        ];
    }

    private static void AddTokenGap(
        IReadOnlyList<TextToken> originalTokens,
        int originalStart,
        int originalCount,
        IReadOnlyList<TextToken> revisedTokens,
        int revisedStart,
        int revisedCount,
        string original,
        string revised,
        ICollection<DocumentTextDiff> changes)
    {
        if (originalCount == 0 && revisedCount == 0) return;
        var originalCharacterStart = originalStart < originalTokens.Count
            ? originalTokens[originalStart].Start : original.Length;
        var originalCharacterEnd = originalCount == 0
            ? originalCharacterStart
            : originalTokens[originalStart + originalCount - 1].End;
        var revisedCharacterStart = revisedStart < revisedTokens.Count
            ? revisedTokens[revisedStart].Start : revised.Length;
        var revisedCharacterEnd = revisedCount == 0
            ? revisedCharacterStart
            : revisedTokens[revisedStart + revisedCount - 1].End;
        var originalLength = originalCharacterEnd - originalCharacterStart;
        var revisedLength = revisedCharacterEnd - revisedCharacterStart;
        changes.Add(new DocumentTextDiff(
            originalLength == 0 ? "added" : revisedLength == 0 ? "removed" : "modified",
            originalCharacterStart,
            originalLength,
            revisedCharacterStart,
            revisedLength,
            originalLength == 0 ? null : original.Substring(originalCharacterStart, originalLength),
            revisedLength == 0 ? null : revised.Substring(revisedCharacterStart, revisedLength)));
    }

    private static IReadOnlyList<TextToken> Tokenize(string text) => TokenPattern.Matches(text)
        .Select(match => new TextToken(match.Value, match.Index, match.Length))
        .ToArray();

    private static bool KeysEqual(DocumentBlock original, DocumentBlock revised, bool ignoreCase) =>
        string.Equals(GetBlockKey(original), GetBlockKey(revised),
            ignoreCase ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    private static string GetBlockKey(DocumentBlock block) =>
        $"{block.BlockType}\u001f{block.Style}\u001f{block.Text}";

    private static bool IsHeading(string? style) =>
        !string.IsNullOrWhiteSpace(style) &&
        (style.StartsWith("Heading", StringComparison.OrdinalIgnoreCase) ||
         style.StartsWith("标题", StringComparison.Ordinal));

    private sealed record DocumentBlock(int Index, string Text, string BlockType, string? Style, string Location);
    private sealed record BlockMatch(int OriginalIndex, int RevisedIndex);
    private sealed record TextToken(string Text, int Start, int Length)
    {
        public int End => Start + Length;
    }

    private sealed class ComparisonAccumulator
    {
        public List<DocumentDiff> Changes { get; } = [];
        public int Added { get; private set; }
        public int Removed { get; private set; }
        public int Modified { get; private set; }
        public int Unchanged { get; set; }
        public int TableCellChanges { get; private set; }
        public int HeadingChanges { get; private set; }

        public void AddAdded(DocumentBlock revised, DocumentBlock? insertionAnchor)
        {
            Added++;
            CountStructure(revised);
            Changes.Add(new DocumentDiff(
                "added", revised.Index, null, revised.Text,
                RevisedParagraphIndex: revised.Index,
                BlockType: revised.BlockType,
                Style: revised.Style,
                Location: revised.Location,
                RevisedStyle: revised.Style,
                RevisedLocation: revised.Location,
                InsertAfterOriginalParagraphIndex: insertionAnchor?.Index ?? 0,
                InsertAfterOriginalText: insertionAnchor?.Text,
                InsertAfterOriginalBlockType: insertionAnchor?.BlockType));
        }

        public void AddRemoved(DocumentBlock original)
        {
            Removed++;
            CountStructure(original);
            Changes.Add(new DocumentDiff(
                "removed", original.Index, original.Text, null,
                OriginalParagraphIndex: original.Index,
                BlockType: original.BlockType,
                Style: original.Style,
                Location: original.Location,
                OriginalStyle: original.Style,
                OriginalLocation: original.Location));
        }

        public void AddModified(
            DocumentBlock original,
            DocumentBlock revised,
            IReadOnlyList<DocumentTextDiff> textChanges)
        {
            Modified++;
            if (original.BlockType == "tableCell" || revised.BlockType == "tableCell") TableCellChanges++;
            if (IsHeading(original.Style) || IsHeading(revised.Style)) HeadingChanges++;
            Changes.Add(new DocumentDiff(
                "modified", revised.Index, original.Text, revised.Text,
                OriginalParagraphIndex: original.Index,
                RevisedParagraphIndex: revised.Index,
                BlockType: revised.BlockType == "tableCell" || original.BlockType == "tableCell" ? "tableCell" : "paragraph",
                Style: revised.Style ?? original.Style,
                Location: revised.Location,
                TextChanges: textChanges,
                OriginalStyle: original.Style,
                RevisedStyle: revised.Style,
                OriginalLocation: original.Location,
                RevisedLocation: revised.Location));
        }

        private void CountStructure(DocumentBlock block)
        {
            if (block.BlockType == "tableCell") TableCellChanges++;
            if (IsHeading(block.Style)) HeadingChanges++;
        }
    }
}
