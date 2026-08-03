using System.Net;
using System.Net.Http.Json;

namespace WordOllama.Core;

internal static class ProviderHttpRetry
{
    private static readonly HashSet<HttpStatusCode> TransientStatuses =
        [HttpStatusCode.TooManyRequests, HttpStatusCode.BadGateway, HttpStatusCode.ServiceUnavailable, HttpStatusCode.GatewayTimeout];

    public static async Task<HttpResponseMessage> PostAsJsonAsync(
        HttpClient client,
        string url,
        object payload,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            HttpResponseMessage response;
            try
            {
                response = await client.PostAsJsonAsync(url, payload, cancellationToken);
            }
            catch (HttpRequestException) when (attempt < 2 && !cancellationToken.IsCancellationRequested)
            {
                await Task.Delay(Backoff(attempt, null), cancellationToken);
                continue;
            }
            if (attempt >= 2 || !TransientStatuses.Contains(response.StatusCode)) return response;
            var delay = response.Headers.RetryAfter?.Delta;
            response.Dispose();
            await Task.Delay(Backoff(attempt, delay), cancellationToken);
        }
    }

    private static TimeSpan Backoff(int attempt, TimeSpan? retryAfter)
    {
        if (retryAfter is { } requested && requested > TimeSpan.Zero)
            return requested > TimeSpan.FromSeconds(10) ? TimeSpan.FromSeconds(10) : requested;
        return TimeSpan.FromMilliseconds(350 * Math.Pow(2, attempt) + Random.Shared.Next(50, 180));
    }
}
