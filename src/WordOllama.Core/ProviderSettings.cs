using System.Text.Json;
using System.Text.RegularExpressions;
using WordOllama.Contracts;

namespace WordOllama.Core;

public sealed record ProviderProfileSettings(
    string Id,
    string Name,
    string Type,
    string Endpoint,
    string Model,
    string ToolCallingMode = "Auto",
    bool SupportsStreaming = true,
    bool SupportsVision = false,
    bool SupportsJsonOutput = false,
    int ContextWindow = 0,
    double Temperature = 0.5,
    int MaxTokens = 4096,
    string KeepAlive = "5m");

public sealed record ProviderProfileView(
    string Id,
    string Name,
    string Type,
    string Endpoint,
    string Model,
    string ToolCallingMode,
    bool SupportsStreaming,
    bool SupportsVision,
    bool SupportsJsonOutput,
    int ContextWindow,
    bool HasApiKey,
    double Temperature,
    int MaxTokens,
    string KeepAlive);

public sealed record ProviderSettingsView(
    string ActiveProviderId,
    IReadOnlyList<ProviderProfileView> Profiles);

public sealed record ProviderProfileUpdate(
    string Id,
    string Name,
    string Type,
    string Endpoint,
    string Model,
    string? ApiKey = null,
    bool ClearApiKey = false,
    string ToolCallingMode = "Auto",
    bool SupportsStreaming = true,
    bool SupportsVision = false,
    bool SupportsJsonOutput = false,
    int ContextWindow = 0,
    double Temperature = 0.5,
    int MaxTokens = 4096,
    string KeepAlive = "5m");

internal sealed record ProviderSettingsDocument(
    string ActiveProviderId,
    List<ProviderProfileSettings> Profiles,
    int SchemaVersion = 0);

public sealed partial class ProviderSettingsStore
{
    private const int CurrentSchemaVersion = 1;
    private readonly string _path;
    private readonly IMutableSecretStore _secrets;
    private readonly object _gate = new();
    private ProviderSettingsDocument _document;

    public ProviderSettingsStore(
        string path,
        ModelProviderOptions initialProvider,
        IMutableSecretStore secrets)
    {
        _path = Path.GetFullPath(path);
        _secrets = secrets;
        if (!string.IsNullOrEmpty(initialProvider.ApiKey) &&
            string.IsNullOrEmpty(_secrets.Get(SecretName("default"))))
        {
            _secrets.Set(SecretName("default"), initialProvider.ApiKey);
        }
        var loaded = LoadOrCreate(initialProvider);
        _document = loaded.Document;
        if (loaded.WasMigrated) Save();
    }

    public ProviderSettingsView GetView()
    {
        lock (_gate)
        {
            return new ProviderSettingsView(
                _document.ActiveProviderId,
                _document.Profiles.Select(ToView).ToArray());
        }
    }

    public ModelProviderOptions GetActiveOptions()
    {
        lock (_gate)
        {
            var profile = _document.Profiles.First(profile =>
                string.Equals(profile.Id, _document.ActiveProviderId, StringComparison.OrdinalIgnoreCase));
            return ToOptions(profile);
        }
    }

    public ProviderProfileView GetActiveProfile()
    {
        lock (_gate)
        {
            return ToView(GetActiveProfileUnsafe());
        }
    }

    public ProviderChatRequest ApplyDefaults(ProviderChatRequest request)
    {
        lock (_gate)
        {
            var profile = GetActiveProfileUnsafe();
            return request with
            {
                Temperature = request.Temperature ?? profile.Temperature,
                MaxTokens = request.MaxTokens ?? profile.MaxTokens,
                ContextWindow = request.ContextWindow ?? (profile.ContextWindow > 0 ? profile.ContextWindow : null),
                KeepAlive = request.KeepAlive ?? profile.KeepAlive,
            };
        }
    }

    public AgentStartRequest ApplyDefaults(AgentStartRequest request)
    {
        lock (_gate)
        {
            var profile = GetActiveProfileUnsafe();
            return request with
            {
                Temperature = request.Temperature ?? profile.Temperature,
                MaxTokens = request.MaxTokens ?? profile.MaxTokens,
                ContextWindow = request.ContextWindow ?? (profile.ContextWindow > 0 ? profile.ContextWindow : null),
                KeepAlive = request.KeepAlive ?? profile.KeepAlive,
            };
        }
    }

    public ProviderSettingsView Upsert(ProviderProfileUpdate update)
    {
        var profile = Validate(update);
        lock (_gate)
        {
            var index = _document.Profiles.FindIndex(candidate =>
                string.Equals(candidate.Id, profile.Id, StringComparison.OrdinalIgnoreCase));
            if (index >= 0) _document.Profiles[index] = profile;
            else _document.Profiles.Add(profile);
            if (!string.IsNullOrEmpty(update.ApiKey)) _secrets.Set(SecretName(profile.Id), update.ApiKey);
            else if (update.ClearApiKey) _secrets.Delete(SecretName(profile.Id));
            Save();
            return GetViewUnsafe();
        }
    }

    public ProviderSettingsView Activate(string id)
    {
        lock (_gate)
        {
            if (!_document.Profiles.Any(profile => string.Equals(profile.Id, id, StringComparison.OrdinalIgnoreCase)))
            {
                throw new KeyNotFoundException($"Provider profile was not found: {id}");
            }
            _document = _document with { ActiveProviderId = id };
            Save();
            return GetViewUnsafe();
        }
    }

    public ProviderSettingsView Delete(string id)
    {
        lock (_gate)
        {
            if (_document.Profiles.Count == 1)
            {
                throw new InvalidOperationException("At least one provider profile is required.");
            }
            var removed = _document.Profiles.RemoveAll(profile =>
                string.Equals(profile.Id, id, StringComparison.OrdinalIgnoreCase));
            if (removed == 0) throw new KeyNotFoundException($"Provider profile was not found: {id}");
            _secrets.Delete(SecretName(id));
            if (string.Equals(_document.ActiveProviderId, id, StringComparison.OrdinalIgnoreCase))
            {
                _document = _document with { ActiveProviderId = _document.Profiles[0].Id };
            }
            Save();
            return GetViewUnsafe();
        }
    }

    public ProviderSettingsView SetGoogleOAuthCredential(
        string id,
        GoogleOAuthCredential credential)
    {
        lock (_gate)
        {
            var profile = _document.Profiles.FirstOrDefault(candidate =>
                string.Equals(candidate.Id, id, StringComparison.OrdinalIgnoreCase))
                ?? throw new KeyNotFoundException($"Provider profile was not found: {id}");
            if (profile.Type.Trim().ToLowerInvariant() is not ("gemini" or "google"))
            {
                throw new ArgumentException("Google OAuth is available only for Gemini providers.");
            }
            _secrets.Set(SecretName(profile.Id), GoogleOAuthCredentialCodec.Encode(credential));
            return GetViewUnsafe();
        }
    }

    public ModelProviderOptions GetOptions(string id)
    {
        lock (_gate)
        {
            var profile = _document.Profiles.FirstOrDefault(candidate =>
                string.Equals(candidate.Id, id, StringComparison.OrdinalIgnoreCase))
                ?? throw new KeyNotFoundException($"Provider profile was not found: {id}");
            return ToOptions(profile);
        }
    }

    public ModelProviderOptions BuildOptionsForModelFetch(ProviderProfileUpdate update)
    {
        var profile = Validate(update, allowEmptyModel: true);
        var apiKey = !string.IsNullOrEmpty(update.ApiKey)
            ? update.ApiKey
            : _secrets.Get(SecretName(profile.Id)) ?? string.Empty;
        return new ModelProviderOptions(profile.Type, profile.Endpoint, apiKey, profile.Model);
    }

    private (ProviderSettingsDocument Document, bool WasMigrated) LoadOrCreate(
        ModelProviderOptions initial)
    {
        if (File.Exists(_path))
        {
            try
            {
                var loaded = JsonSerializer.Deserialize<ProviderSettingsDocument>(
                    File.ReadAllText(_path),
                    JsonOptions);
                if (loaded is { Profiles.Count: > 0 } &&
                    loaded.Profiles.Any(profile =>
                        string.Equals(profile.Id, loaded.ActiveProviderId, StringComparison.OrdinalIgnoreCase)))
                {
                    var validated = loaded.Profiles.Select(profile => Validate(new ProviderProfileUpdate(
                        profile.Id, profile.Name, profile.Type, profile.Endpoint, profile.Model,
                        ToolCallingMode: profile.ToolCallingMode,
                        SupportsStreaming: profile.SupportsStreaming,
                        SupportsVision: profile.SupportsVision,
                        SupportsJsonOutput: profile.SupportsJsonOutput,
                        ContextWindow: profile.ContextWindow,
                        Temperature: profile.Temperature,
                        MaxTokens: profile.MaxTokens <= 0 ? 4096 : profile.MaxTokens,
                        KeepAlive: string.IsNullOrWhiteSpace(profile.KeepAlive) ? "5m" : profile.KeepAlive),
                        allowEmptyModel: true)).ToList();
                    var wasMigrated = loaded.SchemaVersion < CurrentSchemaVersion;
                    if (wasMigrated)
                    {
                        validated = validated
                            .Select(profile => IsLegacyGeneratedDefault(profile)
                                ? profile with { Model = string.Empty }
                                : profile)
                            .ToList();
                    }
                    return (
                        new ProviderSettingsDocument(
                            loaded.ActiveProviderId,
                            validated,
                            CurrentSchemaVersion),
                        wasMigrated);
                }
                throw new InvalidDataException("Provider settings must contain an active profile.");
            }
            catch (JsonException exception)
            {
                throw new InvalidDataException("Provider settings JSON is invalid.", exception);
            }
        }
        var profile = new ProviderProfileSettings(
            "default", initial.Type, initial.Type, initial.Endpoint, initial.Model);
        return (
            new ProviderSettingsDocument(profile.Id, [profile], CurrentSchemaVersion),
            false);
    }

    private ModelProviderOptions ToOptions(ProviderProfileSettings profile) =>
        new(profile.Type, profile.Endpoint, _secrets.Get(SecretName(profile.Id)) ?? string.Empty, profile.Model);

    private ProviderProfileView ToView(ProviderProfileSettings profile) =>
        new(
            profile.Id, profile.Name, profile.Type, profile.Endpoint, profile.Model,
            profile.ToolCallingMode, profile.SupportsStreaming, profile.SupportsVision,
            profile.SupportsJsonOutput, profile.ContextWindow,
            !string.IsNullOrEmpty(_secrets.Get(SecretName(profile.Id))),
            profile.Temperature, profile.MaxTokens, profile.KeepAlive);

    private ProviderSettingsView GetViewUnsafe() =>
        new(_document.ActiveProviderId, _document.Profiles.Select(ToView).ToArray());

    private ProviderProfileSettings GetActiveProfileUnsafe() =>
        _document.Profiles.First(profile =>
            string.Equals(profile.Id, _document.ActiveProviderId, StringComparison.OrdinalIgnoreCase));

    private void Save()
    {
        var directory = Path.GetDirectoryName(_path)
            ?? throw new InvalidOperationException("Provider settings path has no parent directory.");
        Directory.CreateDirectory(directory);
        var temporary = _path + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(_document, JsonOptions));
        File.Move(temporary, _path, overwrite: true);
    }

    private static bool IsLegacyGeneratedDefault(ProviderProfileSettings profile) =>
        string.Equals(profile.Id, "default", StringComparison.OrdinalIgnoreCase) &&
        string.Equals(profile.Name, "Ollama", StringComparison.OrdinalIgnoreCase) &&
        string.Equals(profile.Type, "Ollama", StringComparison.OrdinalIgnoreCase) &&
        string.Equals(profile.Model, "llama3.2", StringComparison.OrdinalIgnoreCase) &&
        string.Equals(
            profile.Endpoint.TrimEnd('/'),
            "http://127.0.0.1:11434",
            StringComparison.OrdinalIgnoreCase);

    private static ProviderProfileSettings Validate(
        ProviderProfileUpdate update,
        bool allowEmptyModel = false)
    {
        var id = update.Id.Trim();
        if (!ProfileIdPattern().IsMatch(id)) throw new ArgumentException("Provider id must contain only letters, digits, '_' or '-'.");
        if (string.IsNullOrWhiteSpace(update.Name)) throw new ArgumentException("Provider name is required.");
        if (string.IsNullOrWhiteSpace(update.Type)) throw new ArgumentException("Provider type is required.");
        if (!SupportedProviderTypes.Contains(update.Type.Trim()))
        {
            throw new ArgumentException($"Unsupported model provider: {update.Type}");
        }
        if (!allowEmptyModel && string.IsNullOrWhiteSpace(update.Model))
        {
            throw new ArgumentException("Provider model is required.");
        }
        if (!Uri.TryCreate(update.Endpoint, UriKind.Absolute, out var endpoint) ||
            (endpoint.Scheme != Uri.UriSchemeHttps &&
             !(endpoint.Scheme == Uri.UriSchemeHttp && endpoint.Host is "127.0.0.1" or "localhost" or "::1")))
        {
            throw new ArgumentException("Provider endpoint must use HTTPS; loopback HTTP is allowed.");
        }
        if (update.ContextWindow is < 0 or > 10_000_000) throw new ArgumentException("Context window is out of range.");
        if (update.Temperature is < 0 or > 2 || double.IsNaN(update.Temperature))
        {
            throw new ArgumentException("Temperature must be between 0 and 2.");
        }
        if (update.MaxTokens is < 1 or > 1_000_000)
        {
            throw new ArgumentException("Max tokens must be between 1 and 1000000.");
        }
        var keepAlive = (update.KeepAlive ?? "5m").Trim();
        if (!KeepAlivePattern().IsMatch(keepAlive))
        {
            throw new ArgumentException("Keep-alive must be -1, 0, or a duration such as 5m or 24h.");
        }
        return new ProviderProfileSettings(
            id, update.Name.Trim(), update.Type.Trim(), endpoint.ToString().TrimEnd('/'),
            update.Model.Trim(), update.ToolCallingMode.Trim(), update.SupportsStreaming,
            update.SupportsVision, update.SupportsJsonOutput, update.ContextWindow,
            update.Temperature, update.MaxTokens, keepAlive);
    }

    private static string SecretName(string id) =>
        "WORDOLLAMA_PROVIDER_" + id.ToUpperInvariant() + "_API_KEY";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };
    private static readonly HashSet<string> SupportedProviderTypes = new(
        ["ollama", "openai", "lmstudio", "vllm", "claude", "anthropic", "gemini", "google"],
        StringComparer.OrdinalIgnoreCase);

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex ProfileIdPattern();

    [GeneratedRegex("^(?:-1|0|[1-9][0-9]*(?:ms|s|m|h)?)$", RegexOptions.CultureInvariant)]
    private static partial Regex KeepAlivePattern();
}

public sealed class ReloadableModelProvider : IModelProvider
{
    private IModelProvider _current;

    public ReloadableModelProvider(ModelProviderOptions options)
    {
        _current = ModelProviderFactory.Create(options);
    }

    public string ProviderType => Volatile.Read(ref _current).ProviderType;

    public void Reload(ModelProviderOptions options) =>
        Interlocked.Exchange(ref _current, ModelProviderFactory.Create(options));

    public Task<ProviderChatResponse> ChatAsync(
        ProviderChatRequest request,
        CancellationToken cancellationToken = default) =>
        Volatile.Read(ref _current).ChatAsync(request, cancellationToken);

    public Task<IReadOnlyList<string>> FetchModelsAsync(
        CancellationToken cancellationToken = default) =>
        Volatile.Read(ref _current).FetchModelsAsync(cancellationToken);

    public IAsyncEnumerable<ProviderChatChunk> ChatStreamAsync(
        ProviderChatRequest request,
        CancellationToken cancellationToken = default) =>
        Volatile.Read(ref _current).ChatStreamAsync(request, cancellationToken);
}
