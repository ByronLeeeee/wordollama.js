using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;
using WordOllama.Contracts;

namespace WordOllama.Core;

/// <summary>
/// Cross-platform Agent loop. Word tools are never executed here: tool_call
/// events are sent to the Office.js host and tool results resume the loop.
/// </summary>
public sealed class AgentSession
{
    private readonly IModelProvider _provider;
    private readonly IReadOnlyList<IInternalToolExecutor> _internalTools;
    private readonly IAgentRecoveryStore _recoveryStore;
    private readonly AgentStartRequest _request;
    private readonly bool _isRecovered;
    private readonly Action<string>? _onCompleted;
    private readonly IReadOnlyList<OfficeToolDescriptor> _tools;
    private readonly IReadOnlyList<OfficeToolDescriptor> _advertisedTools;
    private readonly List<ChatMessage> _messages = new();
    private readonly Channel<RuntimeEvent> _events = Channel.CreateUnbounded<RuntimeEvent>();
    private readonly Dictionary<string, TaskCompletionSource<ToolResult>> _pending = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TaskCompletionSource<bool>> _pendingPermissions = new(StringComparer.Ordinal);
    private readonly object _gate = new();
    private readonly CancellationTokenSource _cancellation = new();
    private readonly TaskCompletionSource<bool> _planApproval = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly bool _requirePlanConfirmation;
    private readonly int _maxIterations;
    private readonly string _executionMode;
    private readonly bool _allowLocalTools;
    private readonly bool _allowNetworkTools;
    private readonly bool _allowMcpTools;
    private readonly double? _temperature;
    private readonly int? _maxTokens;
    private readonly int? _contextWindow;
    private readonly string? _keepAlive;
    private readonly string _languageMode;
    private readonly string _uiLocale;
    private readonly string _permissionMode;
    private readonly DateTimeOffset _startedAt = DateTimeOffset.UtcNow;
    private readonly Dictionary<string, AgentSource> _sources = new(StringComparer.OrdinalIgnoreCase);
    private bool _awaitingPlanConfirmation;
    private bool _planWasPresented;
    private int _iterations;
    private bool _completed;
    private AgentCheckpoint? _checkpoint;
    private int _toolCallCount;
    private int _contextCompactions;

    public AgentSession(
        string id,
        string origin,
        AgentStartRequest request,
        IModelProvider provider,
        IReadOnlyList<IInternalToolExecutor>? internalTools = null,
        IAgentRecoveryStore? recoveryStore = null,
        AgentRecoverySnapshot? recovery = null,
        Action<string>? onCompleted = null)
    {
        Id = id;
        Origin = origin;
        UserRequirement = request.UserRequirement;
        Model = request.Model;
        _request = request;
        _provider = provider;
        _internalTools = internalTools ?? Array.Empty<IInternalToolExecutor>();
        _recoveryStore = recoveryStore ?? new NullAgentRecoveryStore();
        _isRecovered = recovery is not null;
        _onCompleted = onCompleted;
        _tools = request.Tools ?? Array.Empty<OfficeToolDescriptor>();
        _requirePlanConfirmation = request.RequirePlanConfirmation;
        _maxIterations = request.MaxIterations <= 0 ? 200 : Math.Clamp(request.MaxIterations, 1, 200);
        _executionMode = NormalizeExecutionMode(request.ExecutionMode);
        // The legacy aggregate switch remains a compatibility fallback for
        // settings written before permissions were split by capability.
        _allowLocalTools = request.AllowLocalTools ?? request.AllowExternalTools;
        _allowNetworkTools = request.AllowNetworkTools ?? request.AllowExternalTools;
        _allowMcpTools = request.AllowMcpTools ?? request.AllowExternalTools;
        _temperature = request.Temperature;
        _maxTokens = request.MaxTokens;
        _contextWindow = request.ContextWindow;
        _keepAlive = request.KeepAlive;
        _languageMode = NormalizeLanguageMode(request.LanguageMode);
        _uiLocale = UiText.NormalizeLocale(request.UiLocale);
        _permissionMode = NormalizePermissionMode(request.PermissionMode);
        var internalToolNames = _internalTools
            .SelectMany(tool => tool.GetToolDescriptors())
            .Select(tool => tool.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var advertisedTools = _tools
            .Where(tool => (_executionMode == "TrackedChanges" || !tool.IsWriteOperation) &&
                (!internalToolNames.Contains(tool.Name) ||
                 IsInternalToolAllowed(tool.Name) ||
                 string.Equals(tool.Name, "read_skill", StringComparison.OrdinalIgnoreCase)))
            .ToList();
        if (_requirePlanConfirmation)
        {
            advertisedTools.Add(CreateUpdatePlanTool());
        }
        _advertisedTools = advertisedTools;
        if (!_requirePlanConfirmation || _isRecovered)
        {
            _planApproval.TrySetResult(true);
        }
        _ = ProviderImageDataParser.Parse(request.ImageDataUrl);
        if (recovery is not null)
        {
            _messages.AddRange(recovery.Messages);
            _iterations = Math.Max(0, recovery.Iteration - 1);
            _checkpoint = recovery.Checkpoint;
        }
        else
        {
            _messages.Add(new ChatMessage(
                "system",
                "You are WordOllama, an AI assistant operating inside Microsoft Word. " +
                "Use the provided tools for document changes. Never claim a document change " +
                "succeeded until the tool result confirms it. " +
                "The active Microsoft Word document is available only through the Office tools " +
                "such as get_selection, get_doc_overview, read_paragraphs, and read_large_chunk. " +
                "Before any selection-based write, call get_selection or select_exact_text and pass the returned selectionHash as expected_selection_hash; refresh it whenever the selection changes. " +
                "Never use isolated-workspace file tools to read the active Word document. " +
                  "When external search, vector retrieval, MCP retrieval, or URL fetching is used, ground factual claims in the returned evidence and cite the source URLs in the final answer. Never invent a source. " +
                 "Installed Skills are instruction packages that extend your workflow; they are not Office add-ins. " +
                  "Use list_skills when the user asks for a Skill without an exact canonical name, and read_skill before following one. " +
                  "When the user asks to create a reusable Skill, use create_skill with concise instructions derived from the requirement, successful workflow, available Office tools, and explicit feedback. Never include document text, secrets, personal data, or raw conversation history in a Skill. " +
                 "If a Skill needs a tool that is not available in this session, state which Agent capability (local tools, network tools, or MCP) must be enabled. " +
                 "Never dismiss a Skill request by saying that you are merely a Word plugin. " +
                 (_requirePlanConfirmation
                     ? "You may call update_plan when the task genuinely requires multiple meaningful steps. " +
                       "Use it to show a concise TODO plan before executing those steps. Do not call it for greetings, " +
                       "simple questions, one-step answers, or merely to restate the user's request. "
                     : string.Empty) +
                (_executionMode == "ViewOnly"
                    ? "The session is ViewOnly: analyze and answer without changing the document."
                    : _executionMode == "ProposeChanges"
                        ? "The session is ProposeChanges: describe proposed edits but do not change the document."
                        : "The session is TrackedChanges: document writes are permitted and the host records revisions.") +
                GoalInstruction(request.Goal) +
                LanguageInstruction(_languageMode) +
                WritingProfileInstruction(request.WritingProfile)));
            _messages.Add(new ChatMessage(
                "user",
                request.UserRequirement,
                ImageDataUrl: request.ImageDataUrl));
        }
    }

    private static string NormalizeLanguageMode(string? value) =>
        value?.Trim().ToLowerInvariant() switch
        {
            "zh" => "zh",
            "en" => "en",
            "source" => "source",
            _ => "auto",
        };

    private static string WritingProfileInstruction(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? string.Empty
            : "\nApply the following user memories and output preferences only when relevant. " +
              "The explicit task, document facts, legal accuracy, and required output schema take precedence.\n" +
              value.Trim();

    private static string GoalInstruction(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? string.Empty
            : "\nThis session has a durable goal. Use it to choose and sequence steps across iterations, " +
              "but do not broaden the user's permissions or invent work outside the request. Explicitly " +
              "state when the goal is achieved; if it cannot be achieved, explain the concrete blocker.\nGoal:\n" +
              value.Trim();

    private static string LanguageInstruction(string mode) =>
        mode switch
        {
            "zh" => " Always respond in Simplified Chinese, except for source quotations, proper nouns, or explicit user requirements.",
            "en" => " Always respond in English, except for source quotations, proper nouns, or explicit user requirements.",
            "source" => " Use the same language as the source text or primary user content. Preserve quotations and proper nouns.",
            _ => string.Empty,
        };

    private string Localize(string key, params object?[] arguments) =>
        arguments.Length == 0
            ? UiText.Get(_uiLocale, key)
            : UiText.Format(_uiLocale, key, arguments);

    public string Id { get; }
    public string Origin { get; }
    public string UserRequirement { get; }
    public string? Model { get; }
    public string Status => _completed
        ? "completed"
        : _awaitingPlanConfirmation
            ? "awaiting_plan"
            : "running";

    public void Start() => _ = RunAsync();

    public IAsyncEnumerable<RuntimeEvent> ReadEventsAsync(CancellationToken cancellationToken = default) =>
        _events.Reader.ReadAllAsync(cancellationToken);

    public bool SubmitToolResult(AgentToolResultRequest result)
    {
        lock (_gate)
        {
            return _pending.TryGetValue(result.CallId, out var pending) &&
                   pending.TrySetResult(new ToolResult(result.Result, result.IsError));
        }
    }

    public bool ConfirmPlan(AgentPlanConfirmationRequest request)
    {
        if (_completed || !_awaitingPlanConfirmation || _planApproval.Task.IsCompleted)
        {
            return false;
        }
        return _planApproval.TrySetResult(request.Approved);
    }

    public bool SubmitPermission(AgentPermissionRequest request)
    {
        lock (_gate)
        {
            return _pendingPermissions.TryGetValue(request.CallId, out var pending) &&
                   pending.TrySetResult(request.Approved);
        }
    }

    public AgentCheckpoint? GetCheckpoint() => _checkpoint;

    public AgentRecoveryDescriptor? GetRecoveryDescriptor() =>
        _checkpoint is null
            ? null
            : new AgentRecoveryDescriptor(
                Id,
                UserRequirement,
                _checkpoint.Iteration,
                _executionMode,
                _checkpoint.CreatedAt,
                !string.IsNullOrWhiteSpace(_request.ImageDataUrl),
                _request.Goal);

    public void Cancel()
    {
        if (_completed)
        {
            return;
        }

        _cancellation.Cancel();
        _planApproval.TrySetCanceled(_cancellation.Token);
        lock (_gate)
        {
            foreach (var permission in _pendingPermissions.Values)
            {
                permission.TrySetCanceled(_cancellation.Token);
            }
        }
        Publish(new RuntimeEvent(
            "cancelled",
            Message: Localize("AgentSessionCancelled")));
        Complete(deleteRecovery: true);
    }

    private async Task RunAsync()
    {
        try
        {
            if (!_isRecovered) await InitializeSkillContextAsync();
            while (!_cancellation.IsCancellationRequested && _iterations++ < _maxIterations &&
                   DateTimeOffset.UtcNow - _startedAt < TimeSpan.FromMinutes(30))
            {
                _checkpoint = new AgentCheckpoint(
                    Id,
                    _iterations,
                    _messages.Count,
                    _executionMode,
                    DateTimeOffset.UtcNow);
                SaveRecovery(_checkpoint);
                Publish(new RuntimeEvent(
                    "checkpoint",
                    Data: JsonSerializer.SerializeToElement(_checkpoint)));
                var providerMessages = AgentContextWindow.Prepare(
                    _messages, _contextWindow, out var compacted, out var estimatedTokens);
                if (compacted)
                {
                    _contextCompactions++;
                    Publish(new RuntimeEvent("context_compacted", Data: JsonSerializer.SerializeToElement(new
                    {
                        originalMessages = _messages.Count,
                        sentMessages = providerMessages.Count,
                        estimatedTokens,
                    })));
                }
                var response = await _provider.ChatAsync(
                    new ProviderChatRequest(
                        providerMessages,
                        Model,
                        Temperature: _temperature,
                        MaxTokens: _maxTokens,
                        ContextWindow: _contextWindow,
                        KeepAlive: _keepAlive,
                        Tools: _advertisedTools),
                    _cancellation.Token);

                if (!string.IsNullOrWhiteSpace(response.Content))
                {
                    Publish(new RuntimeEvent("text_delta", Message: response.Content));
                }

                var calls = response.ToolCalls ?? Array.Empty<ProviderToolCall>();
                if (calls.Count == 0)
                {
                    Publish(new RuntimeEvent("completed", Message: response.Content));
                    Complete();
                    return;
                }

                _messages.Add(new ChatMessage(
                    "assistant",
                    response.Content,
                    ToolCalls: calls,
                    ProviderData: response.ProviderData));

                var results = new List<(ProviderToolCall Call, ToolResult Result)>();
                foreach (var call in calls)
                {
                    _toolCallCount++;
                    if (string.Equals(call.Name, "update_plan", StringComparison.OrdinalIgnoreCase))
                    {
                        var steps = ReadPlanSteps(call.Arguments);
                        if (steps.Count == 0)
                        {
                            _messages.Add(new ChatMessage(
                                "tool",
                                JsonSerializer.Serialize(new { error = "A plan must contain at least one concrete step." }),
                                ToolCallId: call.Id,
                                Name: call.Name));
                            continue;
                        }

                        if (_planWasPresented)
                        {
                            Publish(new RuntimeEvent("plan_updated", Data: JsonSerializer.SerializeToElement(new { steps })));
                            _messages.Add(new ChatMessage(
                                "tool",
                                JsonSerializer.Serialize(new { approved = true, updated = true }),
                                ToolCallId: call.Id,
                                Name: call.Name));
                            continue;
                        }

                        _planWasPresented = true;
                        _awaitingPlanConfirmation = true;
                        Publish(new RuntimeEvent(
                            "plan_pending",
                            Message: Localize("AgentPlanPending"),
                            Data: JsonSerializer.SerializeToElement(new
                            {
                                userRequirement = UserRequirement,
                                executionMode = _executionMode,
                                maxIterations = _maxIterations,
                                steps,
                            })));
                        var approved = await _planApproval.Task.WaitAsync(_cancellation.Token);
                        _awaitingPlanConfirmation = false;
                        if (!approved)
                        {
                            Publish(new RuntimeEvent("failed", Message: Localize("AgentPlanRejected")));
                            Complete();
                            return;
                        }
                        _messages.Add(new ChatMessage(
                            "tool",
                            JsonSerializer.Serialize(new { approved = true }),
                            ToolCallId: call.Id,
                            Name: call.Name));
                        continue;
                    }

                    var declaredTool = _tools.FirstOrDefault(tool =>
                        string.Equals(tool.Name, call.Name, StringComparison.OrdinalIgnoreCase));
                    if (declaredTool?.IsWriteOperation == true && _executionMode != "TrackedChanges")
                    {
                        var blocked = Localize("AgentToolBlocked", call.Name, _executionMode);
                        _messages.Add(new ChatMessage("tool", JsonSerializer.Serialize(new { error = blocked }),
                            ToolCallId: call.Id, Name: call.Name));
                        Publish(new RuntimeEvent("tool_result", Message: call.Name,
                            Data: JsonSerializer.SerializeToElement(new { callId = call.Id, name = call.Name, result = blocked, isError = true })));
                        continue;
                    }
                    var internalTool = _internalTools.FirstOrDefault(tool => tool.IsKnownTool(call.Name));
                    if (internalTool is not null)
                    {
                        if (!IsInternalToolAllowed(call.Name))
                        {
                            var blocked = Localize("AgentExternalToolDisabled", call.Name);
                            _messages.Add(new ChatMessage("tool", JsonSerializer.Serialize(new { error = blocked }),
                                ToolCallId: call.Id, Name: call.Name));
                            Publish(new RuntimeEvent("tool_result", Message: call.Name,
                                Data: JsonSerializer.SerializeToElement(new { callId = call.Id, name = call.Name, result = blocked, isError = true })));
                            continue;
                        }
                        Publish(new RuntimeEvent(
                            "tool_call",
                            Message: call.Name,
                            Data: JsonSerializer.SerializeToElement(new
                            {
                                callId = call.Id,
                                name = call.Name,
                                execution = "bridge",
                                @params = call.Arguments,
                            })));

                        try
                        {
                            if (ShouldRequirePermission(call.Name, internalTool.RequiresConfirmation(call.Name)))
                                await RequirePermissionAsync(call, "bridge");
                            var localResult = await internalTool.ExecuteAsync(
                                call.Name,
                                call.Arguments,
                                _cancellation.Token);
                            _messages.Add(new ChatMessage(
                                "tool",
                                localResult,
                                ToolCallId: call.Id,
                                Name: call.Name));
                            Publish(new RuntimeEvent(
                                "tool_result",
                                Message: call.Name,
                                Data: JsonSerializer.SerializeToElement(new
                                {
                                    callId = call.Id,
                                    name = call.Name,
                                    result = localResult,
                                    isError = false,
                                })));
                            PublishSources(call.Name, localResult);
                        }
                        catch (Exception exception)
                        {
                            var errorResult = JsonSerializer.Serialize(new { error = exception.Message });
                            _messages.Add(new ChatMessage(
                                "tool",
                                errorResult,
                                ToolCallId: call.Id,
                                Name: call.Name));
                            Publish(new RuntimeEvent(
                                "tool_result",
                                Message: call.Name,
                                Data: JsonSerializer.SerializeToElement(new
                                {
                                    callId = call.Id,
                                    name = call.Name,
                                    result = exception.Message,
                                    isError = true,
                                })));
                        }
                        continue;
                    }

                    var pending = new TaskCompletionSource<ToolResult>(
                        TaskCreationOptions.RunContinuationsAsynchronously);
                    if (declaredTool?.IsWriteOperation == true && _permissionMode != "full")
                        await RequirePermissionAsync(call, "officejs");
                    lock (_gate)
                    {
                        _pending[call.Id] = pending;
                    }

                    Publish(new RuntimeEvent(
                        "tool_call",
                        Message: call.Name,
                        Data: JsonSerializer.SerializeToElement(new
                        {
                            callId = call.Id,
                            name = call.Name,
                            execution = "officejs",
                            @params = call.Arguments,
                        })));

                    var result = await pending.Task.WaitAsync(_cancellation.Token);
                    lock (_gate)
                    {
                        _pending.Remove(call.Id);
                    }
                    results.Add((call, result));
                }

                foreach (var (call, result) in results)
                {
                    var content = result.IsError
                        ? JsonSerializer.Serialize(new { error = result.Content })
                        : result.Content;
                    _messages.Add(new ChatMessage(
                        "tool",
                        content,
                        ToolCallId: call.Id,
                        Name: call.Name));
                    if (!result.IsError) PublishSources(call.Name, result.Content);
                }
            }

            Publish(new RuntimeEvent("failed", Message:
                DateTimeOffset.UtcNow - _startedAt >= TimeSpan.FromMinutes(30)
                    ? "Agent task exceeded the 30-minute safety budget."
                    : Localize("AgentIterationLimit")));
            Complete(deleteRecovery: true);
        }
        catch (OperationCanceledException)
        {
            if (!_completed)
            {
                Publish(new RuntimeEvent(
                    "cancelled",
                    Message: Localize("AgentSessionCancelled")));
                Complete(deleteRecovery: true);
            }
        }
        catch (Exception exception)
        {
            Publish(new RuntimeEvent("failed", Message: exception.Message));
            Complete(deleteRecovery: false);
        }
    }

    private bool IsInternalToolAllowed(string name)
    {
        if (string.Equals(name, "run_terminal", StringComparison.OrdinalIgnoreCase))
        {
            return _permissionMode == "full" && _allowLocalTools;
        }

        if (string.Equals(name, "list_skills", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(name, "read_skill", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(name, "create_skill", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (name.StartsWith("workspace_", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith("_workspace_file", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(name, "list_workspace_files", StringComparison.OrdinalIgnoreCase) ||
            name is "run_python" or "run_node")
        {
            return _allowLocalTools;
        }

        if (name.StartsWith("mcp__", StringComparison.OrdinalIgnoreCase))
        {
            return _allowMcpTools;
        }

        if (string.Equals(name, "search_web", StringComparison.OrdinalIgnoreCase))
        {
            return _allowMcpTools && _allowNetworkTools;
        }

        if (string.Equals(name, "fetch_url", StringComparison.OrdinalIgnoreCase))
        {
            return _allowNetworkTools;
        }

        return _allowLocalTools;
    }

    private async Task InitializeSkillContextAsync()
    {
        var skillTools = _internalTools.FirstOrDefault(tool => tool.IsKnownTool("list_skills"));
        if (skillTools is null) return;
        var emptyArguments = JsonSerializer.SerializeToElement(new { });
        var catalog = await skillTools.ExecuteAsync("list_skills", emptyArguments, _cancellation.Token);
        var insertAt = Math.Max(1, _messages.Count - 1);
        _messages.Insert(insertAt++, new ChatMessage(
            "system",
            "Installed Skill catalog (canonical names and descriptions):\n" + catalog + "\n" +
            "Match requests against this catalog. Read the matching Skill before using it.\n" +
            $"Session capabilities: local tools {EnabledLabel(_allowLocalTools)}, " +
            $"network tools {EnabledLabel(_allowNetworkTools)}, MCP tools {EnabledLabel(_allowMcpTools)}. " +
            "If required capability is disabled, identify that setting precisely instead of describing yourself as only a Word plugin."));

        if (string.IsNullOrWhiteSpace(_request.SkillName)) return;
        var selected = _request.SkillName.Trim();
        var instructions = await skillTools.ExecuteAsync(
            "read_skill",
            JsonSerializer.SerializeToElement(new { skill_name = selected }),
            _cancellation.Token);
        _messages.Insert(insertAt, new ChatMessage(
            "system",
            $"The user explicitly selected Skill '{selected}'. Follow these instructions for this run. " +
            $"When reading one of its references, pass skill_name '{selected}' together with reference.\n\n{instructions}"));
    }

    private static string EnabledLabel(bool value) => value ? "enabled" : "disabled";

    private static OfficeToolDescriptor CreateUpdatePlanTool() => new(
        "update_plan",
        "Create or update a concise execution plan. The first plan waits for user approval; later calls update progress or re-plan after new evidence and failures.",
        false,
        JsonSerializer.SerializeToElement(new
        {
            type = "object",
            properties = new
            {
                steps = new
                {
                    type = "array",
                    items = new { type = "string" },
                    minItems = 2,
                    maxItems = 8,
                    description = "Concrete, non-duplicative execution steps."
                },
            },
            required = new[] { "steps" },
        }));

    private static IReadOnlyList<string> ReadPlanSteps(JsonElement arguments)
    {
        if (arguments.ValueKind != JsonValueKind.Object ||
            !arguments.TryGetProperty("steps", out var stepsElement) ||
            stepsElement.ValueKind != JsonValueKind.Array)
        {
            return [];
        }
        return stepsElement.EnumerateArray()
            .Where(step => step.ValueKind == JsonValueKind.String)
            .Select(step => step.GetString()?.Trim() ?? string.Empty)
            .Where(step => step.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .Take(8)
            .ToArray();
    }

    private bool ShouldRequirePermission(string name, bool toolDefault)
    {
        if (_permissionMode == "full") return false;
        if (_permissionMode == "auto")
        {
            return !name.StartsWith("workspace_", StringComparison.OrdinalIgnoreCase) &&
                   !string.Equals(name, "list_workspace_files", StringComparison.OrdinalIgnoreCase) &&
                   !string.Equals(name, "read_workspace_file", StringComparison.OrdinalIgnoreCase) &&
                   !string.Equals(name, "write_workspace_file", StringComparison.OrdinalIgnoreCase) &&
                   name is not "run_python" and not "run_node";
        }
        return toolDefault || string.Equals(name, "write_workspace_file", StringComparison.OrdinalIgnoreCase);
    }

    private async Task RequirePermissionAsync(ProviderToolCall call, string execution)
    {
        var permission = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_gate) _pendingPermissions[call.Id] = permission;
        Publish(new RuntimeEvent(
            "permission_request",
            Message: call.Name,
            Data: JsonSerializer.SerializeToElement(new
            {
                callId = call.Id,
                name = call.Name,
                execution,
                @params = call.Arguments,
            })));
        var approved = await permission.Task.WaitAsync(_cancellation.Token);
        lock (_gate) _pendingPermissions.Remove(call.Id);
        if (!approved) throw new InvalidOperationException(Localize("AgentHighRiskRejected"));
    }

    private static string NormalizePermissionMode(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "auto" => "auto",
        "full" => "full",
        _ => "request",
    };

    private static string NormalizeExecutionMode(string? value) =>
        value?.Trim().ToLowerInvariant() switch
        {
            "viewonly" => "ViewOnly",
            "proposechanges" => "ProposeChanges",
            _ => "TrackedChanges",
        };

    private void Publish(RuntimeEvent runtimeEvent)
    {
        _events.Writer.TryWrite(runtimeEvent with { RequestId = Id });
    }

    private void PublishSources(string tool, string content)
    {
        foreach (var source in AgentSourceExtractor.Extract(tool, content))
        {
            if (!_sources.TryAdd(source.Url, source)) continue;
            Publish(new RuntimeEvent("source", Message: source.Title, Data: JsonSerializer.SerializeToElement(source)));
        }
    }

    private void SaveRecovery(AgentCheckpoint checkpoint)
    {
        try
        {
            _recoveryStore.Save(new AgentRecoverySnapshot(
                Id,
                Origin,
                _request with { ImageDataUrl = null },
                _messages.ToArray(),
                checkpoint.Iteration,
                checkpoint,
                DateTimeOffset.UtcNow));
        }
        catch
        {
            // Recovery persistence must never interrupt the active Agent task.
        }
    }

    private void Complete(bool deleteRecovery = true)
    {
        var notifyCompleted = false;
        lock (_gate)
        {
            if (_completed)
            {
                return;
            }

            _completed = true;
            Publish(new RuntimeEvent("agent_stats", Data: JsonSerializer.SerializeToElement(new
            {
                iterations = _iterations,
                toolCalls = _toolCallCount,
                sources = _sources.Count,
                contextCompactions = _contextCompactions,
                elapsedMilliseconds = (long)(DateTimeOffset.UtcNow - _startedAt).TotalMilliseconds,
            })));
            _events.Writer.TryComplete();
            if (deleteRecovery)
            {
                try
                {
                    _recoveryStore.Delete(Id);
                }
                catch
                {
                    // A stale encrypted checkpoint is safer than failing completion.
                }
            }
            notifyCompleted = true;
        }
        if (notifyCompleted) _onCompleted?.Invoke(Id);
    }

    private sealed record ToolResult(string Content, bool IsError);
}

public sealed class AgentSessionManager : IAgentRecoveryStore
{
    private readonly IModelProvider _provider;
    private readonly IReadOnlyList<IInternalToolExecutor> _internalTools;
    private readonly IAgentRecoveryStore _recoveryStore;
    private readonly IAgentWorkspaceFactory? _workspaceFactory;
    private readonly ConcurrentDictionary<string, AgentSession> _sessions = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, AgentRecoverySnapshot> _recoveries = new(StringComparer.Ordinal);
    private readonly object _recoveryGate = new();

    public int ActiveCount => _sessions.Count;

    public AgentSessionManager(
        IModelProvider provider,
        IEnumerable<IInternalToolExecutor> internalTools,
        IAgentRecoveryStore? recoveryStore = null,
        IAgentWorkspaceFactory? workspaceFactory = null)
    {
        _provider = provider;
        _internalTools = internalTools.ToArray();
        _recoveryStore = recoveryStore ?? new NullAgentRecoveryStore();
        _workspaceFactory = workspaceFactory;
        try
        {
            foreach (var snapshot in _recoveryStore.LoadAll())
            {
                _recoveries[snapshot.SessionId] = snapshot;
            }
        }
        catch
        {
            // The Bridge remains usable when the recovery vault is unavailable.
        }
    }

    public AgentSession Create(AgentStartRequest request, string origin)
    {
        var id = Guid.NewGuid().ToString("N");
        var tools = AddWorkspaceTool(id);
        request = AddInternalToolDescriptors(request, tools);
        var session = new AgentSession(
            id,
            origin,
            request,
            _provider,
            tools,
            this,
            onCompleted: RemoveLiveSession);
        _sessions[session.Id] = session;
        session.Start();
        return session;
    }

    public bool TryGet(string id, string origin, out AgentSession session)
    {
        if (_sessions.TryGetValue(id, out session!))
        {
            return string.Equals(session.Origin, origin, StringComparison.OrdinalIgnoreCase);
        }
        lock (_recoveryGate)
        {
            if (_sessions.TryGetValue(id, out session!))
            {
                return string.Equals(session.Origin, origin, StringComparison.OrdinalIgnoreCase);
            }
            if (!_recoveries.TryGetValue(id, out var recovery) ||
                !string.Equals(recovery.Origin, origin, StringComparison.OrdinalIgnoreCase))
            {
                session = null!;
                return false;
            }
            var internalTools = AddWorkspaceTool(id);
            var recoveredRequest = AddInternalToolDescriptors(recovery.Request, internalTools);
            session = new AgentSession(
                recovery.SessionId,
                recovery.Origin,
                recoveredRequest,
                _provider,
                internalTools,
                this,
                recovery,
                RemoveLiveSession);
            _sessions[id] = session;
            _recoveries.TryRemove(id, out _);
            session.Start();
            return true;
        }
    }

    public bool TryGetCheckpoint(string id, string origin, out AgentCheckpoint checkpoint)
    {
        if (_sessions.TryGetValue(id, out var session) &&
            string.Equals(session.Origin, origin, StringComparison.OrdinalIgnoreCase) &&
            session.GetCheckpoint() is { } liveCheckpoint)
        {
            checkpoint = liveCheckpoint;
            return true;
        }
        if (_recoveries.TryGetValue(id, out var recovery) &&
            string.Equals(recovery.Origin, origin, StringComparison.OrdinalIgnoreCase))
        {
            checkpoint = recovery.Checkpoint;
            return true;
        }
        checkpoint = null!;
        return false;
    }

    public IReadOnlyList<AgentRecoveryDescriptor> ListRecoveries(string origin)
    {
        var stored = _recoveries.Values
            .Where(snapshot => string.Equals(snapshot.Origin, origin, StringComparison.OrdinalIgnoreCase))
            .Select(snapshot => new AgentRecoveryDescriptor(
                snapshot.SessionId,
                snapshot.Request.UserRequirement,
                snapshot.Iteration,
                snapshot.Checkpoint.ExecutionMode,
                snapshot.UpdatedAt,
                snapshot.Messages.Any(message =>
                    !string.IsNullOrWhiteSpace(message.ImageDataUrl)),
                snapshot.Request.Goal));
        var live = _sessions.Values
            .Where(session => string.Equals(session.Origin, origin, StringComparison.OrdinalIgnoreCase))
            .Select(session => session.GetRecoveryDescriptor())
            .Where(descriptor => descriptor is not null)
            .Select(descriptor => descriptor!);
        return stored
            .Concat(live)
            .GroupBy(descriptor => descriptor.SessionId, StringComparer.Ordinal)
            .Select(group => group.OrderByDescending(item => item.UpdatedAt).First())
            .OrderByDescending(descriptor => descriptor.UpdatedAt)
            .ToArray();
    }

    public void Remove(string id)
    {
        try
        {
            Delete(id);
        }
        catch
        {
            // Session removal remains best-effort if the recovery vault is unavailable.
        }
        if (_sessions.TryRemove(id, out var session))
        {
            session.Cancel();
        }
        TryDeleteWorkspace(id);
    }

    private void RemoveLiveSession(string id)
    {
        _sessions.TryRemove(id, out _);
        TryDeleteWorkspace(id);
    }

    private IReadOnlyList<IInternalToolExecutor> AddWorkspaceTool(string id) =>
        _workspaceFactory is null
            ? _internalTools
            : [.. _internalTools, _workspaceFactory.Create(id)];

    private static AgentStartRequest AddInternalToolDescriptors(
        AgentStartRequest request,
        IReadOnlyList<IInternalToolExecutor> internalTools) =>
        request with
        {
            Tools = (request.Tools ?? [])
                .Concat(internalTools.SelectMany(tool => tool.GetToolDescriptors()))
                .GroupBy(tool => tool.Name, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .ToArray(),
        };

    private void TryDeleteWorkspace(string id)
    {
        try { _workspaceFactory?.Delete(id); }
        catch { /* Workspace cleanup is best-effort and never broadens file access. */ }
    }

    IReadOnlyList<AgentRecoverySnapshot> IAgentRecoveryStore.LoadAll() =>
        _recoveryStore.LoadAll();

    public void Save(AgentRecoverySnapshot snapshot)
    {
        _recoveryStore.Save(snapshot);
        _recoveries[snapshot.SessionId] = snapshot;
    }

    public void Delete(string sessionId)
    {
        _recoveryStore.Delete(sessionId);
        _recoveries.TryRemove(sessionId, out _);
    }

    public bool ConfirmPlan(string id, string origin, AgentPlanConfirmationRequest request) =>
        TryGet(id, origin, out var session) && session.ConfirmPlan(request);

    public bool SubmitPermission(string id, string origin, AgentPermissionRequest request) =>
        TryGet(id, origin, out var session) && session.SubmitPermission(request);
}
