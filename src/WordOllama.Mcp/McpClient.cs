using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using WordOllama.Contracts;

namespace WordOllama.Mcp;

public sealed record McpServerOptions(
    string Name,
    string Command,
    IReadOnlyList<string>? Arguments = null,
    string? WorkingDirectory = null,
    IReadOnlyDictionary<string, string>? Environment = null);

public sealed record McpToolDefinition(
    string Name,
    string Description,
    JsonElement InputSchema,
    string ServerName);

internal static class McpToolListParser
{
    public static IReadOnlyList<McpToolDefinition> ParsePage(
        JsonElement response,
        string serverName,
        out string? nextCursor)
    {
        nextCursor = null;
        if (!response.TryGetProperty("result", out var result))
        {
            return Array.Empty<McpToolDefinition>();
        }
        if (result.TryGetProperty("nextCursor", out var cursorValue) &&
            cursorValue.ValueKind == JsonValueKind.String)
        {
            nextCursor = cursorValue.GetString();
        }
        if (!result.TryGetProperty("tools", out var tools) ||
            tools.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<McpToolDefinition>();
        }
        return tools.EnumerateArray()
            .Select(tool =>
            {
                var name = tool.TryGetProperty("name", out var nameValue)
                    ? nameValue.GetString()
                    : null;
                var description = tool.TryGetProperty("description", out var descriptionValue)
                    ? descriptionValue.GetString() ?? string.Empty
                    : string.Empty;
                var schema = tool.TryGetProperty("inputSchema", out var schemaValue)
                    ? schemaValue.Clone()
                    : JsonSerializer.SerializeToElement(new { type = "object", properties = new { } });
                return string.IsNullOrWhiteSpace(name)
                    ? null
                    : new McpToolDefinition(name!, description, schema, serverName);
            })
            .Where(tool => tool is not null)
            .Cast<McpToolDefinition>()
            .ToArray();
    }
}

public interface IMcpClient : IAsyncDisposable
{
    string ServerName { get; }
    bool IsConnected { get; }

    Task ConnectAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<McpToolDefinition>> ListToolsAsync(CancellationToken cancellationToken = default);
    Task<string> CallToolAsync(
        string name,
        JsonElement arguments,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// MCP stdio transport. The child process is never started through a shell;
/// every argument is passed as an individual ProcessStartInfo.ArgumentList item.
/// </summary>
public sealed class StdioMcpClient : IMcpClient
{
    private const string ProtocolVersion = "2025-03-26";
    private readonly McpServerOptions _options;
    private readonly SemaphoreSlim _requestLock = new(1, 1);
    private Process? _process;
    private StreamReader? _reader;
    private StreamWriter? _writer;
    private int _requestId;

    public StdioMcpClient(McpServerOptions options)
    {
        _options = options;
    }

    public string ServerName => _options.Name;
    public bool IsConnected => _process is { HasExited: false };

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (IsConnected)
        {
            return;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = _options.Command,
            WorkingDirectory = string.IsNullOrWhiteSpace(_options.WorkingDirectory)
                ? Environment.CurrentDirectory
                : _options.WorkingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in _options.Arguments ?? Array.Empty<string>())
        {
            startInfo.ArgumentList.Add(argument);
        }
        if (_options.Environment is not null)
        {
            foreach (var pair in _options.Environment)
            {
                startInfo.Environment[pair.Key] = pair.Value;
            }
        }

        _process = new Process { StartInfo = startInfo };
        _process.Start();
        _reader = _process.StandardOutput;
        _writer = _process.StandardInput;

        _ = DrainStderrAsync(_process.StandardError);
        await SendRequestAsync(
            "initialize",
            new
            {
                protocolVersion = ProtocolVersion,
                capabilities = new { },
                clientInfo = new { name = "WordOllama", version = "unified-net8" },
            },
            cancellationToken);
        await SendNotificationAsync("notifications/initialized", new { }, cancellationToken);
    }

    public async Task<IReadOnlyList<McpToolDefinition>> ListToolsAsync(
        CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        var definitions = new List<McpToolDefinition>();
        string? cursor = null;
        var pageCount = 0;
        do
        {
            var parameters = new Dictionary<string, object?>();
            if (!string.IsNullOrWhiteSpace(cursor))
            {
                parameters["cursor"] = cursor;
            }
            var response = await SendRequestAsync("tools/list", parameters, cancellationToken);
            definitions.AddRange(McpToolListParser.ParsePage(response, ServerName, out cursor));
            pageCount++;
        } while (!string.IsNullOrWhiteSpace(cursor) && pageCount < 100);
        return definitions;
    }

    public async Task<string> CallToolAsync(
        string name,
        JsonElement arguments,
        CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        var response = await SendRequestAsync(
            "tools/call",
            new { name, arguments },
            cancellationToken);
        return response.TryGetProperty("result", out var result)
            ? result.GetRawText()
            : response.GetRawText();
    }

    public async ValueTask DisposeAsync()
    {
        _writer?.Dispose();
        _reader?.Dispose();
        if (_process is not null)
        {
            try
            {
                if (!_process.HasExited)
                {
                    _process.Kill(entireProcessTree: true);
                    await _process.WaitForExitAsync();
                }
            }
            catch
            {
                // The process may already have exited.
            }
            _process.Dispose();
        }
        _requestLock.Dispose();
    }

    private async Task<JsonElement> SendRequestAsync(
        string method,
        object parameters,
        CancellationToken cancellationToken)
    {
        await _requestLock.WaitAsync(cancellationToken);
        try
        {
            EnsureConnected();
            var id = Interlocked.Increment(ref _requestId);
            var request = JsonSerializer.Serialize(new
            {
                jsonrpc = "2.0",
                id,
                method,
                @params = parameters,
            });
            await _writer!.WriteLineAsync(request.AsMemory(), cancellationToken);
            await _writer.FlushAsync(cancellationToken);

            while (true)
            {
                var line = await _reader!.ReadLineAsync(cancellationToken);
                if (line is null)
                {
                    throw new IOException($"MCP server '{ServerName}' closed stdout.");
                }
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                if (!root.TryGetProperty("id", out var responseId) ||
                    responseId.GetInt32() != id)
                {
                    continue;
                }
                if (root.TryGetProperty("error", out var error))
                {
                    throw new InvalidOperationException($"MCP {method} failed: {error.GetRawText()}");
                }
                return root.Clone();
            }
        }
        finally
        {
            _requestLock.Release();
        }
    }

    private async Task SendNotificationAsync(
        string method,
        object parameters,
        CancellationToken cancellationToken)
    {
        EnsureConnected();
        var notification = JsonSerializer.Serialize(new
        {
            jsonrpc = "2.0",
            method,
            @params = parameters,
        });
        await _writer!.WriteLineAsync(notification.AsMemory(), cancellationToken);
        await _writer.FlushAsync(cancellationToken);
    }

    private void EnsureConnected()
    {
        if (!IsConnected || _reader is null || _writer is null)
        {
            throw new InvalidOperationException($"MCP server '{ServerName}' is not connected.");
        }
    }

    private static async Task DrainStderrAsync(StreamReader stderr)
    {
        while (await stderr.ReadLineAsync() is not null)
        {
        }
    }
}

/// <summary>
/// MCP Streamable HTTP transport. The server may return either a JSON response
/// or a single-event SSE response for each JSON-RPC request.
/// </summary>
public sealed class StreamableHttpMcpClient : IMcpClient
{
    private const string ProtocolVersion = "2025-03-26";
    private readonly McpServerOptions _options;
    private readonly HttpClient _httpClient;
    private readonly IReadOnlyDictionary<string, string> _headers;
    private readonly SemaphoreSlim _requestLock = new(1, 1);
    private string? _sessionId;
    private int _requestId;
    private bool _connected;

    public StreamableHttpMcpClient(
        McpServerOptions options,
        IReadOnlyDictionary<string, string>? headers = null)
    {
        _options = options;
        _headers = headers ?? new Dictionary<string, string>();
        if (!Uri.TryCreate(options.Command, UriKind.Absolute, out var endpoint) ||
            (endpoint.Scheme != Uri.UriSchemeHttps && !IsLoopback(endpoint)))
        {
            throw new ArgumentException("MCP HTTP endpoint must use HTTPS (or loopback HTTP).", nameof(options));
        }
        _httpClient = new HttpClient
        {
            BaseAddress = endpoint,
            Timeout = TimeSpan.FromMinutes(2),
        };
    }

    public string ServerName => _options.Name;
    public bool IsConnected => _connected;

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_connected) return;
        await SendRequestAsync(
            "initialize",
            new
            {
                protocolVersion = ProtocolVersion,
                capabilities = new { },
                clientInfo = new { name = "WordOllama", version = "unified-net8" },
            },
            cancellationToken);
        await SendNotificationAsync("notifications/initialized", new { }, cancellationToken);
        _connected = true;
    }

    public async Task<IReadOnlyList<McpToolDefinition>> ListToolsAsync(
        CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        var definitions = new List<McpToolDefinition>();
        string? cursor = null;
        var pageCount = 0;
        do
        {
            var parameters = new Dictionary<string, object?>();
            if (!string.IsNullOrWhiteSpace(cursor))
            {
                parameters["cursor"] = cursor;
            }
            var response = await SendRequestAsync("tools/list", parameters, cancellationToken);
            definitions.AddRange(McpToolListParser.ParsePage(response, ServerName, out cursor));
            pageCount++;
        } while (!string.IsNullOrWhiteSpace(cursor) && pageCount < 100);
        return definitions;
    }

    public async Task<string> CallToolAsync(
        string name,
        JsonElement arguments,
        CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        var response = await SendRequestAsync("tools/call", new { name, arguments }, cancellationToken);
        return response.TryGetProperty("result", out var result)
            ? result.GetRawText()
            : response.GetRawText();
    }

    public ValueTask DisposeAsync()
    {
        _connected = false;
        _httpClient.Dispose();
        _requestLock.Dispose();
        return ValueTask.CompletedTask;
    }

    private async Task<JsonElement> SendRequestAsync(
        string method,
        object parameters,
        CancellationToken cancellationToken)
    {
        await _requestLock.WaitAsync(cancellationToken);
        try
        {
            var id = Interlocked.Increment(ref _requestId);
            using var request = new HttpRequestMessage(HttpMethod.Post, string.Empty)
            {
                Content = JsonContent.Create(new
                {
                    jsonrpc = "2.0",
                    id,
                    method,
                    @params = parameters,
                }),
            };
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
            request.Headers.TryAddWithoutValidation("MCP-Protocol-Version", ProtocolVersion);
            if (!string.IsNullOrWhiteSpace(_sessionId))
            {
                request.Headers.TryAddWithoutValidation("Mcp-Session-Id", _sessionId);
            }
            foreach (var header in _headers)
            {
                request.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }

            using var response = await _httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new HttpRequestException(
                    $"MCP HTTP server '{ServerName}' returned {(int)response.StatusCode}: {body[..Math.Min(500, body.Length)]}",
                    null,
                    response.StatusCode);
            }
            if (response.Headers.TryGetValues("Mcp-Session-Id", out var sessionValues))
            {
                _sessionId = sessionValues.FirstOrDefault();
            }
            var document = ParseJsonOrSse(body, id);
            if (document.TryGetProperty("error", out var error))
            {
                throw new InvalidOperationException($"MCP {method} failed: {error.GetRawText()}");
            }
            return document;
        }
        finally
        {
            _requestLock.Release();
        }
    }

    private async Task SendNotificationAsync(
        string method,
        object parameters,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, string.Empty)
        {
            Content = JsonContent.Create(new { jsonrpc = "2.0", method, @params = parameters }),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        request.Headers.TryAddWithoutValidation("MCP-Protocol-Version", ProtocolVersion);
        if (!string.IsNullOrWhiteSpace(_sessionId)) request.Headers.TryAddWithoutValidation("Mcp-Session-Id", _sessionId);
        foreach (var header in _headers) request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"MCP notification failed: {(int)response.StatusCode}", null, response.StatusCode);
        }
    }

    private void EnsureConnected()
    {
        if (!_connected) throw new InvalidOperationException($"MCP server '{ServerName}' is not connected.");
    }

    private static JsonElement ParseJsonOrSse(string body, int requestId)
    {
        var trimmed = body.Trim();
        if (trimmed.Contains("data:", StringComparison.OrdinalIgnoreCase))
        {
            var dataLines = trimmed.Split('\n')
                .Where(line => line.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                .Select(line => line[5..].Trim())
                .Where(line => line.Length > 0)
                .ToArray();
            foreach (var data in dataLines.Reverse())
            {
                try
                {
                    using var candidate = JsonDocument.Parse(data);
                    if (candidate.RootElement.TryGetProperty("id", out var idValue) &&
                        ((idValue.ValueKind == JsonValueKind.Number && idValue.GetInt32() == requestId) ||
                         (idValue.ValueKind == JsonValueKind.String && idValue.GetString() == requestId.ToString())))
                    {
                        return candidate.RootElement.Clone();
                    }
                }
                catch (JsonException)
                {
                    // Try the next SSE event; servers may interleave notifications.
                }
            }
            trimmed = dataLines.LastOrDefault() ?? trimmed;
        }
        using var document = JsonDocument.Parse(trimmed);
        return document.RootElement.Clone();
    }

    private static bool IsLoopback(Uri uri) => uri.Host is "127.0.0.1" or "localhost" or "::1";
}

/// <summary>Legacy MCP SSE transport used by older remote servers.</summary>
public sealed class SseMcpClient : IMcpClient
{
    private const string ProtocolVersion = "2025-03-26";
    private readonly McpServerOptions _options;
    private readonly IReadOnlyDictionary<string, string> _headers;
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromMinutes(2) };
    private readonly SemaphoreSlim _requestLock = new(1, 1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly TaskCompletionSource<Uri> _endpoint = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly CancellationTokenSource _shutdown = new();
    private HttpResponseMessage? _sseResponse;
    private Uri? _messageEndpoint;
    private int _requestId;
    private bool _connected;

    public SseMcpClient(McpServerOptions options, IReadOnlyDictionary<string, string>? headers = null)
    {
        _options = options;
        _headers = headers ?? new Dictionary<string, string>();
        if (!Uri.TryCreate(options.Command, UriKind.Absolute, out var endpoint) ||
            (endpoint.Scheme != Uri.UriSchemeHttps && !IsLoopback(endpoint)))
        {
            throw new ArgumentException("MCP SSE endpoint must use HTTPS (or loopback HTTP).", nameof(options));
        }
    }

    public string ServerName => _options.Name;
    public bool IsConnected => _connected;

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_connected) return;
        using var request = new HttpRequestMessage(HttpMethod.Get, _options.Command);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        foreach (var header in _headers) request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        _sseResponse = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        _sseResponse.EnsureSuccessStatusCode();
        _ = PumpAsync(_shutdown.Token);
        _messageEndpoint = await _endpoint.Task.WaitAsync(cancellationToken);
        await SendRequestAsync(
            "initialize",
            new
            {
                protocolVersion = ProtocolVersion,
                capabilities = new { },
                clientInfo = new { name = "WordOllama", version = "unified-net8" },
            },
            cancellationToken);
        await SendNotificationAsync("notifications/initialized", new { }, cancellationToken);
        _connected = true;
    }

    public async Task<IReadOnlyList<McpToolDefinition>> ListToolsAsync(CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        var definitions = new List<McpToolDefinition>();
        string? cursor = null;
        var pageCount = 0;
        do
        {
            var parameters = new Dictionary<string, object?>();
            if (!string.IsNullOrWhiteSpace(cursor))
            {
                parameters["cursor"] = cursor;
            }
            var response = await SendRequestAsync("tools/list", parameters, cancellationToken);
            definitions.AddRange(McpToolListParser.ParsePage(response, ServerName, out cursor));
            pageCount++;
        } while (!string.IsNullOrWhiteSpace(cursor) && pageCount < 100);
        return definitions;
    }

    public async Task<string> CallToolAsync(string name, JsonElement arguments, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        var response = await SendRequestAsync("tools/call", new { name, arguments }, cancellationToken);
        return response.TryGetProperty("result", out var result) ? result.GetRawText() : response.GetRawText();
    }

    public ValueTask DisposeAsync()
    {
        _connected = false;
        _shutdown.Cancel();
        _sseResponse?.Dispose();
        _httpClient.Dispose();
        _requestLock.Dispose();
        _shutdown.Dispose();
        return ValueTask.CompletedTask;
    }

    private async Task<JsonElement> SendRequestAsync(string method, object parameters, CancellationToken cancellationToken)
    {
        await _requestLock.WaitAsync(cancellationToken);
        var id = Interlocked.Increment(ref _requestId).ToString();
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = completion;
        try
        {
            await PostAsync(new { jsonrpc = "2.0", id = int.Parse(id), method, @params = parameters }, cancellationToken);
            var response = await completion.Task.WaitAsync(TimeSpan.FromSeconds(120), cancellationToken);
            if (response.TryGetProperty("error", out var error))
                throw new InvalidOperationException($"MCP {method} failed: {error.GetRawText()}");
            return response;
        }
        finally
        {
            _pending.TryRemove(id, out _);
            _requestLock.Release();
        }
    }

    private async Task SendNotificationAsync(string method, object parameters, CancellationToken cancellationToken)
    {
        await PostAsync(new { jsonrpc = "2.0", method, @params = parameters }, cancellationToken);
    }

    private async Task PostAsync(object payload, CancellationToken cancellationToken)
    {
        if (_messageEndpoint is null) throw new InvalidOperationException("MCP SSE message endpoint is not available.");
        using var request = new HttpRequestMessage(HttpMethod.Post, _messageEndpoint) { Content = JsonContent.Create(payload) };
        foreach (var header in _headers) request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private async Task PumpAsync(CancellationToken cancellationToken)
    {
        if (_sseResponse is null) return;
        try
        {
            using var reader = new StreamReader(await _sseResponse.Content.ReadAsStreamAsync(cancellationToken));
            var eventName = string.Empty;
            var data = new List<string>();
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(cancellationToken);
                if (line is null) break;
                if (line.Length == 0)
                {
                    ProcessEvent(eventName, data);
                    eventName = string.Empty;
                    data.Clear();
                }
                else if (line.StartsWith("event:", StringComparison.OrdinalIgnoreCase)) eventName = line[6..].Trim();
                else if (line.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) data.Add(line[5..].Trim());
            }
            ProcessEvent(eventName, data);
        }
        catch (Exception exception) when (exception is IOException or OperationCanceledException or HttpRequestException)
        {
            foreach (var pending in _pending.Values) pending.TrySetException(exception);
        }
    }

    private void ProcessEvent(string eventName, IReadOnlyList<string> data)
    {
        if (data.Count == 0) return;
        var text = string.Join("\n", data);
        if (eventName.Equals("endpoint", StringComparison.OrdinalIgnoreCase))
        {
            if (Uri.TryCreate(new Uri(_options.Command), text, out var endpoint)) _endpoint.TrySetResult(endpoint);
            return;
        }
        try
        {
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement.Clone();
            if (root.TryGetProperty("id", out var id) && _pending.TryGetValue(id.ToString(), out var completion))
                completion.TrySetResult(root);
        }
        catch (JsonException)
        {
        }
    }

    private void EnsureConnected()
    {
        if (!_connected) throw new InvalidOperationException($"MCP server '{ServerName}' is not connected.");
    }

    private static bool IsLoopback(Uri uri) => uri.Host is "127.0.0.1" or "localhost" or "::1";
}
