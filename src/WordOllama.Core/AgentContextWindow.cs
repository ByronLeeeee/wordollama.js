using System.Text;
using WordOllama.Contracts;

namespace WordOllama.Core;

internal static class AgentContextWindow
{
    private const int DefaultCharacterBudget = 64_000;
    private const int MaximumToolResultCharacters = 12_000;

    public static IReadOnlyList<ChatMessage> Prepare(
        IReadOnlyList<ChatMessage> messages,
        int? contextWindow,
        out bool compacted,
        out int estimatedTokens)
    {
        var budget = contextWindow is > 0
            ? Math.Clamp(contextWindow.Value * 3, 24_000, 400_000)
            : DefaultCharacterBudget;
        estimatedTokens = Math.Max(1, messages.Sum(message => message.Content?.Length ?? 0) / 4);
        if (messages.Sum(WeightedLength) <= budget)
        {
            compacted = false;
            return messages;
        }

        compacted = true;
        var start = Math.Max(2, messages.Count - 14);
        while (start > 2 && string.Equals(messages[start].Role, "tool", StringComparison.OrdinalIgnoreCase)) start--;
        var result = new List<ChatMessage>();
        if (messages.Count > 0) result.Add(messages[0]);
        if (messages.Count > 1) result.Add(messages[1] with { ImageDataUrl = null });

        var summary = new StringBuilder("Earlier Agent history was compacted to protect the model context. Preserve these facts:\n");
        foreach (var message in messages.Skip(2).Take(Math.Max(0, start - 2)))
        {
            var label = string.Equals(message.Role, "tool", StringComparison.OrdinalIgnoreCase)
                ? $"tool:{message.Name ?? "unknown"}"
                : message.Role;
            var text = (message.Content ?? string.Empty).Replace('\r', ' ').Replace('\n', ' ').Trim();
            if (text.Length > 240) text = text[..240] + "…";
            if (text.Length > 0) summary.Append("- ").Append(label).Append(": ").AppendLine(text);
            if (summary.Length > budget / 5) break;
        }
        result.Add(new ChatMessage("system", summary.ToString()));
        result.AddRange(messages.Skip(start).Select(BoundToolResult));
        estimatedTokens = Math.Max(1, result.Sum(message => message.Content?.Length ?? 0) / 4);
        return result;
    }

    private static int WeightedLength(ChatMessage message) =>
        (message.Content?.Length ?? 0) + (message.ToolCalls?.Count ?? 0) * 300;

    private static ChatMessage BoundToolResult(ChatMessage message)
    {
        if (!string.Equals(message.Role, "tool", StringComparison.OrdinalIgnoreCase) ||
            message.Content.Length <= MaximumToolResultCharacters) return message;
        return message with
        {
            Content = message.Content[..MaximumToolResultCharacters] +
                "\n[Tool result truncated by Agent context governance.]",
        };
    }
}
