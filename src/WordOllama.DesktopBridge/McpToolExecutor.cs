using System.Text.Json;
using WordOllama.Contracts;
using WordOllama.Core;
using WordOllama.Mcp;

namespace WordOllama.DesktopBridge;

public sealed class McpToolExecutor : IInternalToolExecutor
{
    private readonly McpManager _manager;
    private readonly McpSettingsStore _settings;

    public McpToolExecutor(McpManager manager, McpSettingsStore settings)
    {
        _manager = manager;
        _settings = settings;
    }

    public IReadOnlyList<OfficeToolDescriptor> GetToolDescriptors() =>
        _manager.GetDiscoveredTools()
            .Where(tool => _settings.IsToolAllowed(tool.ServerName, tool.Name))
            .Select(tool => new OfficeToolDescriptor(
                $"mcp__{tool.ServerName}__{tool.Name}",
                tool.Description,
                false,
                tool.InputSchema))
            .ToArray();

    public bool IsKnownTool(string name) =>
        _manager.TryResolve(name, out var serverName, out var toolName) &&
        _settings.IsToolAllowed(serverName, toolName);

    public Task<string> ExecuteAsync(
        string name,
        JsonElement arguments,
        CancellationToken cancellationToken = default)
    {
        if (!_manager.TryResolve(name, out var serverName, out var toolName) ||
            !_settings.IsToolAllowed(serverName, toolName))
        {
            throw new InvalidOperationException($"MCP tool is not authorized: {name}");
        }

        return _manager.CallToolAsync(
            new McpToolCallRequest(serverName, toolName, arguments),
            cancellationToken);
    }
}
