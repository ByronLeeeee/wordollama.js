using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;
using WordOllama.Contracts;
using WordOllama.Core;
using WordOllama.Mcp;

namespace WordOllama.DesktopBridge;

public sealed class McpToolExecutor : IInternalToolExecutor
{
    private readonly McpManager _manager;
    private readonly McpSettingsStore _settings;
    private readonly ConcurrentQueue<DateTimeOffset> _searchCalls = new();

    public McpToolExecutor(McpManager manager, McpSettingsStore settings)
    {
        _manager = manager;
        _settings = settings;
    }

    public IReadOnlyList<OfficeToolDescriptor> GetToolDescriptors()
    {
        var descriptors = _manager.GetDiscoveredTools()
            .Where(tool => _settings.IsToolAllowed(tool.ServerName, tool.Name))
            .Where(tool => !IsConfiguredSearchTool(tool.ServerName, tool.Name))
            .Select(tool => new OfficeToolDescriptor(
                $"mcp__{tool.ServerName}__{tool.Name}",
                tool.Description,
                false,
                tool.InputSchema))
            .ToList();
        var search = _settings.GetWebSearchSettings();
        if (search is not null && !string.IsNullOrWhiteSpace(search.SearchToolName) &&
            _settings.IsToolAllowed(search.Name, search.SearchToolName))
        {
            descriptors.Add(new OfficeToolDescriptor(
                "search_web",
                "Search the web through the user-configured MCP provider. Results include bounded content and source metadata, and may be restricted to approved domains.",
                false,
                JsonSerializer.SerializeToElement(new
                {
                    type = "object",
                    properties = new
                    {
                        query = new { type = "string" },
                        max_results = new { type = "integer", minimum = 1, maximum = 20 },
                    },
                    required = new[] { "query" },
                })));
        }
        return descriptors;
    }

    public bool IsKnownTool(string name)
    {
        if (string.Equals(name, "search_web", StringComparison.OrdinalIgnoreCase))
        {
            var search = _settings.GetWebSearchSettings();
            return search is not null && !string.IsNullOrWhiteSpace(search.SearchToolName) &&
                _settings.IsToolAllowed(search.Name, search.SearchToolName);
        }
        return _manager.TryResolve(name, out var serverName, out var toolName) &&
            _settings.IsToolAllowed(serverName, toolName);
    }

    public Task<string> ExecuteAsync(
        string name,
        JsonElement arguments,
        CancellationToken cancellationToken = default)
    {
        if (string.Equals(name, "search_web", StringComparison.OrdinalIgnoreCase))
            return ExecuteWebSearchAsync(arguments, cancellationToken);
        if (!_manager.TryResolve(name, out var serverName, out var toolName) ||
            !_settings.IsToolAllowed(serverName, toolName))
        {
            throw new InvalidOperationException($"MCP tool is not authorized: {name}");
        }

        return _manager.CallToolAsync(
            new McpToolCallRequest(serverName, toolName, arguments),
            cancellationToken);
    }

    private bool IsConfiguredSearchTool(string serverName, string toolName)
    {
        var search = _settings.GetWebSearchSettings();
        return search is not null &&
            string.Equals(search.Name, serverName, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(search.SearchToolName, toolName, StringComparison.OrdinalIgnoreCase);
    }

    private async Task<string> ExecuteWebSearchAsync(JsonElement arguments, CancellationToken cancellationToken)
    {
        var search = _settings.GetWebSearchSettings()
            ?? throw new InvalidOperationException("No web-search MCP is configured.");
        var query = arguments.TryGetProperty("query", out var queryValue) ? queryValue.GetString()?.Trim() : null;
        if (string.IsNullOrWhiteSpace(query) || query.Length > 500)
            throw new ArgumentException("search_web query must contain 1 to 500 characters.");
        var maxResults = arguments.TryGetProperty("max_results", out var maxValue) && maxValue.TryGetInt32(out var requested)
            ? Math.Clamp(requested, 1, 20)
            : 8;
        var cutoff = DateTimeOffset.UtcNow.AddMinutes(-1);
        while (_searchCalls.TryPeek(out var timestamp) && timestamp < cutoff) _searchCalls.TryDequeue(out _);
        if (_searchCalls.Count >= search.SearchMaxCalls)
            throw new InvalidOperationException("search_web call limit reached; try again in one minute.");
        _searchCalls.Enqueue(DateTimeOffset.UtcNow);
        var allowedDomains = search.AllowedDomains ?? [];
        var payload = JsonSerializer.SerializeToElement(new
        {
            query,
            max_results = maxResults,
            allowed_domains = allowedDomains,
        });
        var content = await _manager.CallToolAsync(
            new McpToolCallRequest(search.Name, search.SearchToolName!, payload), cancellationToken);
        content = FilterSources(content, allowedDomains);
        if (content.Length > search.SearchMaxResultCharacters)
            content = content[..search.SearchMaxResultCharacters];
        return JsonSerializer.Serialize(new
        {
            query,
            provider = search.Name,
            tool = search.SearchToolName,
            allowedDomains,
            maxResults,
            content,
        });
    }

    private static string FilterSources(string content, IReadOnlyList<string> allowedDomains)
    {
        if (allowedDomains.Count == 0) return content;
        return Regex.Replace(content, "https://[^\\s\\\"'<>]+", match =>
        {
            if (!Uri.TryCreate(match.Value, UriKind.Absolute, out var uri)) return "[blocked source]";
            return allowedDomains.Any(domain =>
                string.Equals(uri.Host, domain, StringComparison.OrdinalIgnoreCase) ||
                uri.Host.EndsWith("." + domain, StringComparison.OrdinalIgnoreCase))
                ? match.Value
                : "[blocked source]";
        }, RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1));
    }
}
