using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using WordOllama.Contracts;

namespace WordOllama.Mcp;

public sealed record McpServerState(
    string Name,
    bool Connected,
    int ToolCount,
    string? LastError,
    DateTimeOffset? LastConnectedAt,
    long? LastCheckDurationMs);

public sealed class McpManager : IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, IMcpClient> _clients = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, IReadOnlyList<McpToolDefinition>> _tools = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, McpServerState> _health = new(StringComparer.OrdinalIgnoreCase);

    public async Task<IReadOnlyList<McpToolDefinition>> ConnectAsync(
        McpServerRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name) ||
            string.IsNullOrWhiteSpace(request.Command))
        {
            throw new ArgumentException("MCP server name and command are required.");
        }

        if (_clients.TryRemove(request.Name, out var previous))
        {
            await previous.DisposeAsync();
        }
        _tools.TryRemove(request.Name, out _);

        var options = new McpServerOptions(
            request.Name,
            request.Command,
            request.Arguments,
            request.WorkingDirectory,
            request.Environment);
        var transport = request.Transport.Trim().ToLowerInvariant();
        IMcpClient? client = null;
        var stopwatch = Stopwatch.StartNew();
        try
        {
            client = transport switch
            {
                "stdio" => new StdioMcpClient(options),
                "sse" or "legacy-sse" => new SseMcpClient(options, request.Headers),
                "streamable-http" or "http" or "https" => new StreamableHttpMcpClient(options, request.Headers),
                _ => throw new ArgumentException($"Unsupported MCP transport: {request.Transport}"),
            };
            await client.ConnectAsync(cancellationToken);
            _clients[request.Name] = client;
            var tools = await client.ListToolsAsync(cancellationToken);
            _tools[request.Name] = tools;
            _health[request.Name] = new McpServerState(
                request.Name, true, tools.Count, null, DateTimeOffset.UtcNow, stopwatch.ElapsedMilliseconds);
            return tools;
        }
        catch (Exception exception)
        {
            if (client is not null)
            {
                await client.DisposeAsync();
            }
            _clients.TryRemove(request.Name, out _);
            _tools.TryRemove(request.Name, out _);
            _health[request.Name] = new McpServerState(
                request.Name, false, 0, BoundedError(exception), null, stopwatch.ElapsedMilliseconds);
            throw;
        }
    }

    public async Task<IReadOnlyList<McpToolDefinition>> ListToolsAsync(
        string serverName,
        CancellationToken cancellationToken = default)
    {
        if (!_clients.TryGetValue(serverName, out var client))
        {
            throw new InvalidOperationException($"MCP server is not connected: {serverName}");
        }
        var stopwatch = Stopwatch.StartNew();
        try
        {
            var tools = await client.ListToolsAsync(cancellationToken);
            _tools[serverName] = tools;
            var previous = _health.GetValueOrDefault(serverName);
            _health[serverName] = new McpServerState(
                serverName, client.IsConnected, tools.Count, null,
                previous?.LastConnectedAt ?? DateTimeOffset.UtcNow, stopwatch.ElapsedMilliseconds);
            return tools;
        }
        catch (Exception exception)
        {
            var previous = _health.GetValueOrDefault(serverName);
            _health[serverName] = new McpServerState(
                serverName, client.IsConnected, previous?.ToolCount ?? 0, BoundedError(exception),
                previous?.LastConnectedAt, stopwatch.ElapsedMilliseconds);
            throw;
        }
    }

    public IReadOnlyList<McpToolDefinition> GetDiscoveredTools() =>
        _tools.Values.SelectMany(tools => tools).ToArray();

    public IReadOnlyList<McpServerState> GetServerStates() =>
        _health.Keys.Concat(_clients.Keys)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(name =>
            {
                _clients.TryGetValue(name, out var client);
                _health.TryGetValue(name, out var health);
                var toolCount = _tools.TryGetValue(name, out var tools) ? tools.Count : health?.ToolCount ?? 0;
                return new McpServerState(
                    name,
                    client?.IsConnected ?? false,
                    toolCount,
                    health?.LastError,
                    health?.LastConnectedAt,
                    health?.LastCheckDurationMs);
            })
            .OrderBy(state => state.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

    public async Task<McpServerState> CheckHealthAsync(
        string serverName,
        CancellationToken cancellationToken = default)
    {
        await ListToolsAsync(serverName, cancellationToken);
        return GetServerStates().First(state =>
            string.Equals(state.Name, serverName, StringComparison.OrdinalIgnoreCase));
    }

    public async Task<bool> DisconnectAsync(string serverName)
    {
        _tools.TryRemove(serverName, out _);
        if (!_clients.TryRemove(serverName, out var client))
        {
            var previousState = _health.GetValueOrDefault(serverName);
            _health[serverName] = new McpServerState(
                serverName, false, 0, previousState?.LastError,
                previousState?.LastConnectedAt, previousState?.LastCheckDurationMs);
            return false;
        }
        await client.DisposeAsync();
        var previous = _health.GetValueOrDefault(serverName);
        _health[serverName] = new McpServerState(
            serverName, false, 0, null, previous?.LastConnectedAt, previous?.LastCheckDurationMs);
        return true;
    }

    public bool IsKnownTool(string qualifiedName) =>
        TryResolve(qualifiedName, out _, out _);

    public bool TryResolve(
        string qualifiedName,
        out string serverName,
        out string toolName)
    {
        serverName = string.Empty;
        toolName = string.Empty;
        if (!qualifiedName.StartsWith("mcp__", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var parts = qualifiedName.Split("__", 3, StringSplitOptions.None);
        if (parts.Length != 3 ||
            !_tools.TryGetValue(parts[1], out var tools) ||
            !tools.Any(tool => string.Equals(tool.Name, parts[2], StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        serverName = parts[1];
        toolName = parts[2];
        return true;
    }

    public async Task<string> CallToolAsync(
        McpToolCallRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!_clients.TryGetValue(request.ServerName, out var client))
        {
            throw new InvalidOperationException($"MCP server is not connected: {request.ServerName}");
        }
        return await client.CallToolAsync(request.ToolName, request.Arguments, cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var pair in _clients)
        {
            await pair.Value.DisposeAsync();
        }
        _clients.Clear();
        _tools.Clear();
        _health.Clear();
    }

    private static string BoundedError(Exception exception)
    {
        var message = exception.Message.ReplaceLineEndings(" ").Trim();
        message = Regex.Replace(
            message,
            @"(?i)\b(Bearer|Basic)\s+[^\s,;]+",
            "$1 [REDACTED]",
            RegexOptions.CultureInvariant);
        message = Regex.Replace(
            message,
            @"(?i)\b(api[-_]?key|authorization|token|secret|password)\s*[:=]\s*[^,\s;]+",
            "$1=[REDACTED]",
            RegexOptions.CultureInvariant);
        return message.Length <= 500 ? message : message[..500];
    }
}
