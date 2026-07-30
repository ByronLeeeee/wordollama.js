using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using WordOllama.Contracts;

namespace WordOllama.Core;

public sealed class OllamaModelManager
{
    private readonly HttpClient _httpClient;

    public OllamaModelManager(string endpoint, TimeSpan? timeout = null)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttp ||
            uri.Host is not ("127.0.0.1" or "localhost" or "::1"))
        {
            throw new ArgumentException("Ollama model management requires a loopback HTTP endpoint.");
        }
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri(endpoint.TrimEnd('/') + "/", UriKind.Absolute),
            Timeout = timeout ?? Timeout.InfiniteTimeSpan,
        };
    }

    public async IAsyncEnumerable<OllamaModelProgress> PullAsync(
        string model,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        model = ValidateModel(model);
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/pull")
        {
            Content = JsonContent.Create(new { name = model, stream = true }),
        };
        using var response = await _httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream);
        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(line)) continue;
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            var status = root.TryGetProperty("status", out var statusValue)
                ? statusValue.GetString() ?? "pulling"
                : "pulling";
            var digest = root.TryGetProperty("digest", out var digestValue)
                ? digestValue.GetString()
                : null;
            long? completed = root.TryGetProperty("completed", out var completedValue) &&
                              completedValue.TryGetInt64(out var completedNumber)
                ? completedNumber
                : null;
            long? total = root.TryGetProperty("total", out var totalValue) &&
                          totalValue.TryGetInt64(out var totalNumber)
                ? totalNumber
                : null;
            var done = string.Equals(status, "success", StringComparison.OrdinalIgnoreCase);
            yield return new OllamaModelProgress(status, digest, completed, total, done);
        }
    }

    public async Task DeleteAsync(string model, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, "api/delete")
        {
            Content = JsonContent.Create(new { name = ValidateModel(model) }),
        };
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task LoadAsync(string model, CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.PostAsJsonAsync(
            "api/generate",
            new { model = ValidateModel(model), prompt = string.Empty, stream = false, keep_alive = "5m" },
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<IReadOnlyList<string>> GetRunningModelsAsync(
        CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.GetAsync("api/ps", cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        using var document = JsonDocument.Parse(
            await response.Content.ReadAsStringAsync(cancellationToken));
        if (!document.RootElement.TryGetProperty("models", out var models) ||
            models.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return models.EnumerateArray()
            .Select(model =>
                model.TryGetProperty("name", out var name) ? name.GetString() :
                model.TryGetProperty("model", out var value) ? value.GetString() :
                null)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string ValidateModel(string model)
    {
        model = model.Trim();
        if (model.Length is < 1 or > 200 ||
            model.Any(character => char.IsControl(character) || char.IsWhiteSpace(character)))
        {
            throw new ArgumentException("Ollama model name is invalid.");
        }
        return model;
    }

    private static async Task EnsureSuccessAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode) return;
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        throw new HttpRequestException(
            $"Ollama returned {(int)response.StatusCode}: {body[..Math.Min(body.Length, 500)]}",
            null,
            response.StatusCode);
    }
}
