using System.Text.Json;
using System.Text.RegularExpressions;
using WordOllama.Contracts;

namespace WordOllama.Core;

internal static partial class AgentSourceExtractor
{
    public static IReadOnlyList<AgentSource> Extract(string tool, string content)
    {
        if (!IsExternalRetrievalTool(tool) || string.IsNullOrWhiteSpace(content)) return [];
        var sources = new Dictionary<string, AgentSource>(StringComparer.OrdinalIgnoreCase);
        string title = string.Empty;
        try
        {
            using var document = JsonDocument.Parse(content);
            Find(document.RootElement, "", sources, tool, ref title);
        }
        catch (JsonException)
        {
            // MCP tools frequently return text or nested JSON encoded as text.
        }
        foreach (Match match in UrlPattern().Matches(content))
        {
            var url = match.Value.TrimEnd('.', ',', ';', ':', ')', ']', '}', '"', '\'');
            if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
                sources.TryAdd(uri.ToString(), new AgentSource(uri.ToString(), title, tool, DateTimeOffset.UtcNow));
        }
        return sources.Values.Take(50).ToArray();
    }

    private static bool IsExternalRetrievalTool(string tool) =>
        tool.Equals("fetch_url", StringComparison.OrdinalIgnoreCase) ||
        tool.Equals("search_web", StringComparison.OrdinalIgnoreCase) ||
        tool.StartsWith("mcp__", StringComparison.OrdinalIgnoreCase) ||
        tool.Contains("vector", StringComparison.OrdinalIgnoreCase) ||
        tool.Contains("retrieve", StringComparison.OrdinalIgnoreCase) ||
        tool.Contains("search", StringComparison.OrdinalIgnoreCase);

    private static void Find(
        JsonElement element,
        string property,
        Dictionary<string, AgentSource> sources,
        string tool,
        ref string title)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var child in element.EnumerateObject()) Find(child.Value, child.Name, sources, tool, ref title);
                break;
            case JsonValueKind.Array:
                foreach (var child in element.EnumerateArray()) Find(child, property, sources, tool, ref title);
                break;
            case JsonValueKind.String:
                var value = element.GetString() ?? string.Empty;
                if (property.Equals("title", StringComparison.OrdinalIgnoreCase) && value.Length <= 300) title = value;
                if ((property.Contains("url", StringComparison.OrdinalIgnoreCase) || property.Contains("link", StringComparison.OrdinalIgnoreCase)) &&
                    Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
                    sources.TryAdd(uri.ToString(), new AgentSource(uri.ToString(), title, tool, DateTimeOffset.UtcNow));
                break;
        }
    }

    [GeneratedRegex("https?://[^\\s\\\"'<>]+", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex UrlPattern();
}
