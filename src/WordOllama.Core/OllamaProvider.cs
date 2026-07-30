using System.Net.Http.Json;
using System.Text.Json;
using System.Runtime.CompilerServices;
using WordOllama.Contracts;

namespace WordOllama.Core;

/// <summary>
/// Cross-platform Ollama provider without Office or WPF dependencies.
/// </summary>
public sealed class OllamaProvider : IModelProvider
{
    private readonly HttpClient _httpClient;
    private readonly string _defaultModel;

    public OllamaProvider(string endpoint, string defaultModel, TimeSpan? timeout = null)
    {
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri(endpoint.TrimEnd('/') + "/", UriKind.Absolute),
            Timeout = timeout ?? TimeSpan.FromMinutes(10),
        };
        _defaultModel = defaultModel;
    }

    public string ProviderType => "Ollama";

    public async Task<ProviderChatResponse> ChatAsync(
        ProviderChatRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.Messages.Count == 0)
        {
            throw new ArgumentException("At least one chat message is required.", nameof(request));
        }

        var model = string.IsNullOrWhiteSpace(request.Model) ? _defaultModel : request.Model;
        var payload = new
        {
            model,
            messages = request.Messages.Select(message => new
            {
                role = message.Role,
                content = message.Content,
                images = ParseOllamaImages(message.ImageDataUrl),
                tool_call_id = message.ToolCallId,
                name = message.Name,
                tool_calls = message.ToolCalls?.Select(call => new
                {
                    id = call.Id,
                    type = "function",
                    function = new
                    {
                        name = call.Name,
                        arguments = call.Arguments,
                    },
                }),
            }),
            stream = false,
            keep_alive = request.KeepAlive,
            options = request.Temperature is null && request.MaxTokens is null && request.ContextWindow is null
                ? null
                : new
                {
                    temperature = request.Temperature,
                    num_predict = request.MaxTokens,
                    num_ctx = request.ContextWindow,
                },
            tools = request.Tools?.Select(tool => new
            {
                type = "function",
                function = new
                {
                    name = tool.Name,
                    description = tool.Description,
                    parameters = tool.ParameterSchema,
                },
            }),
        };

        using var response = await _httpClient.PostAsJsonAsync("api/chat", payload, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ollama returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }

        using var document = JsonDocument.Parse(body);
        var message = document.RootElement.GetProperty("message");
        var content = message.TryGetProperty("content", out var messageContent)
            ? messageContent.GetString() ?? string.Empty
            : string.Empty;
        var toolCalls = ParseToolCalls(message);
        return new ProviderChatResponse(ProviderType, model, content, toolCalls);
    }

    public async Task<IReadOnlyList<string>> FetchModelsAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.GetAsync("api/tags", cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ollama returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }

        using var document = JsonDocument.Parse(body);
        if (!document.RootElement.TryGetProperty("models", out var models))
        {
            return Array.Empty<string>();
        }

        return models.EnumerateArray()
            .Select(model => model.TryGetProperty("name", out var name) ? name.GetString() : null)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Cast<string>()
            .ToArray();
    }

    public async IAsyncEnumerable<ProviderChatChunk> ChatStreamAsync(
        ProviderChatRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        if (request.Messages.Count == 0)
        {
            throw new ArgumentException("At least one chat message is required.", nameof(request));
        }

        var model = string.IsNullOrWhiteSpace(request.Model) ? _defaultModel : request.Model;
        var payload = new
        {
            model,
            messages = request.Messages.Select(message => new
            {
                role = message.Role,
                content = message.Content,
                images = ParseOllamaImages(message.ImageDataUrl),
                tool_call_id = message.ToolCallId,
                name = message.Name,
                tool_calls = message.ToolCalls?.Select(call => new
                {
                    id = call.Id,
                    type = "function",
                    function = new { name = call.Name, arguments = call.Arguments.GetRawText() },
                }),
            }),
            stream = true,
            keep_alive = request.KeepAlive,
            options = request.Temperature is null && request.MaxTokens is null && request.ContextWindow is null
                ? null
                : new
                {
                    temperature = request.Temperature,
                    num_predict = request.MaxTokens,
                    num_ctx = request.ContextWindow,
                },
            tools = request.Tools?.Select(tool => new
            {
                type = "function",
                function = new { name = tool.Name, description = tool.Description, parameters = tool.ParameterSchema },
            }),
        };

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "api/chat")
        {
            Content = JsonContent.Create(payload),
        };
        using var response = await _httpClient.SendAsync(
            httpRequest,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException(
                $"Ollama returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }

        var emittedDone = false;
        await foreach (var line in ProviderStreaming.ReadLinesAsync(response, cancellationToken))
        {
            if (!ProviderStreaming.TryGetEventData(line, out var data) || data == "[DONE]")
            {
                continue;
            }

            using var document = JsonDocument.Parse(data);
            var root = document.RootElement;
            var message = root.TryGetProperty("message", out var messageValue)
                ? messageValue
                : default;
            if (message.ValueKind == JsonValueKind.Object &&
                message.TryGetProperty("content", out var contentValue) &&
                contentValue.ValueKind == JsonValueKind.String &&
                !string.IsNullOrEmpty(contentValue.GetString()))
            {
                yield return new ProviderChatChunk(ProviderType, model, contentValue.GetString()!, Done: false);
            }

            if (root.TryGetProperty("done", out var doneValue) && doneValue.ValueKind == JsonValueKind.True)
            {
                emittedDone = true;
                yield return new ProviderChatChunk(
                    ProviderType,
                    model,
                    string.Empty,
                    Done: true,
                    ToolCalls: message.ValueKind == JsonValueKind.Object ? ParseToolCalls(message) : Array.Empty<ProviderToolCall>());
            }
        }

        if (!emittedDone)
        {
            yield return new ProviderChatChunk(ProviderType, model, string.Empty, Done: true);
        }
    }

    private static string Truncate(string value) =>
        value.Length <= 500 ? value : value[..500] + "...";

    private static string[]? ParseOllamaImages(string? dataUrl)
    {
        var image = ProviderImageDataParser.Parse(dataUrl);
        return image is null ? null : new[] { image.Base64Data };
    }

    private static IReadOnlyList<ProviderToolCall> ParseToolCalls(JsonElement message)
    {
        if (!message.TryGetProperty("tool_calls", out var calls) ||
            calls.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ProviderToolCall>();
        }

        var result = new List<ProviderToolCall>();
        var index = 0;
        foreach (var call in calls.EnumerateArray())
        {
            var function = call.TryGetProperty("function", out var functionValue)
                ? functionValue
                : call;
            var name = function.TryGetProperty("name", out var nameValue)
                ? nameValue.GetString()
                : null;
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            var id = call.TryGetProperty("id", out var idValue)
                ? idValue.GetString()
                : null;
            var rawArguments = function.TryGetProperty("arguments", out var argumentValue)
                ? argumentValue
                : default;
            var arguments = ParseArguments(rawArguments);
            result.Add(new ProviderToolCall(
                string.IsNullOrWhiteSpace(id) ? $"ollama-call-{index++}" : id,
                name,
                arguments));
        }

        return result;
    }

    private static JsonElement ParseArguments(JsonElement rawArguments)
    {
        if (rawArguments.ValueKind == JsonValueKind.Object)
        {
            return rawArguments.Clone();
        }

        if (rawArguments.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(rawArguments.GetString()))
        {
            try
            {
                using var parsed = JsonDocument.Parse(rawArguments.GetString()!);
                return parsed.RootElement.Clone();
            }
            catch (JsonException)
            {
                return JsonSerializer.SerializeToElement(new Dictionary<string, object?>());
            }
        }

        return JsonSerializer.SerializeToElement(new Dictionary<string, object?>());
    }
}
