using System.Text.Json;
using WordOllama.Contracts;

namespace WordOllama.Core;

/// <summary>Compatibility command boundary for the cross-platform runtime.</summary>
public interface IAgentRuntime
{
    IReadOnlyList<string> Capabilities { get; }

    IAsyncEnumerable<RuntimeEvent> ExecuteAsync(
        CommandRequest request,
        CancellationToken cancellationToken = default);
}

public sealed class AgentRuntime : IAgentRuntime
{
    private readonly IModelProvider _provider;
    private readonly IReadOnlyList<IInternalToolExecutor> _internalTools;

    public AgentRuntime(IModelProvider provider, IEnumerable<IInternalToolExecutor> internalTools)
    {
        _provider = provider;
        _internalTools = internalTools.ToArray();
    }

    public IReadOnlyList<string> Capabilities { get; } =
    ["agent", "providers", "mcp", "skills", "local-tools", "command-compatibility"];

    public async IAsyncEnumerable<RuntimeEvent> ExecuteAsync(
        CommandRequest request,
        [System.Runtime.CompilerServices.EnumeratorCancellation]
        CancellationToken cancellationToken = default)
    {
        var command = request.Command.Trim().ToLowerInvariant();
        switch (command)
        {
            case "chat":
            case "provider.chat":
            case "providers.chat":
            {
                var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
                var chat = JsonSerializer.Deserialize<ProviderChatRequest>(
                    request.Arguments.GetRawText(), options)
                    ?? throw new ArgumentException("Invalid provider chat arguments.");
                var response = await _provider.ChatAsync(chat, cancellationToken);
                if (!string.IsNullOrWhiteSpace(response.Content))
                {
                    yield return new RuntimeEvent("text_delta", Message: response.Content);
                }
                yield return new RuntimeEvent(
                    "completed",
                    Message: response.Content,
                    Data: JsonSerializer.SerializeToElement(response, options));
                yield break;
            }
            case "tool":
            case "local_tool":
            {
                var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
                var invocation = JsonSerializer.Deserialize<CompatibilityToolRequest>(
                    request.Arguments.GetRawText(), options)
                    ?? throw new ArgumentException("Invalid compatibility tool arguments.");
                var tool = _internalTools.FirstOrDefault(candidate => candidate.IsKnownTool(invocation.Name));
                if (tool is null)
                {
                    yield return new RuntimeEvent("failed", Message: $"Tool is not authorized: {invocation.Name}");
                    yield break;
                }
                var result = await tool.ExecuteAsync(invocation.Name, invocation.Arguments, cancellationToken);
                yield return new RuntimeEvent("tool_result", Message: invocation.Name, Data: JsonSerializer.SerializeToElement(new
                {
                    name = invocation.Name,
                    result,
                    isError = false,
                }, options));
                yield return new RuntimeEvent("completed", Message: result);
                yield break;
            }
            default:
                yield return new RuntimeEvent(
                    "failed",
                    Message: $"Legacy command '{request.Command}' is not supported. Use /agent/sessions for document Agent sessions.");
                yield break;
        }
    }

    private sealed record CompatibilityToolRequest(string Name, JsonElement Arguments);
}
