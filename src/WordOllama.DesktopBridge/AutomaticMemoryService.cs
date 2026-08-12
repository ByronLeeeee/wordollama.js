using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using WordOllama.Contracts;
using WordOllama.Core;

namespace WordOllama.DesktopBridge;

public sealed partial class AutomaticMemoryService : BackgroundService
{
    private readonly ProviderSettingsStore _providers;
    private readonly ReviewSettingsStore _memories;
    private readonly ILogger<AutomaticMemoryService> _logger;
    private readonly Channel<string> _queue = Channel.CreateBounded<string>(
        new BoundedChannelOptions(64)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });

    public AutomaticMemoryService(
        ProviderSettingsStore providers,
        ReviewSettingsStore memories,
        ILogger<AutomaticMemoryService> logger)
    {
        _providers = providers;
        _memories = memories;
        _logger = logger;
    }

    public void Observe(ProviderChatRequest request)
    {
        var userText = request.Messages.LastOrDefault(message =>
            string.Equals(message.Role, "user", StringComparison.OrdinalIgnoreCase))?.Content;
        ObserveUserText(userText);
    }

    public void ObserveUserText(string? userText)
    {
        if (!_memories.Get().AutoMemory) return;
        foreach (var candidate in ExtractExplicitPreferenceCandidates(userText ?? string.Empty))
        {
            _queue.Writer.TryWrite(candidate);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (await _queue.Reader.WaitToReadAsync(stoppingToken))
        {
            var batch = new List<string>();
            if (_queue.Reader.TryRead(out var first)) batch.Add(first);
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            while (batch.Count < 12 && _queue.Reader.TryRead(out var item)) batch.Add(item);
            try
            {
                await ProcessBatchAsync(batch.Distinct(StringComparer.OrdinalIgnoreCase).ToArray(), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                _logger.LogDebug(exception, "Automatic memory extraction was skipped.");
            }
        }
    }

    private async Task ProcessBatchAsync(IReadOnlyList<string> candidates, CancellationToken cancellationToken)
    {
        var settings = _memories.Get();
        if (!settings.AutoMemory || candidates.Count == 0) return;
        var profileId = settings.MemoryProviderProfileId;
        ModelProviderOptions? options;
        try
        {
            options = string.IsNullOrWhiteSpace(profileId)
                ? _providers.GetActiveOptions()
                : _providers.GetOptions(profileId);
        }
        catch (KeyNotFoundException)
        {
            options = _providers.GetActiveOptions();
            profileId = string.Empty;
        }
        if (options is null) return;

        var provider = ModelProviderFactory.Create(options);
        var existing = JsonSerializer.Serialize(settings.Memories.Select(item => new
        {
            item.Id,
            item.Content,
        }));
        var input = JsonSerializer.Serialize(candidates);
        var prompt =
            "Judge explicit user-authored preference statements. Keep only durable preferences, recurring " +
            "workflows, or persistent user context. Never store document content, third-party facts, secrets, " +
            "credentials, one-off task instructions, or model claims. Return JSON only as " +
            "{\"operations\":[{\"action\":\"add|update|delete\",\"id\":\"existing id or empty\",\"content\":\"memory or empty\"}]}. " +
            "Prefer no operation when uncertain; update instead of duplicating; delete only for an explicit " +
            "contradiction.\nExisting memories:\n" + existing + "\nCandidate statements:\n" + input;
        var request = new ProviderChatRequest(
            [new ChatMessage("system", "You are a conservative user-memory extractor."),
             new ChatMessage("user", prompt)],
            Model: options.Model,
            Temperature: 0,
            MaxTokens: 1_200);
        var response = await provider.ChatAsync(
            _providers.ApplyDefaults(request, string.IsNullOrWhiteSpace(profileId) ? null : profileId),
            cancellationToken);
        var changes = ParseChanges(response.Content, settings.Memories);
        if (changes.Count > 0) _memories.ApplyMemoryChanges(changes);
    }

    public static IReadOnlyList<string> ExtractExplicitPreferenceCandidates(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 20_000) return [];
        return value.Split(new[] { '\r', '\n', '。', '！', '？', '.', '!', '?' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Trim())
            .Where(part => part.Length is >= 4 and <= 500)
            .Where(part => PreferencePattern().IsMatch(part) && !SecretPattern().IsMatch(part))
            .Take(8)
            .ToArray();
    }

    public static IReadOnlyList<MemoryChange> ParseChanges(string response, IReadOnlyList<MemoryItem> existing)
    {
        var json = response.Trim();
        if (json.StartsWith("```", StringComparison.Ordinal))
        {
            var firstLine = json.IndexOf('\n');
            var closing = json.LastIndexOf("```", StringComparison.Ordinal);
            if (firstLine >= 0 && closing > firstLine) json = json[(firstLine + 1)..closing].Trim();
        }
        using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
        if (!document.RootElement.TryGetProperty("operations", out var operations) ||
            operations.ValueKind != JsonValueKind.Array) return [];
        var ids = existing.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
        var contents = existing.Select(item => item.Content).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var result = new List<MemoryChange>();
        foreach (var operation in operations.EnumerateArray().Take(20))
        {
            if (operation.ValueKind != JsonValueKind.Object) continue;
            var action = ReadString(operation, "action").ToLowerInvariant();
            var id = ReadString(operation, "id");
            var content = ReadString(operation, "content").Trim();
            if (action == "add" && IsSafeMemory(content) && contents.Add(content))
                result.Add(new MemoryChange("add", Content: content));
            else if (action == "update" && ids.Contains(id) && IsSafeMemory(content))
                result.Add(new MemoryChange("update", id, content));
            else if (action == "delete" && ids.Contains(id))
                result.Add(new MemoryChange("delete", id));
        }
        return result;
    }

    private static bool IsSafeMemory(string content) =>
        content.Length is >= 4 and <= 500 && !SecretPattern().IsMatch(content) && !content.Contains('\n');

    private static string ReadString(JsonElement value, string name) =>
        value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString() ?? string.Empty
            : string.Empty;

    [GeneratedRegex("(?i)(我希望|我习惯|我的偏好|以后请|请始终|默认使用|请记住|i prefer|my preference|in future|always use|please remember)", RegexOptions.CultureInvariant)]
    private static partial Regex PreferencePattern();

    [GeneratedRegex("(?i)(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\\s*[:=]|bearer\\s+[a-z0-9._-]{12,}", RegexOptions.CultureInvariant)]
    private static partial Regex SecretPattern();
}
