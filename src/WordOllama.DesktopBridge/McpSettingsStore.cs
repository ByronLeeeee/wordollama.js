using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using WordOllama.Contracts;
using WordOllama.Core;
using WordOllama.Mcp;

namespace WordOllama.DesktopBridge;

public sealed record McpServerUpdate(
    string Name,
    string Transport,
    string Command,
    IReadOnlyList<string>? Arguments = null,
    string? WorkingDirectory = null,
    IReadOnlyDictionary<string, string>? Environment = null,
    IReadOnlyDictionary<string, string>? Headers = null,
    bool Enabled = true,
    bool Trusted = false);

public sealed record McpServerView(
    string Name,
    string Transport,
    string Command,
    IReadOnlyList<string> Arguments,
    string? WorkingDirectory,
    IReadOnlyList<string> EnvironmentKeys,
    IReadOnlyList<string> HeaderKeys,
    bool Enabled,
    bool Trusted,
    IReadOnlyDictionary<string, bool> ToolPermissions,
    bool Connected,
    int ToolCount,
    string? LastError,
    DateTimeOffset? LastConnectedAt,
    long? LastCheckDurationMs);

internal sealed record McpServerSettings(
    string Name,
    string Transport,
    string Command,
    List<string> Arguments,
    string? WorkingDirectory,
    List<string> EnvironmentKeys,
    List<string> HeaderKeys,
    bool Enabled,
    bool Trusted,
    Dictionary<string, bool> ToolPermissions);

public sealed partial class McpSettingsStore
{
    private readonly string _path;
    private readonly IMutableSecretStore _secrets;
    private readonly object _gate = new();
    private List<McpServerSettings> _servers;

    public McpSettingsStore(string path, IMutableSecretStore secrets)
    {
        _path = Path.GetFullPath(path);
        _secrets = secrets;
        _servers = Load();
    }

    internal IReadOnlyList<McpServerSettings> GetEnabledSettings()
    {
        lock (_gate) return _servers.Where(server => server.Enabled).Select(Clone).ToArray();
    }

    public IReadOnlyList<McpServerView> GetViews(McpManager manager)
    {
        var states = manager.GetServerStates().ToDictionary(state => state.Name, StringComparer.OrdinalIgnoreCase);
        lock (_gate)
        {
            return _servers.Select(server =>
            {
                states.TryGetValue(server.Name, out var state);
                return ToView(server, state);
            }).ToArray();
        }
    }

    public McpServerRequest GetRequest(string name)
    {
        lock (_gate)
        {
            var server = Find(name);
            return ToRequest(server);
        }
    }

    public McpServerRequest BuildRequest(McpServerUpdate update)
    {
        var validated = Validate(update);
        lock (_gate)
        {
            var existing = _servers.FirstOrDefault(server =>
                string.Equals(server.Name, validated.Name, StringComparison.OrdinalIgnoreCase));
            return new McpServerRequest(
                validated.Name,
                validated.Command,
                validated.Arguments,
                validated.WorkingDirectory,
                MergeSecrets(validated.Name, "ENV", existing?.EnvironmentKeys, validated.Environment),
                validated.Transport,
                MergeSecrets(validated.Name, "HEADER", existing?.HeaderKeys, validated.Headers));
        }
    }

    public McpServerView Upsert(McpServerUpdate update, McpManager manager)
    {
        var validated = Validate(update);
        lock (_gate)
        {
            var existing = _servers.FirstOrDefault(server =>
                string.Equals(server.Name, validated.Name, StringComparison.OrdinalIgnoreCase));
            var environmentKeys = UpdateSecrets(
                validated.Name, "ENV", existing?.EnvironmentKeys, update.Environment);
            var headerKeys = UpdateSecrets(
                validated.Name, "HEADER", existing?.HeaderKeys, update.Headers);
            var settings = new McpServerSettings(
                validated.Name, validated.Transport, validated.Command,
                validated.Arguments?.ToList() ?? [], validated.WorkingDirectory,
                environmentKeys, headerKeys, validated.Enabled, validated.Trusted,
                existing?.ToolPermissions ?? new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase));
            var index = _servers.FindIndex(server =>
                string.Equals(server.Name, settings.Name, StringComparison.OrdinalIgnoreCase));
            if (index >= 0) _servers[index] = settings;
            else _servers.Add(settings);
            Save();
            var state = manager.GetServerStates().FirstOrDefault(candidate =>
                string.Equals(candidate.Name, settings.Name, StringComparison.OrdinalIgnoreCase));
            return ToView(settings, state);
        }
    }

    public void SetToolPermissions(string name, IReadOnlyDictionary<string, bool> permissions)
    {
        lock (_gate)
        {
            var server = Find(name);
            server.ToolPermissions.Clear();
            foreach (var pair in permissions.Where(pair => !string.IsNullOrWhiteSpace(pair.Key)))
            {
                server.ToolPermissions[pair.Key] = pair.Value;
            }
            Save();
        }
    }

    public bool IsToolAllowed(string serverName, string toolName)
    {
        lock (_gate)
        {
            var server = _servers.FirstOrDefault(candidate =>
                string.Equals(candidate.Name, serverName, StringComparison.OrdinalIgnoreCase));
            return server is not null &&
                (server.Trusted ||
                 server.ToolPermissions.TryGetValue(toolName, out var allowed) && allowed);
        }
    }

    public void Delete(string name)
    {
        lock (_gate)
        {
            var server = Find(name);
            foreach (var key in server.EnvironmentKeys) _secrets.Delete(SecretName(name, "ENV", key));
            foreach (var key in server.HeaderKeys) _secrets.Delete(SecretName(name, "HEADER", key));
            _servers.Remove(server);
            Save();
        }
    }

    private List<McpServerSettings> Load()
    {
        if (!File.Exists(_path)) return [];
        try
        {
            var loaded = JsonSerializer.Deserialize<List<McpServerSettings>>(
                File.ReadAllText(_path), JsonOptions) ?? [];
            return loaded.Select(server =>
            {
                _ = Validate(new McpServerUpdate(
                    server.Name, server.Transport, server.Command, server.Arguments,
                    server.WorkingDirectory, Enabled: server.Enabled, Trusted: server.Trusted));
                return new McpServerSettings(
                    server.Name, server.Transport, server.Command, server.Arguments ?? [],
                    server.WorkingDirectory, server.EnvironmentKeys ?? [], server.HeaderKeys ?? [],
                    server.Enabled, server.Trusted,
                    new Dictionary<string, bool>(
                        server.ToolPermissions ?? new Dictionary<string, bool>(),
                        StringComparer.OrdinalIgnoreCase));
            }).ToList();
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("MCP settings JSON is invalid.", exception);
        }
    }

    private McpServerRequest ToRequest(McpServerSettings server) =>
        new(
            server.Name,
            server.Command,
            server.Arguments,
            server.WorkingDirectory,
            ReadSecrets(server.Name, "ENV", server.EnvironmentKeys),
            server.Transport,
            ReadSecrets(server.Name, "HEADER", server.HeaderKeys));

    private Dictionary<string, string> ReadSecrets(string server, string kind, IEnumerable<string> keys) =>
        keys.Select(key => (key, value: _secrets.Get(SecretName(server, kind, key))))
            .Where(pair => pair.value is not null)
            .ToDictionary(pair => pair.key, pair => pair.value!, StringComparer.OrdinalIgnoreCase);

    private Dictionary<string, string> MergeSecrets(
        string server,
        string kind,
        IReadOnlyList<string>? previousKeys,
        IReadOnlyDictionary<string, string>? values)
    {
        if (values is null) return ReadSecrets(server, kind, previousKeys ?? []);
        var existing = ReadSecrets(server, kind, previousKeys ?? []);
        return values
            .Where(pair => !string.IsNullOrWhiteSpace(pair.Key))
            .ToDictionary(
                pair => pair.Key,
                pair => !string.IsNullOrEmpty(pair.Value)
                    ? pair.Value
                    : existing.GetValueOrDefault(pair.Key) ?? string.Empty,
                StringComparer.OrdinalIgnoreCase);
    }

    private List<string> UpdateSecrets(
        string server,
        string kind,
        IReadOnlyList<string>? previousKeys,
        IReadOnlyDictionary<string, string>? values)
    {
        if (values is null) return previousKeys?.ToList() ?? [];
        var keys = values.Keys.Where(key => !string.IsNullOrWhiteSpace(key)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var removed in (previousKeys ?? []).Except(keys, StringComparer.OrdinalIgnoreCase))
        {
            _secrets.Delete(SecretName(server, kind, removed));
        }
        foreach (var pair in values)
        {
            if (!string.IsNullOrWhiteSpace(pair.Key) && !string.IsNullOrEmpty(pair.Value))
            {
                _secrets.Set(SecretName(server, kind, pair.Key), pair.Value);
            }
        }
        return keys;
    }

    private McpServerSettings Find(string name) =>
        _servers.FirstOrDefault(server => string.Equals(server.Name, name, StringComparison.OrdinalIgnoreCase))
        ?? throw new KeyNotFoundException($"MCP server was not found: {name}");

    private static McpServerUpdate Validate(McpServerUpdate update)
    {
        var name = update.Name.Trim();
        if (!ServerNamePattern().IsMatch(name)) throw new ArgumentException("MCP name must contain only letters, digits, '_' or '-'.");
        var transport = update.Transport.Trim().ToLowerInvariant();
        if (transport is not ("stdio" or "streamable-http" or "http" or "https" or "sse" or "legacy-sse"))
        {
            throw new ArgumentException($"Unsupported MCP transport: {update.Transport}");
        }
        if (string.IsNullOrWhiteSpace(update.Command)) throw new ArgumentException("MCP command or URL is required.");
        if (transport != "stdio" &&
            (!Uri.TryCreate(update.Command, UriKind.Absolute, out var endpoint) ||
             (endpoint.Scheme != Uri.UriSchemeHttps &&
              !(endpoint.Scheme == Uri.UriSchemeHttp && endpoint.Host is "127.0.0.1" or "localhost" or "::1"))))
        {
            throw new ArgumentException("Remote MCP endpoints must use HTTPS; loopback HTTP is allowed.");
        }
        return update with { Name = name, Transport = transport, Command = update.Command.Trim() };
    }

    private static McpServerSettings Clone(McpServerSettings server) =>
        server with
        {
            Arguments = [.. server.Arguments],
            EnvironmentKeys = [.. server.EnvironmentKeys],
            HeaderKeys = [.. server.HeaderKeys],
            ToolPermissions = new Dictionary<string, bool>(server.ToolPermissions, StringComparer.OrdinalIgnoreCase),
        };

    private static McpServerView ToView(McpServerSettings server, McpServerState? state) =>
        new(
            server.Name, server.Transport, server.Command, server.Arguments,
            server.WorkingDirectory, server.EnvironmentKeys, server.HeaderKeys,
            server.Enabled, server.Trusted, server.ToolPermissions,
            state?.Connected ?? false,
            state?.ToolCount ?? 0,
            state?.LastError,
            state?.LastConnectedAt,
            state?.LastCheckDurationMs);

    private void Save()
    {
        var directory = Path.GetDirectoryName(_path)
            ?? throw new InvalidOperationException("MCP settings path has no parent directory.");
        Directory.CreateDirectory(directory);
        var temporary = _path + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(_servers, JsonOptions));
        File.Move(temporary, _path, overwrite: true);
    }

    private static string SecretName(string server, string kind, string key)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)))[..16];
        return $"WORDOLLAMA_MCP_{server.ToUpperInvariant()}_{kind}_{hash}";
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex ServerNamePattern();
}
