using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Runtime.CompilerServices;
using WordOllama.Contracts;

namespace WordOllama.Core;

/// <summary>Anthropic Messages API adapter used by the cross-platform bridge.</summary>
public sealed class AnthropicProvider : IModelProvider
{
    private readonly HttpClient _httpClient;
    private readonly string _defaultModel;

    public AnthropicProvider(
        string endpoint,
        string apiKey,
        string defaultModel,
        TimeSpan? timeout = null)
    {
        ProviderType = "Claude";
        _defaultModel = defaultModel;
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri(NormalizeBaseUrl(endpoint), UriKind.Absolute),
            Timeout = timeout ?? TimeSpan.FromMinutes(10),
        };
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            _httpClient.DefaultRequestHeaders.Add("x-api-key", apiKey);
        }
        _httpClient.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
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
        var system = request.Messages
            .Where(message => string.Equals(message.Role, "system", StringComparison.OrdinalIgnoreCase))
            .Select(message => message.Content)
            .Where(content => !string.IsNullOrWhiteSpace(content))
            .ToArray();
        var messages = request.Messages
            .Where(message => !string.Equals(message.Role, "system", StringComparison.OrdinalIgnoreCase))
            .Select(ToAnthropicMessage)
            .ToArray();
        var payload = new Dictionary<string, object?>
        {
            ["model"] = model,
            ["max_tokens"] = request.MaxTokens ?? 4096,
            ["messages"] = messages,
            ["temperature"] = request.Temperature,
        };
        if (system.Length > 0)
        {
            payload["system"] = string.Join("\n\n", system);
        }
        if (request.Tools is { Count: > 0 })
        {
            payload["tools"] = request.Tools.Select(tool => new
            {
                name = tool.Name,
                description = tool.Description,
                input_schema = tool.ParameterSchema,
            }).ToArray();
        }

        using var response = await _httpClient.PostAsJsonAsync("messages", payload, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Claude returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }

        using var document = JsonDocument.Parse(body);
        return ParseResponse(document.RootElement, model);
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
        var system = request.Messages
            .Where(message => string.Equals(message.Role, "system", StringComparison.OrdinalIgnoreCase))
            .Select(message => message.Content)
            .Where(content => !string.IsNullOrWhiteSpace(content))
            .ToArray();
        var messages = request.Messages
            .Where(message => !string.Equals(message.Role, "system", StringComparison.OrdinalIgnoreCase))
            .Select(ToAnthropicMessage)
            .ToArray();
        var payload = new Dictionary<string, object?>
        {
            ["model"] = model,
            ["max_tokens"] = request.MaxTokens ?? 4096,
            ["messages"] = messages,
            ["temperature"] = request.Temperature,
            ["stream"] = true,
        };
        if (system.Length > 0)
        {
            payload["system"] = string.Join("\n\n", system);
        }
        if (request.Tools is { Count: > 0 })
        {
            payload["tools"] = request.Tools.Select(tool => new
            {
                name = tool.Name,
                description = tool.Description,
                input_schema = tool.ParameterSchema,
            }).ToArray();
        }

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "messages")
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
                $"Claude returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }

        var calls = new Dictionary<int, StreamingToolCall>();
        var emittedDone = false;
        await foreach (var line in ProviderStreaming.ReadLinesAsync(response, cancellationToken))
        {
            if (!ProviderStreaming.TryGetEventData(line, out var data) || data == "[DONE]")
            {
                continue;
            }

            using var document = JsonDocument.Parse(data);
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var typeValue) || typeValue.ValueKind != JsonValueKind.String)
            {
                // Some compatible endpoints ignore stream=true and return one normal response.
                var fallback = ParseResponse(root, model);
                if (!string.IsNullOrWhiteSpace(fallback.Content))
                {
                    yield return new ProviderChatChunk(ProviderType, model, fallback.Content, Done: false);
                }
                emittedDone = true;
                yield return new ProviderChatChunk(ProviderType, model, string.Empty, Done: true, ToolCalls: fallback.ToolCalls);
                break;
            }

            switch (typeValue.GetString())
            {
                case "content_block_start":
                    if (root.TryGetProperty("index", out var startIndex) && startIndex.TryGetInt32(out var parsedIndex) &&
                        root.TryGetProperty("content_block", out var block) &&
                        block.TryGetProperty("type", out var blockType) && blockType.GetString() == "tool_use")
                    {
                        var call = new StreamingToolCall
                        {
                            Id = block.TryGetProperty("id", out var id) ? id.GetString() : null,
                            Name = block.TryGetProperty("name", out var name) ? name.GetString() : null,
                        };
                        calls[parsedIndex] = call;
                    }
                    break;
                case "content_block_delta":
                    if (!root.TryGetProperty("delta", out var delta)) break;
                    var deltaType = delta.TryGetProperty("type", out var deltaTypeValue) ? deltaTypeValue.GetString() : null;
                    if (deltaType == "text_delta" && delta.TryGetProperty("text", out var text) &&
                        text.ValueKind == JsonValueKind.String && !string.IsNullOrEmpty(text.GetString()))
                    {
                        yield return new ProviderChatChunk(ProviderType, model, text.GetString()!, Done: false);
                    }
                    else if (deltaType == "input_json_delta" && delta.TryGetProperty("partial_json", out var partial) &&
                             partial.ValueKind == JsonValueKind.String && root.TryGetProperty("index", out var indexValue) &&
                             indexValue.TryGetInt32(out var index) && calls.TryGetValue(index, out var call))
                    {
                        call.Arguments.Append(partial.GetString());
                    }
                    break;
                case "message_stop":
                    emittedDone = true;
                    yield return new ProviderChatChunk(ProviderType, model, string.Empty, Done: true, ToolCalls: FinishToolCalls(calls));
                    break;
            }

            if (emittedDone) break;
        }

        if (!emittedDone)
        {
            yield return new ProviderChatChunk(ProviderType, model, string.Empty, Done: true, ToolCalls: FinishToolCalls(calls));
        }
    }

    private ProviderChatResponse ParseResponse(JsonElement root, string model)
    {
        var content = new List<string>();
        var calls = new List<ProviderToolCall>();
        if (root.TryGetProperty("content", out var blocks) &&
            blocks.ValueKind == JsonValueKind.Array)
        {
            var index = 0;
            foreach (var block in blocks.EnumerateArray())
            {
                var type = block.TryGetProperty("type", out var typeValue)
                    ? typeValue.GetString()
                    : null;
                if (type == "text" && block.TryGetProperty("text", out var text))
                {
                    content.Add(text.GetString() ?? string.Empty);
                }
                else if (type == "tool_use" &&
                         block.TryGetProperty("name", out var nameValue))
                {
                    var name = nameValue.GetString();
                    if (string.IsNullOrWhiteSpace(name))
                    {
                        continue;
                    }
                    var id = block.TryGetProperty("id", out var idValue)
                        ? idValue.GetString()
                        : null;
                    var input = block.TryGetProperty("input", out var inputValue)
                        ? inputValue.Clone()
                        : JsonSerializer.SerializeToElement(new Dictionary<string, object?>());
                    calls.Add(new ProviderToolCall(
                        string.IsNullOrWhiteSpace(id) ? $"claude-call-{index++}" : id,
                        name,
                        input));
                }
            }
        }

        return new ProviderChatResponse(ProviderType, model, string.Join("\n", content), calls);
    }

    private static IReadOnlyList<ProviderToolCall> FinishToolCalls(Dictionary<int, StreamingToolCall> calls) =>
        calls.OrderBy(pair => pair.Key)
            .Select(pair => pair.Value)
            .Where(call => !string.IsNullOrWhiteSpace(call.Name))
            .Select((call, index) => new ProviderToolCall(
                string.IsNullOrWhiteSpace(call.Id) ? $"claude-stream-call-{index}" : call.Id!,
                call.Name!,
                ParseArguments(call.Arguments.ToString())))
            .ToArray();

    private static JsonElement ParseArguments(string raw)
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

    private sealed class StreamingToolCall
    {
        public string? Id { get; set; }
        public string? Name { get; set; }
        public StringBuilder Arguments { get; } = new();
    }

    public async Task<IReadOnlyList<string>> FetchModelsAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.GetAsync("models?limit=1000", cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Claude returned {(int)response.StatusCode}: {Truncate(body)}",
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

    private static object ToAnthropicMessage(ChatMessage message)
    {
        if (string.Equals(message.Role, "tool", StringComparison.OrdinalIgnoreCase))
        {
            return new
            {
                role = "user",
                content = new[]
                {
                    new
                    {
                        type = "tool_result",
                        tool_use_id = message.ToolCallId ?? "unknown-tool-call",
                        content = message.Content,
                    },
                },
            };
        }

        if (string.Equals(message.Role, "assistant", StringComparison.OrdinalIgnoreCase) &&
            message.ToolCalls is { Count: > 0 })
        {
            var blocks = new List<object>();
            if (!string.IsNullOrWhiteSpace(message.Content))
            {
                blocks.Add(new { type = "text", text = message.Content });
            }
            blocks.AddRange(message.ToolCalls.Select(call => new
            {
                type = "tool_use",
                id = call.Id,
                name = call.Name,
                input = call.Arguments,
            }));
            return new { role = "assistant", content = blocks.ToArray() };
        }

        var image = ProviderImageDataParser.Parse(message.ImageDataUrl);
        if (image is not null)
        {
            return new
            {
                role = message.Role,
                content = new object[]
                {
                    new { type = "image", source = new { type = "base64", media_type = image.MediaType, data = image.Base64Data } },
                    new { type = "text", text = message.Content },
                },
            };
        }

        return new { role = message.Role, content = message.Content };
    }

    private static string NormalizeBaseUrl(string endpoint)
    {
        var value = string.IsNullOrWhiteSpace(endpoint)
            ? "https://api.anthropic.com/v1"
            : endpoint.TrimEnd('/');
        var marker = value.IndexOf("/messages", StringComparison.OrdinalIgnoreCase);
        if (marker >= 0)
        {
            value = value[..marker];
        }
        return value.TrimEnd('/') + "/";
    }

    private static string Truncate(string value) => value.Length <= 500 ? value : value[..500] + "...";
}
