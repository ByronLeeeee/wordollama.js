using System.Text.Json;

namespace WordOllama.Core;

public sealed record ReviewSettingsView(string WritingProfile);
public sealed record ReviewSettingsUpdate(string WritingProfile);

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
        var profile = update.WritingProfile?.Trim() ?? string.Empty;
        if (profile.Length > 20_000) throw new ArgumentException("Writing profile exceeds 20000 characters.");
        lock (_gate)
        {
            _settings = new ReviewSettingsView(profile);
            var directory = Path.GetDirectoryName(_path)
                ?? throw new InvalidOperationException("Review settings path has no parent directory.");
            Directory.CreateDirectory(directory);
            var temporary = _path + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(_settings, JsonOptions));
            File.Move(temporary, _path, overwrite: true);
            return _settings;
        }
    }

    private ReviewSettingsView Load()
    {
        if (!File.Exists(_path)) return new ReviewSettingsView(string.Empty);
        try
        {
            var settings = JsonSerializer.Deserialize<ReviewSettingsView>(
                File.ReadAllText(_path),
                JsonOptions) ?? new ReviewSettingsView(string.Empty);
            if (settings.WritingProfile.Length > 20_000)
            {
                throw new InvalidDataException("Writing profile exceeds 20000 characters.");
            }
            return settings;
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("Review settings JSON is invalid.", exception);
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };
}
