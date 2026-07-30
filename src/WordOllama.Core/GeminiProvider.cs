using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Runtime.CompilerServices;
using WordOllama.Contracts;

namespace WordOllama.Core;

/// <summary>Google Gemini generateContent adapter with function-calling support.</summary>
public sealed class GeminiProvider : IModelProvider
{
    private readonly HttpClient _httpClient;
    private readonly string _apiKey;
    private readonly GoogleOAuthCredential? _oauthCredential;
    private readonly SemaphoreSlim _oauthGate = new(1, 1);
    private readonly string _defaultModel;
    private string _accessToken;
    private DateTimeOffset _accessTokenExpiresAt;

    public GeminiProvider(
        string endpoint,
        string apiKey,
        string defaultModel,
        TimeSpan? timeout = null,
        HttpMessageHandler? messageHandler = null)
    {
        ProviderType = "Gemini";
        if (GoogleOAuthCredentialCodec.TryDecode(apiKey, out var oauthCredential))
        {
            _oauthCredential = oauthCredential;
            _apiKey = string.Empty;
            _accessToken = oauthCredential!.AccessToken;
            _accessTokenExpiresAt = oauthCredential.ExpiresAt;
        }
        else
        {
            _apiKey = apiKey;
            _accessToken = string.Empty;
        }
        _defaultModel = defaultModel;
        _httpClient = messageHandler is null
            ? new HttpClient()
            : new HttpClient(messageHandler, disposeHandler: true);
        _httpClient.BaseAddress = new Uri(NormalizeBaseUrl(endpoint), UriKind.Absolute);
        _httpClient.Timeout = timeout ?? TimeSpan.FromMinutes(10);
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
        var payload = new Dictionary<string, object?>
        {
            ["contents"] = request.Messages
                .Where(message => !string.Equals(message.Role, "system", StringComparison.OrdinalIgnoreCase))
                .Select(ToGeminiContent)
                .ToArray(),
            ["generationConfig"] = new
            {
                temperature = request.Temperature,
                maxOutputTokens = request.MaxTokens,
            },
        };
        if (system.Length > 0)
        {
            payload["systemInstruction"] = new
            {
                parts = system.Select(text => new { text }).ToArray(),
            };
        }
        if (request.Tools is { Count: > 0 })
        {
            payload["tools"] = new[]
            {
                new
                {
                    function_declarations = request.Tools.Select(tool => new
                    {
                        name = tool.Name,
                        description = tool.Description,
                        parameters = tool.ParameterSchema,
                    }).ToArray(),
                },
            };
        }

        var path = $"models/{Uri.EscapeDataString(model)}:generateContent";
        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            path += $"?key={Uri.EscapeDataString(_apiKey)}";
        }
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(payload),
        };
        await ApplyAuthenticationAsync(httpRequest, cancellationToken);
        using var response = await _httpClient.SendAsync(httpRequest, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Gemini returned {(int)response.StatusCode}: {Truncate(body)}",
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
        var payload = new Dictionary<string, object?>
        {
            ["contents"] = request.Messages
                .Where(message => !string.Equals(message.Role, "system", StringComparison.OrdinalIgnoreCase))
                .Select(ToGeminiContent)
                .ToArray(),
            ["generationConfig"] = new
            {
                temperature = request.Temperature,
                maxOutputTokens = request.MaxTokens,
            },
        };
        if (system.Length > 0)
        {
            payload["systemInstruction"] = new { parts = system.Select(text => new { text }).ToArray() };
        }
        if (request.Tools is { Count: > 0 })
        {
            payload["tools"] = new[]
            {
                new
                {
                    function_declarations = request.Tools.Select(tool => new
                    {
                        name = tool.Name,
                        description = tool.Description,
                        parameters = tool.ParameterSchema,
                    }).ToArray(),
                },
            };
        }

        var path = $"models/{Uri.EscapeDataString(model)}:streamGenerateContent?alt=sse";
        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            path += $"&key={Uri.EscapeDataString(_apiKey)}";
        }
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(payload),
        };
        await ApplyAuthenticationAsync(httpRequest, cancellationToken);
        using var response = await _httpClient.SendAsync(
            httpRequest,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException(
                $"Gemini returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }

        var calls = new List<ProviderToolCall>();
        await foreach (var line in ProviderStreaming.ReadLinesAsync(response, cancellationToken))
        {
            if (!ProviderStreaming.TryGetEventData(line, out var data) || data == "[DONE]")
            {
                continue;
            }

            using var document = JsonDocument.Parse(data);
            var root = document.RootElement;
            if (!root.TryGetProperty("candidates", out var candidates) ||
                candidates.ValueKind != JsonValueKind.Array || candidates.GetArrayLength() == 0 ||
                !candidates[0].TryGetProperty("content", out var content) ||
                !content.TryGetProperty("parts", out var parts) || parts.ValueKind != JsonValueKind.Array)
            {
                var fallback = ParseResponse(root, model);
                if (!string.IsNullOrWhiteSpace(fallback.Content))
                {
                    yield return new ProviderChatChunk(ProviderType, model, fallback.Content, Done: false);
                }
                yield return new ProviderChatChunk(ProviderType, model, string.Empty, Done: true, ToolCalls: fallback.ToolCalls);
                yield break;
            }

            foreach (var part in parts.EnumerateArray())
            {
                if (part.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String &&
                    !string.IsNullOrEmpty(text.GetString()))
                {
                    yield return new ProviderChatChunk(ProviderType, model, text.GetString()!, Done: false);
                }
                if (part.TryGetProperty("functionCall", out var functionCall) &&
                    functionCall.TryGetProperty("name", out var nameValue) && nameValue.ValueKind == JsonValueKind.String)
                {
                    var name = nameValue.GetString();
                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        var args = functionCall.TryGetProperty("args", out var argsValue)
                            ? argsValue.Clone()
                            : JsonSerializer.SerializeToElement(new Dictionary<string, object?>());
                        calls.Add(new ProviderToolCall($"gemini-stream-call-{calls.Count}", name, args));
                    }
                }
            }
        }

        yield return new ProviderChatChunk(ProviderType, model, string.Empty, Done: true, ToolCalls: calls);
    }

    private ProviderChatResponse ParseResponse(JsonElement root, string model)
    {
        var textParts = new List<string>();
        var calls = new List<ProviderToolCall>();
        if (root.TryGetProperty("candidates", out var candidates) &&
            candidates.ValueKind == JsonValueKind.Array && candidates.GetArrayLength() > 0 &&
            candidates[0].TryGetProperty("content", out var candidateContent) &&
            candidateContent.TryGetProperty("parts", out var parts) &&
            parts.ValueKind == JsonValueKind.Array)
        {
            var index = 0;
            foreach (var part in parts.EnumerateArray())
            {
                if (part.TryGetProperty("text", out var text))
                {
                    textParts.Add(text.GetString() ?? string.Empty);
                }
                if (part.TryGetProperty("functionCall", out var functionCall) &&
                    functionCall.TryGetProperty("name", out var nameValue))
                {
                    var name = nameValue.GetString();
                    if (string.IsNullOrWhiteSpace(name))
                    {
                        continue;
                    }
                    var args = functionCall.TryGetProperty("args", out var argsValue)
                        ? argsValue.Clone()
                        : JsonSerializer.SerializeToElement(new Dictionary<string, object?>());
                    calls.Add(new ProviderToolCall($"gemini-call-{index++}", name, args));
                }
            }
        }

        return new ProviderChatResponse(ProviderType, model, string.Join("\n", textParts), calls);
    }

    public async Task<IReadOnlyList<string>> FetchModelsAsync(CancellationToken cancellationToken = default)
    {
        var path = "models";
        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            path += $"?key={Uri.EscapeDataString(_apiKey)}";
        }
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        await ApplyAuthenticationAsync(request, cancellationToken);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Gemini returned {(int)response.StatusCode}: {Truncate(body)}",
                null,
                response.StatusCode);
        }
        using var document = JsonDocument.Parse(body);
        if (!document.RootElement.TryGetProperty("models", out var models) ||
            models.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }
        return models.EnumerateArray()
            .Where(model => !model.TryGetProperty("supportedGenerationMethods", out var methods) ||
                            methods.EnumerateArray().Any(method => method.GetString() == "generateContent"))
            .Select(model => model.TryGetProperty("name", out var name) ? name.GetString() : null)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!.StartsWith("models/", StringComparison.OrdinalIgnoreCase)
                ? name[7..]
                : name)
            .ToArray();
    }

    private static object ToGeminiContent(ChatMessage message)
    {
        var role = string.Equals(message.Role, "assistant", StringComparison.OrdinalIgnoreCase)
            ? "model"
            : "user";
        var parts = new List<object>();
        if (!string.IsNullOrWhiteSpace(message.Content))
        {
            parts.Add(new { text = message.Content });
        }
        var image = ProviderImageDataParser.Parse(message.ImageDataUrl);
        if (image is not null)
        {
            parts.Add(new
            {
                inlineData = new
                {
                    mimeType = image.MediaType,
                    data = image.Base64Data,
                },
            });
        }
        if (message.ToolCalls is { Count: > 0 })
        {
            parts.AddRange(message.ToolCalls.Select(call => new
            {
                functionCall = new { name = call.Name, args = call.Arguments },
            }));
        }
        if (string.Equals(message.Role, "tool", StringComparison.OrdinalIgnoreCase))
        {
            role = "user";
            parts.Clear();
            parts.Add(new
            {
                functionResponse = new
                {
                    name = message.Name ?? "tool",
                    response = ParseToolResponse(message.Content),
                },
            });
        }
        return new { role, parts = parts.ToArray() };
    }

    private static JsonElement ParseToolResponse(string content)
    {
        try
        {
            using var document = JsonDocument.Parse(content);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return JsonSerializer.SerializeToElement(new { result = content });
        }
    }

    private static string NormalizeBaseUrl(string endpoint)
    {
        var value = string.IsNullOrWhiteSpace(endpoint)
            ? "https://generativelanguage.googleapis.com/v1beta"
            : endpoint.TrimEnd('/');
        var marker = value.IndexOf("/models/", StringComparison.OrdinalIgnoreCase);
        if (marker >= 0)
        {
            value = value[..marker];
        }
        return value.TrimEnd('/') + "/";
    }

    private static string Truncate(string value) => value.Length <= 500 ? value : value[..500] + "...";

    private async Task ApplyAuthenticationAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        if (_oauthCredential is null) return;
        var accessToken = await GetOAuthAccessTokenAsync(cancellationToken);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        if (!string.IsNullOrWhiteSpace(_oauthCredential.QuotaProject))
        {
            request.Headers.TryAddWithoutValidation(
                "x-goog-user-project",
                _oauthCredential.QuotaProject);
        }
    }

    private async Task<string> GetOAuthAccessTokenAsync(CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(_accessToken) &&
            _accessTokenExpiresAt > DateTimeOffset.UtcNow.AddMinutes(1))
        {
            return _accessToken;
        }

        await _oauthGate.WaitAsync(cancellationToken);
        try
        {
            if (!string.IsNullOrWhiteSpace(_accessToken) &&
                _accessTokenExpiresAt > DateTimeOffset.UtcNow.AddMinutes(1))
            {
                return _accessToken;
            }
            if (string.IsNullOrWhiteSpace(_oauthCredential?.RefreshToken))
            {
                throw new InvalidOperationException(
                    "Google OAuth access token expired and no refresh token is available. Sign in again.");
            }

            var fields = new List<KeyValuePair<string, string>>
            {
                new("client_id", _oauthCredential.ClientId),
                new("refresh_token", _oauthCredential.RefreshToken),
                new("grant_type", "refresh_token"),
            };
            if (!string.IsNullOrWhiteSpace(_oauthCredential.ClientSecret))
            {
                fields.Add(new("client_secret", _oauthCredential.ClientSecret));
            }
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                "https://oauth2.googleapis.com/token")
            {
                Content = new FormUrlEncodedContent(fields),
            };
            using var response = await _httpClient.SendAsync(request, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new HttpRequestException(
                    $"Google OAuth token refresh failed ({(int)response.StatusCode}): {Truncate(body)}",
                    null,
                    response.StatusCode);
            }

            using var document = JsonDocument.Parse(body);
            _accessToken = document.RootElement.GetProperty("access_token").GetString()
                ?? throw new JsonException("Google OAuth response did not contain access_token.");
            var expiresIn = document.RootElement.TryGetProperty("expires_in", out var expiresValue) &&
                            expiresValue.TryGetInt32(out var parsedExpires)
                ? parsedExpires
                : 3600;
            _accessTokenExpiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(60, expiresIn));
            return _accessToken;
        }
        finally
        {
            _oauthGate.Release();
        }
    }
}
