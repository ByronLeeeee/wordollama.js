using System.Text.Json;

namespace WordOllama.Contracts;

public static class BridgeProtocol
{
    public const string CurrentVersion = "1.0";
    public const string SessionHeader = "X-WordOllama-Session";
    public const string CsrfHeader = "X-WordOllama-CSRF";
}

public sealed record BridgeHealthResponse(
    string ProtocolVersion,
    string BridgeVersion,
    bool Ready,
    IReadOnlyList<string> Capabilities);

public sealed record PairRequest(string PairingCode, string Origin);

public sealed record AutomaticPairRequest(string Origin);

public sealed record PairResponse(
    string ProtocolVersion,
    string SessionToken,
    DateTimeOffset ExpiresAt,
    IReadOnlyList<string> Capabilities,
    string CsrfToken = "",
    bool CookieSession = false);

public sealed record CommandRequest(
    string Command,
    string? DocumentId,
    JsonElement Arguments);

public sealed record CommandResponse(
    string RequestId,
    string Status,
    string? Message = null);

public sealed record OfficeToolDescriptor(
    string Name,
    string Description,
    bool IsWriteOperation,
    JsonElement ParameterSchema);

public sealed record ToolCatalogRequest(IReadOnlyList<OfficeToolDescriptor> Tools);

public sealed record ToolCatalogResponse(
    string ProtocolVersion,
    int RegisteredOfficeToolCount,
    IReadOnlyList<OfficeToolDescriptor> Tools);

public sealed record ChatMessage(
    string Role,
    string Content,
    string? ToolCallId = null,
    string? Name = null,
    IReadOnlyList<ProviderToolCall>? ToolCalls = null,
    string? ImageDataUrl = null);

public sealed record ProviderToolCall(
    string Id,
    string Name,
    JsonElement Arguments);

public sealed record ProviderChatRequest(
    IReadOnlyList<ChatMessage> Messages,
    string? Model = null,
    double? Temperature = null,
    int? MaxTokens = null,
    int? ContextWindow = null,
    string? KeepAlive = null,
    IReadOnlyList<OfficeToolDescriptor>? Tools = null,
    string? ProviderProfileId = null);

public sealed record ProviderChatResponse(
    string Provider,
    string Model,
    string Content,
    IReadOnlyList<ProviderToolCall>? ToolCalls = null);

public sealed record ProviderChatChunk(
    string Provider,
    string Model,
    string Delta,
    bool Done,
    IReadOnlyList<ProviderToolCall>? ToolCalls = null);

public sealed record LawArticleResult(
    string LawName,
    string ArticleNumber,
    string Content,
    string Category);

public sealed record OllamaModelRequest(string Model);

public sealed record OllamaModelProgress(
    string Status,
    string? Digest = null,
    long? Completed = null,
    long? Total = null,
    bool Done = false);

public sealed record ProviderRuntimeResponse(
    string Provider,
    string Type,
    IReadOnlyList<string> Models);

public sealed record AgentStartRequest(
    string UserRequirement,
    string? Model = null,
    IReadOnlyList<OfficeToolDescriptor>? Tools = null,
    bool RequirePlanConfirmation = false,
    int MaxIterations = 50,
    string ExecutionMode = "TrackedChanges",
    bool AllowExternalTools = false,
    bool? AllowLocalTools = null,
    bool? AllowNetworkTools = null,
    bool? AllowMcpTools = null,
    string? ImageDataUrl = null,
    double? Temperature = null,
    int? MaxTokens = null,
    int? ContextWindow = null,
    string? KeepAlive = null,
    string LanguageMode = "auto",
    string UiLocale = "en-US",
    string WritingProfile = "",
    string Goal = "");

public sealed record AgentStartResponse(string SessionId, string Status);

public sealed record AgentToolResultRequest(
    string CallId,
    string Result,
    bool IsError = false);

public sealed record AgentPlanConfirmationRequest(
    bool Approved,
    string? Note = null);

public sealed record AgentPermissionRequest(
    string CallId,
    bool Approved,
    string? Note = null);

public sealed record AgentCheckpoint(
    string SessionId,
    int Iteration,
    int MessageCount,
    string ExecutionMode,
    DateTimeOffset CreatedAt);

public sealed record AgentRecoverySnapshot(
    string SessionId,
    string Origin,
    AgentStartRequest Request,
    IReadOnlyList<ChatMessage> Messages,
    int Iteration,
    AgentCheckpoint Checkpoint,
    DateTimeOffset UpdatedAt);

public sealed record AgentRecoveryDescriptor(
    string SessionId,
    string UserRequirement,
    int Iteration,
    string ExecutionMode,
    DateTimeOffset UpdatedAt,
    bool HasImage,
    string Goal = "");

public sealed record ExecuteCommandRequest(
    string Command,
    string? Args = null,
    int TimeoutSeconds = 30,
    string? WorkingDirectory = null);

public sealed record RunPythonScriptRequest(
    string SkillName,
    string? ScriptArgs = null,
    int TimeoutSeconds = 60);

public sealed record HttpRequestToolRequest(
    string Method,
    string Url,
    IReadOnlyDictionary<string, string>? Headers = null,
    string? Body = null,
    int TimeoutSeconds = 30);

public sealed record GrepRequest(
    string Root,
    string Pattern,
    bool Regex = false,
    int MaxResults = 100);

public sealed record ReadSkillRequest(string SkillName, string? Reference = null);

public sealed record SkillSummary(string Name, string Description);

public sealed record ImportSkillRequest(string FileName, string ZipBase64);

public sealed record LocalToolResponse(
    int ExitCode,
    string Stdout,
    string Stderr,
    bool TimedOut = false);

public sealed record GrepMatch(string Path, int Line, string Text);

public sealed record McpServerRequest(
    string Name,
    string Command,
    IReadOnlyList<string>? Arguments = null,
    string? WorkingDirectory = null,
    IReadOnlyDictionary<string, string>? Environment = null,
    string Transport = "stdio",
    IReadOnlyDictionary<string, string>? Headers = null);

public sealed record McpToolCallRequest(
    string ServerName,
    string ToolName,
    JsonElement Arguments);

public sealed record DocumentCompareRequest(
    string OriginalBase64,
    string RevisedBase64,
    bool IgnoreCase = false);

public sealed record DocumentDiff(
    string Kind,
    int ParagraphIndex,
    string? Original,
    string? Revised,
    int? OriginalParagraphIndex = null,
    int? RevisedParagraphIndex = null,
    string BlockType = "paragraph",
    string? Style = null,
    string? Location = null,
    IReadOnlyList<DocumentTextDiff>? TextChanges = null,
    string? OriginalStyle = null,
    string? RevisedStyle = null,
    string? OriginalLocation = null,
    string? RevisedLocation = null,
    int? InsertAfterOriginalParagraphIndex = null,
    string? InsertAfterOriginalText = null,
    string? InsertAfterOriginalBlockType = null);

public sealed record DocumentTextDiff(
    string Kind,
    int OriginalStart,
    int OriginalLength,
    int RevisedStart,
    int RevisedLength,
    string? Original,
    string? Revised);

public sealed record DocumentCompareSummary(
    int Added,
    int Removed,
    int Modified,
    int Unchanged,
    int TableCellChanges,
    int HeadingChanges);

public sealed record DocumentCompareResponse(
    int OriginalParagraphCount,
    int RevisedParagraphCount,
    IReadOnlyList<DocumentDiff> Changes,
    bool IsApproximate = true,
    DocumentCompareSummary? Summary = null,
    string Algorithm = "structural-lcs-v2");

public sealed record RuntimeEvent(
    string Type,
    string? RequestId = null,
    string? Message = null,
    JsonElement? Data = null);
