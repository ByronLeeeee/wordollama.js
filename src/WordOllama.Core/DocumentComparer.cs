using System.IO.Compression;
using System.Xml.Linq;
using WordOllama.Contracts;

namespace WordOllama.Core;

public interface IDocumentComparer
{
    Task<DocumentCompareResponse> CompareAsync(
        Stream originalDocx,
        Stream revisedDocx,
        bool ignoreCase = false,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Retained baseline implementation used to document the v1 index-by-index behavior.
/// The production registration uses <see cref="OpenXmlDocumentComparer"/>.
/// </summary>
internal sealed class LegacyParagraphDocumentComparer : IDocumentComparer
{
    private const int MaxDocumentBytes = 50 * 1024 * 1024;
    private static readonly XNamespace WordNamespace =
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    public async Task<DocumentCompareResponse> CompareAsync(
        Stream originalDocx,
        Stream revisedDocx,
        bool ignoreCase = false,
        CancellationToken cancellationToken = default)
    {
        var original = await ReadParagraphsAsync(originalDocx, cancellationToken);
        var revised = await ReadParagraphsAsync(revisedDocx, cancellationToken);
        var changes = new List<DocumentDiff>();
        var comparison = ignoreCase
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;
        var count = Math.Max(original.Count, revised.Count);
        for (var index = 0; index < count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var left = index < original.Count ? original[index] : null;
            var right = index < revised.Count ? revised[index] : null;
            if (left is null)
            {
                changes.Add(new DocumentDiff("added", index + 1, null, right));
            }
            else if (right is null)
            {
                changes.Add(new DocumentDiff("removed", index + 1, left, null));
            }
            else if (!string.Equals(left, right, comparison))
            {
                changes.Add(new DocumentDiff("modified", index + 1, left, right));
            }
        }

        return new DocumentCompareResponse(
            original.Count,
            revised.Count,
            changes,
            IsApproximate: true,
            Summary: null,
            Algorithm: "paragraph-index-v1");
    }

    private static async Task<IReadOnlyList<string>> ReadParagraphsAsync(
        Stream input,
        CancellationToken cancellationToken)
    {
        if (input.CanSeek && input.Length > MaxDocumentBytes)
        {
            throw new InvalidDataException("DOCX input exceeds the 50 MB comparison limit.");
        }

        await using var buffer = new MemoryStream();
        await input.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length > MaxDocumentBytes)
        {
            throw new InvalidDataException("DOCX input exceeds the 50 MB comparison limit.");
        }
        buffer.Position = 0;

        using var archive = new ZipArchive(buffer, ZipArchiveMode.Read, leaveOpen: false);
        var entry = archive.GetEntry("word/document.xml")
            ?? throw new InvalidDataException("DOCX does not contain word/document.xml.");
        await using var entryStream = entry.Open();
        var document = await XDocument.LoadAsync(entryStream, LoadOptions.None, cancellationToken);
        return document.Descendants(WordNamespace + "p")
            .Select(paragraph => string.Concat(
                paragraph.Descendants(WordNamespace + "t").Select(text => text.Value)))
            .ToArray();
    }
}
