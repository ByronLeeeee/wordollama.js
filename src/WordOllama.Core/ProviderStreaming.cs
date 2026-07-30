using System.Runtime.CompilerServices;

namespace WordOllama.Core;

internal static class ProviderStreaming
{
    public static async IAsyncEnumerable<string> ReadLinesAsync(
        HttpResponseMessage response,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream);
        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync(cancellationToken);
            if (line is not null)
            {
                yield return line;
            }
        }
    }

    public static bool TryGetEventData(string line, out string data)
    {
        var trimmed = line.Trim();
        if (trimmed.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            data = trimmed[5..].Trim();
            return data.Length > 0;
        }

        if (trimmed.StartsWith("{", StringComparison.Ordinal))
        {
            data = trimmed;
            return true;
        }

        data = string.Empty;
        return false;
    }
}
