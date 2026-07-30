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
    private readonly bool _allowExternalTools;
    private readonly double? _temperature;
    private readonly int? _maxTokens;
    private readonly int? _contextWindow;
    private readonly string? _keepAlive;
    private readonly string _languageMode;
    private readonly string _uiLocale;
    private int _iterations;
    private bool _completed;
    private AgentCheckpoint? _checkpoint;

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
        _maxIterations = request.MaxIterations <= 0 ? int.MaxValue : Math.Clamp(request.MaxIterations, 1, 1000);
        _executionMode = NormalizeExecutionMode(request.ExecutionMode);
        _allowExternalTools = request.AllowExternalTools;
        _temperature = request.Temperature;
        _maxTokens = request.MaxTokens;
        _contextWindow = request.ContextWindow;
        _keepAlive = request.KeepAlive;
        _languageMode = NormalizeLanguageMode(request.LanguageMode);
        _uiLocale = UiText.NormalizeLocale(request.UiLocale);
        var internalToolNames = _internalTools
            .SelectMany(tool => tool.GetToolDescriptors())
            .Select(tool => tool.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        _advertisedTools = _tools
            .Where(tool => (_executionMode == "TrackedChanges" || !tool.IsWriteOperation) &&
                (!internalToolNames.Contains(tool.Name) ||
                 _allowExternalTools ||
                 string.Equals(tool.Name, "read_skill", StringComparison.OrdinalIgnoreCase)))
            .ToArray();
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
                (_executionMode == "ViewOnly"
                    ? "The session is ViewOnly: analyze and answer without changing the document."
                    : _executionMode == "ProposeChanges"
                        ? "The session is ProposeChanges: describe proposed edits but do not change the document."
                        : "The session is TrackedChanges: document writes are permitted and the host records revisions.") +
                LanguageInstruction(_languageMode)));
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
        : _requirePlanConfirmation && !_planApproval.Task.IsCompleted
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
        if (_completed || _planApproval.Task.IsCompleted)
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
                !string.IsNullOrWhiteSpace(_request.ImageDataUrl));

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
            if (_requirePlanConfirmation && !_isRecovered)
            {
                Publish(new RuntimeEvent(
                    "plan_pending",
                    Message: Localize("AgentPlanPending"),
                    Data: JsonSerializer.SerializeToElement(new
                    {
                        userRequirement = UserRequirement,
                        executionMode = _executionMode,
                        maxIterations = _maxIterations,
                    })));
            }

            if (!await _planApproval.Task.WaitAsync(_cancellation.Token))
            {
                Publish(new RuntimeEvent(
                    "failed",
                    Message: Localize("AgentPlanRejected")));
                Complete();
                return;
            }

            while (!_cancellation.IsCancellationRequested && _iterations++ < _maxIterations)
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
                var response = await _provider.ChatAsync(
                    new ProviderChatRequest(
                        _messages,
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
                    ToolCalls: calls));

                var results = new List<(ProviderToolCall Call, ToolResult Result)>();
                foreach (var call in calls)
                {
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
                        if (!_allowExternalTools && !string.Equals(call.Name, "read_skill", StringComparison.OrdinalIgnoreCase))
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
                            if (internalTool.RequiresConfirmation(call.Name))
                            {
                                var permission = new TaskCompletionSource<bool>(
                                    TaskCreationOptions.RunContinuationsAsynchronously);
                                lock (_gate)
                                {
                                    _pendingPermissions[call.Id] = permission;
                                }
                                Publish(new RuntimeEvent(
                                    "permission_request",
                                    Message: call.Name,
                                    Data: JsonSerializer.SerializeToElement(new
                                    {
                                        callId = call.Id,
                                        name = call.Name,
                                        execution = "bridge",
                                        @params = call.Arguments,
                                    })));
                                var approved = await permission.Task.WaitAsync(_cancellation.Token);
                                lock (_gate)
                                {
                                    _pendingPermissions.Remove(call.Id);
                                }
                                if (!approved)
                                {
                                    throw new InvalidOperationException(
                                        Localize("AgentHighRiskRejected"));
                                }
                            }
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
                }
            }

            Publish(new RuntimeEvent(
                "failed",
                Message: Localize("AgentIterationLimit")));
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
    private readonly ConcurrentDictionary<string, AgentSession> _sessions = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, AgentRecoverySnapshot> _recoveries = new(StringComparer.Ordinal);
    private readonly object _recoveryGate = new();

    public AgentSessionManager(
        IModelProvider provider,
        IEnumerable<IInternalToolExecutor> internalTools,
        IAgentRecoveryStore? recoveryStore = null)
    {
        _provider = provider;
        _internalTools = internalTools.ToArray();
        _recoveryStore = recoveryStore ?? new NullAgentRecoveryStore();
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
        var session = new AgentSession(
            Guid.NewGuid().ToString("N"),
            origin,
            request,
            _provider,
            _internalTools,
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
            session = new AgentSession(
                recovery.SessionId,
                recovery.Origin,
                recovery.Request,
                _provider,
                _internalTools,
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
                    !string.IsNullOrWhiteSpace(message.ImageDataUrl))));
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
    }

    private void RemoveLiveSession(string id) => _sessions.TryRemove(id, out _);

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
