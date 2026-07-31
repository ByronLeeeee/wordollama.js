using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
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

public sealed record McpImportResult(
    int Total,
    int Added,
    int Updated,
    IReadOnlyList<string> Names);

public sealed record McpImportRequest(string Json);

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

    public McpSettingsStore(
        string path,
        IMutableSecretStore secrets,
        string? legacyPath = null)
    {
        _path = Path.GetFullPath(path);
        _secrets = secrets;
        var sourcePath = !File.Exists(_path) &&
            !string.IsNullOrWhiteSpace(legacyPath) &&
            File.Exists(legacyPath)
                ? Path.GetFullPath(legacyPath)
                : _path;
        var loaded = Load(sourcePath);
        _servers = loaded.Servers;
        if (loaded.Migrated || !string.Equals(sourcePath, _path, StringComparison.OrdinalIgnoreCase))
        {
            Save();
        }
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

    public McpImportResult ImportJson(string json, McpManager manager)
    {
        var root = JsonNode.Parse(json)
            ?? throw new ArgumentException("MCP JSON is empty.");
        var imported = ParseImportedServers(root);
        if (imported.Length == 0)
        {
            throw new ArgumentException("MCP JSON does not contain any valid servers.");
        }

        HashSet<string> existing;
        lock (_gate)
        {
            existing = _servers.Select(server => server.Name)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        foreach (var update in imported)
        {
            Upsert(update with { Trusted = false }, manager);
            SetToolPermissions(update.Name, new Dictionary<string, bool>());
        }

        var updated = imported.Count(update => existing.Contains(update.Name));
        return new McpImportResult(
            imported.Length,
            imported.Length - updated,
            updated,
            imported.Select(update => update.Name).ToArray());
    }

    private (List<McpServerSettings> Servers, bool Migrated) Load(string sourcePath)
    {
        if (!File.Exists(sourcePath)) return ([], false);
        try
        {
            var json = File.ReadAllText(sourcePath);
            var root = JsonNode.Parse(json)
                ?? throw new InvalidDataException("MCP settings JSON is empty.");
            if (!IsInternalSettings(root))
            {
                var imported = ParseImportedServers(root);
                if (imported.Length == 0)
                {
                    throw new InvalidDataException(
                        "MCP settings JSON does not contain any valid servers.");
                }
                var migrated = imported.Select(update =>
                {
                    var environmentKeys = UpdateSecrets(
                        update.Name, "ENV", null, update.Environment);
                    var headerKeys = UpdateSecrets(
                        update.Name, "HEADER", null, update.Headers);
                    return new McpServerSettings(
                        update.Name, update.Transport, update.Command,
                        update.Arguments?.ToList() ?? [], update.WorkingDirectory,
                        environmentKeys, headerKeys, update.Enabled, Trusted: false,
                        new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase));
                }).ToList();
                return (migrated, true);
            }

            var loaded = JsonSerializer.Deserialize<List<McpServerSettings>>(
                json, JsonOptions) ?? [];
            return (loaded.Select(server =>
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
            }).ToList(), false);
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("MCP settings JSON is invalid.", exception);
        }
    }

    private static bool IsInternalSettings(JsonNode root)
    {
        if (root is not JsonArray array) return false;
        if (array.Count == 0) return true;
        return array.OfType<JsonObject>().All(server =>
            server.ContainsKey("environmentKeys") &&
            server.ContainsKey("headerKeys") &&
            server.ContainsKey("toolPermissions"));
    }

    private static McpServerUpdate[] ParseImportedServers(JsonNode root) =>
        EnumerateImportedServers(root)
            .Select(ParseImportedServer)
            .Where(update => update is not null)
            .Cast<McpServerUpdate>()
            .GroupBy(update => update.Name, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.Last())
            .ToArray();

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
        var transport = NormalizeTransport(update.Transport);
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

    private static string NormalizeTransport(string? transport)
    {
        var value = (transport ?? "stdio").Trim().ToLowerInvariant();
        return value switch
        {
            "streamable" or "streamable_http" => "streamable-http",
            "legacy_sse" => "legacy-sse",
            _ => value,
        };
    }

    private static IEnumerable<(string? Name, JsonObject Value)> EnumerateImportedServers(JsonNode root)
    {
        if (root is JsonArray array)
        {
            foreach (var item in array.OfType<JsonObject>())
            {
                yield return (item["name"]?.GetValue<string>(), item);
            }
            yield break;
        }

        if (root is not JsonObject rootObject) yield break;
        var collection = rootObject["mcpServers"] as JsonObject
            ?? rootObject["servers"] as JsonObject;
        if (collection is not null)
        {
            foreach (var pair in collection)
            {
                if (pair.Value is JsonObject server)
                {
                    yield return (pair.Key, server);
                }
            }
            yield break;
        }

        yield return (rootObject["name"]?.GetValue<string>(), rootObject);
    }

    private static McpServerUpdate? ParseImportedServer((string? Name, JsonObject Value) entry)
    {
        var item = entry.Value;
        var name = ReadString(item, "name") ?? entry.Name;
        var command = ReadString(item, "command");
        var endpoint = ReadString(item, "url") ?? ReadString(item, "endpoint");
        var transportText = ReadString(item, "transport") ?? ReadString(item, "type");
        if (string.IsNullOrWhiteSpace(transportText))
        {
            transportText = string.IsNullOrWhiteSpace(endpoint) ? "stdio" : "streamable-http";
        }
        var transport = NormalizeTransport(transportText);
        var target = transport == "stdio" ? command : endpoint ?? command;
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(target))
        {
            return null;
        }

        var update = new McpServerUpdate(
            name,
            transport,
            target,
            ReadArguments(item["args"] ?? item["arguments"]),
            ReadString(item, "cwd") ?? ReadString(item, "workingDirectory"),
            ReadPairs(item["env"] ?? item["environment"]),
            ReadPairs(item["headers"]),
            ReadBoolean(item, "enabled", true),
            Trusted: false);
        try
        {
            return Validate(update);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static string? ReadString(JsonObject item, string property) =>
        item[property] is JsonValue value && value.TryGetValue<string>(out var text)
            ? text
            : null;

    private static bool ReadBoolean(JsonObject item, string property, bool fallback) =>
        item[property] is JsonValue value && value.TryGetValue<bool>(out var result)
            ? result
            : fallback;

    private static IReadOnlyList<string> ReadArguments(JsonNode? node)
    {
        if (node is JsonArray array)
        {
            return array.Select(item => item?.ToString() ?? string.Empty).ToArray();
        }
        if (node is JsonValue value && value.TryGetValue<string>(out var text))
        {
            return SplitArguments(text);
        }
        return [];
    }

    private static IReadOnlyDictionary<string, string> ReadPairs(JsonNode? node)
    {
        if (node is JsonObject pairs)
        {
            return pairs.ToDictionary(
                pair => pair.Key,
                pair => pair.Value?.ToString() ?? string.Empty,
                StringComparer.OrdinalIgnoreCase);
        }
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (node is not JsonValue value || !value.TryGetValue<string>(out var text)) return result;
        foreach (var line in text.Split(["\r\n", "\n"], StringSplitOptions.None))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;
            var separator = trimmed.IndexOf('=');
            if (separator <= 0) continue;
            result[trimmed[..separator].Trim()] = trimmed[(separator + 1)..];
        }
        return result;
    }

    private static IReadOnlyList<string> SplitArguments(string value)
    {
        var result = new List<string>();
        var current = new StringBuilder();
        var quoted = false;
        var quote = '\0';
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if ((character is '"' or '\'') && (!quoted || quote == character))
            {
                quoted = !quoted;
                quote = quoted ? character : '\0';
                continue;
            }
            if (character == '\\' && index + 1 < value.Length && quoted)
            {
                current.Append(value[++index]);
                continue;
            }
            if (char.IsWhiteSpace(character) && !quoted)
            {
                if (current.Length > 0)
                {
                    result.Add(current.ToString());
                    current.Clear();
                }
                continue;
            }
            current.Append(character);
        }
        if (current.Length > 0) result.Add(current.ToString());
        return result;
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
