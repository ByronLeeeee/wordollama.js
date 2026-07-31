using System.Text.Json;

namespace WordOllama.Core;

public sealed record MemoryItem(
    string Id,
    string Content,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record ReviewSettingsView(
    IReadOnlyList<MemoryItem> Memories,
    string OutputPreference,
    bool AutoMemory)
{
    public string WritingProfile =>
        string.Join(
            "\n\n",
            new[]
            {
                Memories.Count == 0
                    ? string.Empty
                    : "Memories:\n" + string.Join("\n", Memories.Select(item => $"- {item.Content}")),
                string.IsNullOrWhiteSpace(OutputPreference)
                    ? string.Empty
                    : "Output preferences:\n" + OutputPreference,
            }.Where(value => !string.IsNullOrWhiteSpace(value)));
}

public sealed record ReviewSettingsUpdate(string OutputPreference, bool AutoMemory);
public sealed record MemoryUpdate(string Content);
public sealed record MemoryDeleteRequest(IReadOnlyList<string> Ids);

public sealed class ReviewSettingsStore
{
    private readonly string _path;
    private readonly object _gate = new();
    private ReviewSettingsView _settings;

    public ReviewSettingsStore(string path)
    {
        _path = Path.GetFullPath(path);
        _settings = Load();
    }

    public ReviewSettingsView Get()
    {
        lock (_gate) return _settings;
    }

    public ReviewSettingsView Save(ReviewSettingsUpdate update)
    {
        var outputPreference = Normalize(update.OutputPreference, 20_000, "Output preference");
        lock (_gate)
        {
            _settings = _settings with
            {
                OutputPreference = outputPreference,
                AutoMemory = update.AutoMemory,
            };
            Persist();
            return _settings;
        }
    }

    public ReviewSettingsView AddMemory(MemoryUpdate update)
    {
        var content = Normalize(update.Content, 2_000, "Memory");
        if (content.Length == 0) throw new ArgumentException("Memory cannot be empty.");
        lock (_gate)
        {
            if (_settings.Memories.Any(item =>
                    string.Equals(item.Content, content, StringComparison.OrdinalIgnoreCase)))
            {
                return _settings;
            }
            var now = DateTimeOffset.UtcNow;
            _settings = _settings with
            {
                Memories = [.. _settings.Memories, new MemoryItem(
                    Guid.NewGuid().ToString("N"),
                    content,
                    now,
                    now)],
            };
            Persist();
            return _settings;
        }
    }

    public ReviewSettingsView UpdateMemory(string id, MemoryUpdate update)
    {
        var content = Normalize(update.Content, 2_000, "Memory");
        if (content.Length == 0) throw new ArgumentException("Memory cannot be empty.");
        lock (_gate)
        {
            var found = false;
            var memories = _settings.Memories.Select(item =>
            {
                if (!string.Equals(item.Id, id, StringComparison.Ordinal)) return item;
                found = true;
                return item with { Content = content, UpdatedAt = DateTimeOffset.UtcNow };
            }).ToArray();
            if (!found) throw new KeyNotFoundException("Memory was not found.");
            _settings = _settings with { Memories = memories };
            Persist();
            return _settings;
        }
    }

    public ReviewSettingsView DeleteMemories(IEnumerable<string> ids)
    {
        var selected = ids
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.Ordinal);
        lock (_gate)
        {
            _settings = _settings with
            {
                Memories = _settings.Memories.Where(item => !selected.Contains(item.Id)).ToArray(),
            };
            Persist();
            return _settings;
        }
    }

    private static string Normalize(string? value, int maximumLength, string label)
    {
        var normalized = value?.Trim() ?? string.Empty;
        if (normalized.Length > maximumLength)
        {
            throw new ArgumentException($"{label} exceeds {maximumLength} characters.");
        }
        return normalized;
    }

    private void Persist()
    {
        var directory = Path.GetDirectoryName(_path)
            ?? throw new InvalidOperationException("Review settings path has no parent directory.");
        Directory.CreateDirectory(directory);
        var temporary = _path + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(_settings, JsonOptions));
        File.Move(temporary, _path, overwrite: true);
    }

    private ReviewSettingsView Load()
    {
        if (!File.Exists(_path)) return Empty();
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(_path));
            var root = document.RootElement;
            var outputPreference = root.TryGetProperty("outputPreference", out var output)
                ? output.GetString() ?? string.Empty
                : root.TryGetProperty("writingProfile", out var legacy)
                    ? legacy.GetString() ?? string.Empty
                    : string.Empty;
            var autoMemory = root.TryGetProperty("autoMemory", out var automatic) &&
                             automatic.ValueKind == JsonValueKind.True;
            var memories = root.TryGetProperty("memories", out var storedMemories) &&
                           storedMemories.ValueKind == JsonValueKind.Array
                ? storedMemories.Deserialize<MemoryItem[]>(JsonOptions) ?? []
                : [];
            return new ReviewSettingsView(
                memories
                    .Where(item => !string.IsNullOrWhiteSpace(item.Content))
                    .Take(500)
                    .ToArray(),
                Normalize(outputPreference, 20_000, "Output preference"),
                autoMemory);
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("Review settings JSON is invalid.", exception);
        }
    }

    private static ReviewSettingsView Empty() => new([], string.Empty, false);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };
}
