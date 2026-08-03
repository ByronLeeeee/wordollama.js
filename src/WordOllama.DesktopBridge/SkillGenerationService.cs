using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using System.Text;
using WordOllama.Contracts;
using WordOllama.Core;

namespace WordOllama.DesktopBridge;

public sealed class SkillGenerationService
{
    private readonly IModelProvider _provider;
    private readonly LocalToolService _localTools;

    public SkillGenerationService(IModelProvider provider, LocalToolService localTools)
    {
        _provider = provider;
        _localTools = localTools;
    }

    public async Task<GeneratedSkillResponse> GenerateAsync(
        GenerateSkillRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Requirement) || request.Requirement.Length > 20_000)
            throw new ArgumentException("Skill requirement must contain 1 to 20,000 characters.");
        var tools = (request.OfficeTools ?? [])
            .Take(80)
            .Select(tool => new { tool.Name, tool.Description, tool.IsWriteOperation })
            .ToArray();
        var prompt = JsonSerializer.Serialize(new
        {
            requirement = request.Requirement.Trim(),
            completedTaskResult = Bound(request.TaskResult, 16_000),
            userFeedback = Bound(request.UserFeedback, 4_000),
            suggestedName = request.SuggestedName,
            toolsUsed = request.ToolsUsed?.Take(80).ToArray() ?? [],
            availableOfficeTools = tools,
        });
        var response = await _provider.ChatAsync(new ProviderChatRequest(
            [
                new ChatMessage("system", SkillCreatorPrompt(request.UiLocale)),
                new ChatMessage("user", prompt),
            ],
            Temperature: 0.2,
            MaxTokens: 5000), cancellationToken);
        var draft = ParseDraft(response.Content, request.SuggestedName);
        var existing = _localTools.ListSkills().Select(skill => skill.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var baseName = NormalizeName(draft.Name, request.Requirement);
        var uniqueName = baseName;
        for (var suffix = 2; existing.Contains(uniqueName); suffix++)
        {
            var suffixText = $"-{suffix}";
            uniqueName = baseName[..Math.Min(baseName.Length, 64 - suffixText.Length)].TrimEnd('-') + suffixText;
        }
        var summary = _localTools.CreateSkill(new CreateSkillRequest(
            uniqueName, draft.Description, draft.SkillMarkdown));
        var content = await _localTools.ReadSkillAsync(new ReadSkillRequest(summary.Name), cancellationToken);
        return new GeneratedSkillResponse(summary.Name, summary.Description, content, true);
    }

    private static string SkillCreatorPrompt(string? locale) =>
        "You create concise, reusable WordOllama Skills. Return JSON only with keys name, description, skill_markdown. " +
        "The name must be lowercase hyphen-case under 64 characters. The description must state what the Skill does and concrete requests that trigger it. " +
        "skill_markdown must be a complete SKILL.md with YAML frontmatter containing only name and description. " +
        "Use imperative instructions. Preserve reusable user feedback, but never include conversation history, document content, credentials, personal data, or one-off output. " +
        "Refer only to Office tools included in availableOfficeTools, and explain read-before-write, verification, tracked-change and source-citation behavior when applicable. " +
        "Keep the body focused and normally under 200 lines. Do not create README or installation files. " +
        (locale?.StartsWith("zh", StringComparison.OrdinalIgnoreCase) == true
            ? "Write the body in Simplified Chinese unless the workflow specifically requires another language."
            : "Write the body in the user's language.");

    private static SkillDraft ParseDraft(string content, string? suggestedName)
    {
        var cleaned = content.Trim();
        cleaned = Regex.Replace(cleaned, "^```(?:json)?\\s*", string.Empty, RegexOptions.IgnoreCase);
        cleaned = Regex.Replace(cleaned, "\\s*```$", string.Empty);
        try
        {
            using var document = JsonDocument.Parse(cleaned);
            var root = document.RootElement;
            var name = root.TryGetProperty("name", out var nameValue) ? nameValue.GetString() : suggestedName;
            var description = root.TryGetProperty("description", out var descriptionValue) ? descriptionValue.GetString() : null;
            var markdown = root.TryGetProperty("skill_markdown", out var markdownValue)
                ? markdownValue.GetString()
                : root.TryGetProperty("skillMarkdown", out markdownValue) ? markdownValue.GetString() : null;
            if (!string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(description) && !string.IsNullOrWhiteSpace(markdown))
                return new SkillDraft(name!, description!, markdown!);
        }
        catch (JsonException)
        {
            // Fall through to the Markdown-compatible parser for local models.
        }

        var markdownFallback = cleaned;
        var fallbackName = ReadFrontmatter(markdownFallback, "name") ?? suggestedName ?? "word-task-workflow";
        var fallbackDescription = ReadFrontmatter(markdownFallback, "description") ??
            "复用本次 Word Agent 任务形成的工作流；在用户提出相同类型的文档处理需求时使用。";
        return new SkillDraft(fallbackName, fallbackDescription, markdownFallback);
    }

    private static string? ReadFrontmatter(string value, string key)
    {
        var match = Regex.Match(value, $"(?m)^{Regex.Escape(key)}:\\s*(?<value>.+?)\\s*$");
        return match.Success ? match.Groups["value"].Value.Trim().Trim('"', '\'') : null;
    }

    private static string Bound(string? value, int limit) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim()[..Math.Min(value.Trim().Length, limit)];

    private static string NormalizeName(string value, string requirement)
    {
        var name = Regex.Replace(value.Trim().ToLowerInvariant(), "[^a-z0-9-]+", "-").Trim('-');
        name = Regex.Replace(name, "-{2,}", "-");
        if (name.Length > 64) name = name[..64].TrimEnd('-');
        if (name.Length >= 2) return name;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(requirement)))[..8].ToLowerInvariant();
        return $"word-workflow-{hash}";
    }

    private sealed record SkillDraft(string Name, string Description, string SkillMarkdown);
}
