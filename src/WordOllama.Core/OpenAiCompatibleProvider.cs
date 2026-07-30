using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text;
using System.Runtime.CompilerServices;
using WordOllama.Contracts;

namespace WordOllama.Core;

public sealed class OpenAiCompatibleProvider : IModelProvider
{
    private readonly HttpClient _httpClient;
    private readonly string _defaultModel;
    private readonly string _apiKey;

    public OpenAiCompatibleProvider(
        string endpoint,
        string apiKey,
        string defaultModel,
        string providerType = "OpenAI",
        TimeSpan? timeout = null)
    {
        ProviderType = providerType;
        _apiKey = apiKey;
        _defaultModel = defaultModel;
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri(NormalizeBaseUrl(endpoint), UriKind.Absolute),
            Timeout = timeout ?? TimeSpan.FromMinutes(10),
        };
        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _apiKey);
        }
    }

    public string ProviderType { get; }

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
            messages = request.Messages.Select(ToOpenAiMessage),
            temperature = request.Temperature,
            max_tokens = request.MaxTokens,
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

        using var response = await _httpClient.PostAsJsonAsync(
            "chat/completions",
            payload,
            cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"{ProviderType} returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }

        using var document = JsonDocument.Parse(body);
        var choice = document.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message");
        var content = choice.TryGetProperty("content", out var contentValue) &&
                      contentValue.ValueKind == JsonValueKind.String
            ? contentValue.GetString() ?? string.Empty
            : string.Empty;
        return new ProviderChatResponse(
            ProviderType,
            model,
            content,
            ParseToolCalls(choice));
    }

    public async Task<IReadOnlyList<string>> FetchModelsAsync(
        CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.GetAsync("models", cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"{ProviderType} returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }

        using var document = JsonDocument.Parse(body);
        if (!document.RootElement.TryGetProperty("data", out var data) ||
            data.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        return data.EnumerateArray()
            .Select(item => item.TryGetProperty("id", out var id) ? id.GetString() : null)
            .Where(id => !string.IsNullOrWhiteSpace(id))
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
            messages = request.Messages.Select(ToOpenAiMessage),
            temperature = request.Temperature,
            max_tokens = request.MaxTokens,
            stream = true,
            tools = request.Tools?.Select(tool => new
            {
                type = "function",
                function = new { name = tool.Name, description = tool.Description, parameters = tool.ParameterSchema },
            }),
        };

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "chat/completions")
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
                $"{ProviderType} returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }

        var calls = new Dictionary<int, StreamingToolCall>();
        var emittedDone = false;
        await foreach (var line in ProviderStreaming.ReadLinesAsync(response, cancellationToken))
        {
            if (!ProviderStreaming.TryGetEventData(line, out var data))
            {
                continue;
            }
            if (data == "[DONE]")
            {
                emittedDone = true;
                yield return new ProviderChatChunk(ProviderType, model, string.Empty, Done: true, ToolCalls: FinishToolCalls(calls));
                break;
            }

            using var document = JsonDocument.Parse(data);
            var choice = document.RootElement.TryGetProperty("choices", out var choices) &&
                         choices.ValueKind == JsonValueKind.Array && choices.GetArrayLength() > 0
                ? choices[0]
                : default;
            if (choice.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (choice.TryGetProperty("message", out var fallbackMessage))
            {
                if (fallbackMessage.TryGetProperty("content", out var fallbackContent) &&
                    fallbackContent.ValueKind == JsonValueKind.String &&
                    !string.IsNullOrEmpty(fallbackContent.GetString()))
                {
                    yield return new ProviderChatChunk(ProviderType, model, fallbackContent.GetString()!, Done: false);
                }
                emittedDone = true;
                yield return new ProviderChatChunk(
                    ProviderType,
                    model,
                    string.Empty,
                    Done: true,
                    ToolCalls: ParseToolCalls(fallbackMessage));
                break;
            }

            if (!choice.TryGetProperty("delta", out var delta))
            {
                continue;
            }

            if (delta.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.String &&
                !string.IsNullOrEmpty(content.GetString()))
            {
                yield return new ProviderChatChunk(ProviderType, model, content.GetString()!, Done: false);
            }
            if (delta.TryGetProperty("tool_calls", out var toolCalls) && toolCalls.ValueKind == JsonValueKind.Array)
            {
                foreach (var toolCall in toolCalls.EnumerateArray())
                {
                    var index = toolCall.TryGetProperty("index", out var indexValue) && indexValue.TryGetInt32(out var parsedIndex)
                        ? parsedIndex
                        : calls.Count;
                    if (!calls.TryGetValue(index, out var accumulator))
                    {
                        accumulator = new StreamingToolCall();
                        calls[index] = accumulator;
                    }
                    if (toolCall.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
                    {
                        accumulator.Id = id.GetString();
                    }
                    if (toolCall.TryGetProperty("function", out var function))
                    {
                        if (function.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String)
                        {
                            accumulator.Name = name.GetString();
                        }
                        if (function.TryGetProperty("arguments", out var arguments) && arguments.ValueKind == JsonValueKind.String)
                        {
                            accumulator.Arguments.Append(arguments.GetString());
                        }
                    }
                }
            }
        }

        if (!emittedDone)
        {
            yield return new ProviderChatChunk(ProviderType, model, string.Empty, Done: true, ToolCalls: FinishToolCalls(calls));
        }
    }

    private static object ToOpenAiMessage(ChatMessage message)
    {
        object content = message.Content;
        if (!string.IsNullOrWhiteSpace(message.ImageDataUrl))
        {
            _ = ProviderImageDataParser.Parse(message.ImageDataUrl);
            content = new object[]
            {
                new { type = "text", text = message.Content },
                new { type = "image_url", image_url = new { url = message.ImageDataUrl } },
            };
        }
        return new
        {
            role = message.Role,
            content,
            tool_call_id = message.ToolCallId,
            name = message.Name,
            tool_calls = message.ToolCalls?.Select(call => new
            {
                id = call.Id,
                type = "function",
                function = new { name = call.Name, arguments = call.Arguments.GetRawText() },
            }),
        };
    }

    private static string NormalizeBaseUrl(string endpoint)
    {
        var value = string.IsNullOrWhiteSpace(endpoint)
            ? "https://api.openai.com/v1"
            : endpoint.TrimEnd('/');
        var marker = value.IndexOf("/chat/completions", StringComparison.OrdinalIgnoreCase);
        if (marker >= 0)
        {
            value = value[..marker];
        }
        return value.TrimEnd('/') + "/";
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
            if (!call.TryGetProperty("function", out var function) ||
                !function.TryGetProperty("name", out var nameValue))
            {
                continue;
            }
            var name = nameValue.GetString();
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            var id = call.TryGetProperty("id", out var idValue)
                ? idValue.GetString()
                : null;
            var rawArguments = function.TryGetProperty("arguments", out var argumentsValue)
                ? argumentsValue
                : default;
            var arguments = rawArguments.ValueKind == JsonValueKind.String
                ? ParseArguments(rawArguments.GetString())
                : rawArguments.Clone();
            result.Add(new ProviderToolCall(
                string.IsNullOrWhiteSpace(id) ? $"openai-call-{index++}" : id,
                name,
                arguments));
        }
        return result;
    }

    private static JsonElement ParseArguments(string? raw)
    {
        if (!string.IsNullOrWhiteSpace(raw))
        {
            try
            {
                using var document = JsonDocument.Parse(raw);
                return document.RootElement.Clone();
            }
            catch (JsonException)
            {
            }
        }
        return JsonSerializer.SerializeToElement(new Dictionary<string, object?>());
    }

    private static string Truncate(string value) =>
        value.Length <= 500 ? value : value[..500] + "...";

    private static IReadOnlyList<ProviderToolCall> FinishToolCalls(Dictionary<int, StreamingToolCall> calls) =>
        calls.OrderBy(pair => pair.Key)
            .Select(pair => pair.Value)
            .Where(call => !string.IsNullOrWhiteSpace(call.Name))
            .Select((call, index) => new ProviderToolCall(
                string.IsNullOrWhiteSpace(call.Id) ? $"openai-stream-call-{index}" : call.Id!,
                call.Name!,
                ParseArguments(call.Arguments.ToString())))
            .ToArray();

    private sealed class StreamingToolCall
    {
        public string? Id { get; set; }
        public string? Name { get; set; }
        public StringBuilder Arguments { get; } = new();
    }
}
