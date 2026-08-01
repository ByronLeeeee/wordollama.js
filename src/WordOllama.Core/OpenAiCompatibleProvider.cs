using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using WordOllama.Contracts;

namespace WordOllama.Core;

/// <summary>
/// Client for OpenAI-compatible endpoints. Native OpenAI endpoints can use the
/// Responses API while other OpenAI-compatible servers continue to use Chat Completions.
/// Both protocols are normalized to the Bridge provider contracts.
/// </summary>
public sealed class OpenAiCompatibleProvider : IModelProvider
{
    private readonly HttpClient _httpClient;
    private readonly string _defaultModel;
    private readonly string _apiMode;
    private readonly bool _nativeOpenAiEndpoint;

    public OpenAiCompatibleProvider(
        string endpoint,
        string apiKey,
        string defaultModel,
        string providerType = "OpenAI",
        TimeSpan? timeout = null,
        string apiMode = "Auto",
        HttpMessageHandler? httpMessageHandler = null)
    {
        ProviderType = providerType;
        _apiMode = NormalizeApiMode(apiMode);
        _defaultModel = defaultModel;
        _nativeOpenAiEndpoint = IsNativeOpenAiEndpoint(endpoint);
        _httpClient = httpMessageHandler is null
            ? new HttpClient(new SocketsHttpHandler { ConnectTimeout = TimeSpan.FromSeconds(5) })
            : new HttpClient(httpMessageHandler);
        _httpClient.BaseAddress = new Uri(NormalizeBaseUrl(endpoint), UriKind.Absolute);
        _httpClient.Timeout = timeout ?? TimeSpan.FromMinutes(10);
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", apiKey);
        }
    }

    public string ProviderType { get; }

    private bool UsesResponses =>
        _apiMode == "Responses" ||
        (_apiMode == "Auto" &&
         string.Equals(ProviderType, "OpenAI", StringComparison.OrdinalIgnoreCase) &&
         _nativeOpenAiEndpoint);

    public async Task<ProviderChatResponse> ChatAsync(
        ProviderChatRequest request,
        CancellationToken cancellationToken = default)
    {
        ValidateRequest(request);
        var model = ResolveModel(request);
        return UsesResponses
            ? await ChatResponsesAsync(request, model, cancellationToken)
            : await ChatCompletionsAsync(request, model, cancellationToken);
    }

    public async Task<IReadOnlyList<string>> FetchModelsAsync(
        CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.GetAsync("models", cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        EnsureSuccess(response, body);

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
        ValidateRequest(request);
        var model = ResolveModel(request);
        if (UsesResponses)
        {
            await foreach (var chunk in ResponsesStreamAsync(request, model, cancellationToken))
            {
                yield return chunk;
            }
            yield break;
        }

        await foreach (var chunk in ChatCompletionsStreamAsync(request, model, cancellationToken))
        {
            yield return chunk;
        }
    }

    private async Task<ProviderChatResponse> ChatCompletionsAsync(
        ProviderChatRequest request,
        string model,
        CancellationToken cancellationToken)
    {
        var payload = new Dictionary<string, object?>
        {
            ["model"] = model,
            ["messages"] = request.Messages.Select(ToChatMessage).ToArray(),
        };
        AddCommonChatOptions(payload, request);

        using var response = await _httpClient.PostAsJsonAsync(
            "chat/completions",
            payload,
            cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        EnsureSuccess(response, body);

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
            ParseChatToolCalls(choice));
    }

    private async Task<ProviderChatResponse> ChatResponsesAsync(
        ProviderChatRequest request,
        string model,
        CancellationToken cancellationToken)
    {
        using var response = await _httpClient.PostAsJsonAsync(
            "responses",
            BuildResponsesPayload(request, model),
            cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        EnsureSuccess(response, body);

        using var document = JsonDocument.Parse(body);
        var (content, toolCalls) = ParseResponsesResult(document.RootElement);
        return new ProviderChatResponse(ProviderType, model, content, toolCalls);
    }

    private async IAsyncEnumerable<ProviderChatChunk> ChatCompletionsStreamAsync(
        ProviderChatRequest request,
        string model,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var payload = new Dictionary<string, object?>
        {
            ["model"] = model,
            ["messages"] = request.Messages.Select(ToChatMessage).ToArray(),
            ["stream"] = true,
        };
        AddCommonChatOptions(payload, request);

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
            EnsureSuccess(response, body);
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
                yield return new ProviderChatChunk(
                    ProviderType,
                    model,
                    string.Empty,
                    Done: true,
                    ToolCalls: FinishToolCalls(calls));
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
                    yield return new ProviderChatChunk(
                        ProviderType,
                        model,
                        fallbackContent.GetString()!,
                        Done: false);
                }
                emittedDone = true;
                yield return new ProviderChatChunk(
                    ProviderType,
                    model,
                    string.Empty,
                    Done: true,
                    ToolCalls: ParseChatToolCalls(fallbackMessage));
                break;
            }

            if (!choice.TryGetProperty("delta", out var delta))
            {
                continue;
            }

            if (delta.TryGetProperty("content", out var content) &&
                content.ValueKind == JsonValueKind.String &&
                !string.IsNullOrEmpty(content.GetString()))
            {
                yield return new ProviderChatChunk(
                    ProviderType,
                    model,
                    content.GetString()!,
                    Done: false);
            }
            if (delta.TryGetProperty("tool_calls", out var toolCalls) &&
                toolCalls.ValueKind == JsonValueKind.Array)
            {
                foreach (var toolCall in toolCalls.EnumerateArray())
                {
                    var index = toolCall.TryGetProperty("index", out var indexValue) &&
                                indexValue.TryGetInt32(out var parsedIndex)
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
            yield return new ProviderChatChunk(
                ProviderType,
                model,
                string.Empty,
                Done: true,
                ToolCalls: FinishToolCalls(calls));
        }
    }

    private async IAsyncEnumerable<ProviderChatChunk> ResponsesStreamAsync(
        ProviderChatRequest request,
        string model,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var payload = BuildResponsesPayload(request, model, stream: true);
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "responses")
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
            EnsureSuccess(response, body);
        }

        var calls = new Dictionary<string, StreamingToolCall>(StringComparer.Ordinal);
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
                yield return CreateResponsesDoneChunk(model, calls);
                break;
            }

            using var document = JsonDocument.Parse(data);
            var root = document.RootElement;
            var type = root.TryGetProperty("type", out var typeValue)
                ? typeValue.GetString()
                : null;
            switch (type)
            {
                case "response.output_text.delta":
                    if (root.TryGetProperty("delta", out var delta) &&
                        delta.ValueKind == JsonValueKind.String &&
                        !string.IsNullOrEmpty(delta.GetString()))
                    {
                        yield return new ProviderChatChunk(
                            ProviderType,
                            model,
                            delta.GetString()!,
                            Done: false);
                    }
                    break;

                case "response.output_item.added":
                case "response.output_item.done":
                    if (root.TryGetProperty("item", out var item))
                    {
                        CaptureResponsesToolCall(item, calls);
                    }
                    break;

                case "response.function_call_arguments.delta":
                    CaptureResponsesArgumentsDelta(root, calls);
                    break;

                case "response.function_call_arguments.done":
                    CaptureResponsesArgumentsDone(root, calls);
                    break;

                case "response.completed":
                    if (root.TryGetProperty("response", out var completedResponse) &&
                        completedResponse.TryGetProperty("output", out var output))
                    {
                        foreach (var outputItem in output.EnumerateArray())
                        {
                            CaptureResponsesToolCall(outputItem, calls);
                        }
                    }
                    emittedDone = true;
                    yield return CreateResponsesDoneChunk(model, calls);
                    break;

                case "response.failed":
                case "response.incomplete":
                case "error":
                    throw new HttpRequestException(
                        $"{ProviderType} Responses stream failed: {ExtractErrorMessage(root)}");
            }

            if (emittedDone)
            {
                break;
            }
        }

        if (!emittedDone)
        {
            yield return CreateResponsesDoneChunk(model, calls);
        }
    }

    private static Dictionary<string, object?> BuildResponsesPayload(
        ProviderChatRequest request,
        string model,
        bool stream = false)
    {
        var payload = new Dictionary<string, object?>
        {
            ["model"] = model,
            ["input"] = request.Messages
                .Where(message => !IsInstructionRole(message.Role) &&
                                  !string.Equals(message.Role, "tool", StringComparison.OrdinalIgnoreCase))
                .Select(ToResponsesInput)
                .ToArray(),
        };
        var instructions = string.Join(
            "\n\n",
            request.Messages
                .Where(message => IsInstructionRole(message.Role))
                .Select(message => message.Content)
                .Where(content => !string.IsNullOrWhiteSpace(content)));
        if (!string.IsNullOrWhiteSpace(instructions))
        {
            payload["instructions"] = instructions;
        }

        var toolOutputs = request.Messages
            .Where(message => string.Equals(message.Role, "tool", StringComparison.OrdinalIgnoreCase))
            .Select(ToResponsesToolOutput)
            .ToArray();
        if (toolOutputs.Length > 0)
        {
            payload["input"] = payload["input"] is object[] existing
                ? existing.Concat(toolOutputs).ToArray()
                : toolOutputs;
        }
        if (request.Temperature.HasValue)
        {
            payload["temperature"] = request.Temperature.Value;
        }
        if (request.MaxTokens.HasValue)
        {
            payload["max_output_tokens"] = request.MaxTokens.Value;
        }
        if (stream)
        {
            payload["stream"] = true;
        }
        if (request.Tools is { Count: > 0 })
        {
            payload["tools"] = request.Tools.Select(tool => new
            {
                type = "function",
                name = tool.Name,
                description = tool.Description,
                parameters = tool.ParameterSchema,
            }).ToArray();
        }
        return payload;
    }

    private static object ToResponsesInput(ChatMessage message)
    {
        var content = new List<object>();
        if (!string.IsNullOrEmpty(message.Content))
        {
            content.Add(new { type = "input_text", text = message.Content });
        }
        if (!string.IsNullOrWhiteSpace(message.ImageDataUrl))
        {
            _ = ProviderImageDataParser.Parse(message.ImageDataUrl);
            content.Add(new { type = "input_image", image_url = message.ImageDataUrl });
        }
        if (content.Count == 0)
        {
            content.Add(new { type = "input_text", text = string.Empty });
        }
        return new
        {
            role = NormalizeMessageRole(message.Role),
            content = content.ToArray(),
        };
    }

    private static object ToResponsesToolOutput(ChatMessage message) => new
    {
        type = "function_call_output",
        call_id = message.ToolCallId ?? string.Empty,
        output = message.Content,
    };

    private static object ToChatMessage(ChatMessage message)
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

    private static void AddCommonChatOptions(
        IDictionary<string, object?> payload,
        ProviderChatRequest request)
    {
        if (request.Temperature.HasValue) payload["temperature"] = request.Temperature.Value;
        if (request.MaxTokens.HasValue) payload["max_tokens"] = request.MaxTokens.Value;
        if (request.Tools is { Count: > 0 })
        {
            payload["tools"] = request.Tools.Select(tool => new
            {
                type = "function",
                function = new
                {
                    name = tool.Name,
                    description = tool.Description,
                    parameters = tool.ParameterSchema,
                },
            }).ToArray();
        }
    }

    private static (string Content, IReadOnlyList<ProviderToolCall> ToolCalls) ParseResponsesResult(JsonElement root)
    {
        var content = root.TryGetProperty("output_text", out var outputText) &&
                      outputText.ValueKind == JsonValueKind.String
            ? outputText.GetString() ?? string.Empty
            : string.Empty;
        var calls = new List<ProviderToolCall>();
        if (root.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
        {
            var textParts = new List<string>();
            foreach (var item in output.EnumerateArray())
            {
                if (item.TryGetProperty("type", out var type) &&
                    type.GetString() == "function_call")
                {
                    AddResponsesToolCall(item, calls);
                    continue;
                }
                if (!item.TryGetProperty("content", out var itemContent) ||
                    itemContent.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }
                foreach (var part in itemContent.EnumerateArray())
                {
                    if (part.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String)
                    {
                        textParts.Add(text.GetString() ?? string.Empty);
                    }
                }
            }
            if (string.IsNullOrEmpty(content))
            {
                content = string.Join(string.Empty, textParts);
            }
        }
        return (content, calls);
    }

    private static void CaptureResponsesToolCall(
        JsonElement item,
        IDictionary<string, StreamingToolCall> calls)
    {
        if (!item.TryGetProperty("type", out var type) || type.GetString() != "function_call")
        {
            return;
        }
        var callId = GetString(item, "call_id");
        var itemId = GetString(item, "id");
        var id = callId ?? itemId ?? $"response-call-{calls.Count}";
        var call = calls.Values.FirstOrDefault(existing =>
            (!string.IsNullOrWhiteSpace(callId) && string.Equals(existing.Id, callId, StringComparison.Ordinal)) ||
            (!string.IsNullOrWhiteSpace(itemId) && string.Equals(existing.ItemId, itemId, StringComparison.Ordinal)));
        if (call is null)
        {
            call = new StreamingToolCall { Id = id };
            calls[id] = call;
        }
        if (!string.IsNullOrWhiteSpace(callId)) call.Id = callId;
        if (!string.IsNullOrWhiteSpace(itemId)) call.ItemId = itemId;
        call.Name ??= GetString(item, "name");
        if (item.TryGetProperty("arguments", out var arguments) && arguments.ValueKind == JsonValueKind.String)
        {
            call.Arguments.Clear();
            call.Arguments.Append(arguments.GetString());
        }
    }

    private static void CaptureResponsesArgumentsDelta(
        JsonElement root,
        IDictionary<string, StreamingToolCall> calls)
    {
        var callId = GetString(root, "call_id");
        var itemId = GetString(root, "item_id");
        var id = callId ?? itemId ?? $"response-call-{calls.Count}";
        var call = calls.Values.FirstOrDefault(existing =>
            (!string.IsNullOrWhiteSpace(callId) && string.Equals(existing.Id, callId, StringComparison.Ordinal)) ||
            (!string.IsNullOrWhiteSpace(itemId) && string.Equals(existing.ItemId, itemId, StringComparison.Ordinal)));
        if (call is null)
        {
            call = new StreamingToolCall { Id = id };
            calls[id] = call;
        }
        if (!string.IsNullOrWhiteSpace(callId)) call.Id = callId;
        if (!string.IsNullOrWhiteSpace(itemId)) call.ItemId = itemId;
        if (root.TryGetProperty("delta", out var delta) && delta.ValueKind == JsonValueKind.String)
        {
            call.Arguments.Append(delta.GetString());
        }
    }

    private static void CaptureResponsesArgumentsDone(
        JsonElement root,
        IDictionary<string, StreamingToolCall> calls)
    {
        var callId = GetString(root, "call_id");
        var itemId = GetString(root, "item_id");
        var id = callId ?? itemId ?? $"response-call-{calls.Count}";
        var call = calls.Values.FirstOrDefault(existing =>
            (!string.IsNullOrWhiteSpace(callId) && string.Equals(existing.Id, callId, StringComparison.Ordinal)) ||
            (!string.IsNullOrWhiteSpace(itemId) && string.Equals(existing.ItemId, itemId, StringComparison.Ordinal)));
        if (call is null)
        {
            call = new StreamingToolCall { Id = id };
            calls[id] = call;
        }
        if (!string.IsNullOrWhiteSpace(callId)) call.Id = callId;
        if (!string.IsNullOrWhiteSpace(itemId)) call.ItemId = itemId;
        if (root.TryGetProperty("arguments", out var arguments) && arguments.ValueKind == JsonValueKind.String)
        {
            call.Arguments.Clear();
            call.Arguments.Append(arguments.GetString());
        }
    }

    private static void AddResponsesToolCall(
        JsonElement item,
        ICollection<ProviderToolCall> calls)
    {
        var name = GetString(item, "name");
        if (string.IsNullOrWhiteSpace(name)) return;
        var id = GetString(item, "call_id") ?? GetString(item, "id") ?? $"openai-call-{calls.Count}";
        var arguments = item.TryGetProperty("arguments", out var rawArguments) &&
                        rawArguments.ValueKind == JsonValueKind.String
            ? ParseArguments(rawArguments.GetString())
            : JsonSerializer.SerializeToElement(new Dictionary<string, object?>());
        calls.Add(new ProviderToolCall(id, name, arguments));
    }

    private static IReadOnlyList<ProviderToolCall> ParseChatToolCalls(JsonElement message)
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
            if (string.IsNullOrWhiteSpace(name)) continue;
            var id = call.TryGetProperty("id", out var idValue) ? idValue.GetString() : null;
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

    private static IReadOnlyList<ProviderToolCall> FinishToolCalls(
        IDictionary<int, StreamingToolCall> calls) =>
        calls.OrderBy(pair => pair.Key)
            .Select(pair => pair.Value)
            .Where(call => !string.IsNullOrWhiteSpace(call.Name))
            .Select((call, index) => new ProviderToolCall(
                string.IsNullOrWhiteSpace(call.Id) ? $"openai-stream-call-{index}" : call.Id!,
                call.Name!,
                ParseArguments(call.Arguments.ToString())))
            .ToArray();

    private ProviderChatChunk CreateResponsesDoneChunk(
        string model,
        IDictionary<string, StreamingToolCall> calls) => new(
        ProviderType,
        model,
        string.Empty,
        Done: true,
        ToolCalls: calls.Values
            .Where(call => !string.IsNullOrWhiteSpace(call.Name))
            .Select((call, index) => new ProviderToolCall(
                string.IsNullOrWhiteSpace(call.Id) ? $"openai-response-call-{index}" : call.Id!,
                call.Name!,
                ParseArguments(call.Arguments.ToString())))
            .ToArray());

    private static string NormalizeBaseUrl(string endpoint)
    {
        var value = string.IsNullOrWhiteSpace(endpoint)
            ? "https://api.openai.com/v1"
            : endpoint.TrimEnd('/');
        foreach (var suffix in new[] { "/chat/completions", "/responses" })
        {
            var marker = value.IndexOf(suffix, StringComparison.OrdinalIgnoreCase);
            if (marker >= 0)
            {
                value = value[..marker];
            }
        }
        return value.TrimEnd('/') + "/";
    }

    private static bool IsNativeOpenAiEndpoint(string endpoint)
    {
        return Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) &&
               string.Equals(uri.Host, "api.openai.com", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeApiMode(string? value) =>
        value?.Trim().ToLowerInvariant() switch
        {
            "responses" => "Responses",
            "chatcompletions" or "chat-completions" or "chat_completions" => "ChatCompletions",
            _ => "Auto",
        };

    private static void ValidateRequest(ProviderChatRequest request)
    {
        if (request.Messages.Count == 0)
        {
            throw new ArgumentException("At least one chat message is required.", nameof(request));
        }
    }

    private string ResolveModel(ProviderChatRequest request) =>
        string.IsNullOrWhiteSpace(request.Model) ? _defaultModel : request.Model;

    private void EnsureSuccess(HttpResponseMessage response, string body)
    {
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"{ProviderType} returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }
    }

    private static bool IsInstructionRole(string role) =>
        string.Equals(role, "system", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(role, "developer", StringComparison.OrdinalIgnoreCase);

    private static string NormalizeMessageRole(string role) =>
        string.Equals(role, "assistant", StringComparison.OrdinalIgnoreCase) ? "assistant" : "user";

    private static string? GetString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string ExtractErrorMessage(JsonElement root)
    {
        if (root.TryGetProperty("error", out var error))
        {
            if (error.ValueKind == JsonValueKind.String) return error.GetString() ?? "Unknown error";
            if (error.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.String)
            {
                return message.GetString() ?? "Unknown error";
            }
        }
        return GetString(root, "status") ?? "Unknown error";
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

    private sealed class StreamingToolCall
    {
        public string? Id { get; set; }
        public string? ItemId { get; set; }
        public string? Name { get; set; }
        public StringBuilder Arguments { get; } = new();
    }
}
