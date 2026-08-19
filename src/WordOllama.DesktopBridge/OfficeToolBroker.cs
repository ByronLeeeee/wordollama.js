using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;
using WordOllama.Contracts;

namespace WordOllama.DesktopBridge;

public sealed record OfficeToolBrokerStatus(
    bool HostConnected,
    int HostCount,
    int ToolCount,
    IReadOnlyList<OfficeToolHostInfo> Hosts);

public sealed record OfficeToolHostInfo(
    string HostId,
    int ToolCount,
    DateTimeOffset LastSeenAt);

/// <summary>
/// Relays external MCP tool calls to an authenticated Office.js task pane. The
/// pane remains the only process that touches the live Word object model.
/// </summary>
public sealed class OfficeToolBroker
{
    private readonly ConcurrentDictionary<string, HostState> _hosts = new(StringComparer.Ordinal);
    private readonly TimeProvider _timeProvider;
    private readonly TimeSpan _hostTimeout;
    private readonly TimeSpan _toolTimeout;

    public OfficeToolBroker(
        TimeProvider? timeProvider = null,
        TimeSpan? hostTimeout = null,
        TimeSpan? toolTimeout = null)
    {
        _timeProvider = timeProvider ?? TimeProvider.System;
        _hostTimeout = hostTimeout ?? TimeSpan.FromSeconds(45);
        _toolTimeout = toolTimeout ?? TimeSpan.FromSeconds(90);
    }

    public void RegisterHost(
        string sessionToken,
        string hostId,
        string origin,
        IReadOnlyList<OfficeToolDescriptor> tools)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sessionToken);
        ArgumentException.ThrowIfNullOrWhiteSpace(hostId);
        ArgumentException.ThrowIfNullOrWhiteSpace(origin);
        var now = _timeProvider.GetUtcNow();
        _hosts.AddOrUpdate(
            hostId,
            _ => new HostState(sessionToken, hostId, origin, tools, now),
            (_, host) =>
            {
                if (!host.IsOwnedBy(sessionToken))
                    throw new InvalidOperationException("The Office host identifier belongs to another session.");
                host.Update(origin, tools, now);
                return host;
            });
        RemoveStaleHosts(now);
    }

    public async Task<ExternalOfficeToolCall?> WaitForCallAsync(
        string sessionToken,
        string hostId,
        CancellationToken cancellationToken = default)
    {
        if (!_hosts.TryGetValue(hostId, out var host) || !host.IsOwnedBy(sessionToken)) return null;
        host.Touch(_timeProvider.GetUtcNow());
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(25));
        try
        {
            return await host.Queue.Reader.ReadAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            host.Touch(_timeProvider.GetUtcNow());
            return null;
        }
    }

    public bool CompleteCall(
        string sessionToken,
        string hostId,
        string callId,
        ExternalOfficeToolResultRequest result)
    {
        if (!_hosts.TryGetValue(hostId, out var host) || !host.IsOwnedBy(sessionToken)) return false;
        host.Touch(_timeProvider.GetUtcNow());
        return host.Pending.TryRemove(callId, out var pending) &&
            pending.TrySetResult(result);
    }

    public async Task<ExternalOfficeToolResultRequest> CallAsync(
        string name,
        JsonElement arguments,
        string? hostId = null,
        CancellationToken cancellationToken = default)
    {
        var candidates = ResolveHosts(name);
        var host = string.IsNullOrWhiteSpace(hostId)
            ? candidates.Count switch
            {
                0 => throw new InvalidOperationException(
                    "No active Word task pane currently exposes this tool. Open WordOllama in the target document and retry."),
                1 => candidates[0],
                _ => throw new InvalidOperationException(
                    "Multiple Word task panes expose this tool. Call wordollama_status and pass host_id for the target pane."),
            }
            : candidates.FirstOrDefault(candidate =>
                string.Equals(candidate.HostId, hostId, StringComparison.Ordinal))
                ?? throw new InvalidOperationException(
                    $"Word host '{hostId}' is not active or does not expose tool '{name}'.");
        var callId = Guid.NewGuid().ToString("N");
        var pending = new TaskCompletionSource<ExternalOfficeToolResultRequest>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        if (!host.Pending.TryAdd(callId, pending))
            throw new InvalidOperationException("Could not reserve an Office tool call.");

        try
        {
            await host.Queue.Writer.WriteAsync(
                new ExternalOfficeToolCall(callId, name, arguments.Clone()),
                cancellationToken);
            return await pending.Task.WaitAsync(_toolTimeout, cancellationToken);
        }
        catch (TimeoutException)
        {
            throw new TimeoutException(
                $"Word did not return a result for tool '{name}' within {_toolTimeout.TotalSeconds:0} seconds.");
        }
        finally
        {
            host.Pending.TryRemove(callId, out _);
        }
    }

    public IReadOnlyList<OfficeToolDescriptor> GetTools() =>
        ResolveHosts()
            .SelectMany(host => host.GetTools())
            .GroupBy(tool => tool.Name, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToArray();

    public OfficeToolBrokerStatus GetStatus()
    {
        var now = _timeProvider.GetUtcNow();
        RemoveStaleHosts(now);
        var active = _hosts.Values
            .Where(host => now - host.LastSeenAt <= _hostTimeout)
            .OrderByDescending(host => host.LastSeenAt)
            .ToArray();
        var hosts = active.Select(host => host.Describe()).ToArray();
        return new OfficeToolBrokerStatus(
            active.Length > 0,
            active.Length,
            active.SelectMany(host => host.GetTools())
                .Select(tool => tool.Name)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count(),
            hosts);
    }

    private IReadOnlyList<HostState> ResolveHosts(string? requiredTool = null)
    {
        var now = _timeProvider.GetUtcNow();
        RemoveStaleHosts(now);
        return _hosts.Values
            .Where(host => now - host.LastSeenAt <= _hostTimeout)
            .Where(host => requiredTool is null || host.Supports(requiredTool))
            .OrderByDescending(host => host.LastSeenAt)
            .ToArray();
    }

    private void RemoveStaleHosts(DateTimeOffset now)
    {
        foreach (var pair in _hosts)
        {
            if (now - pair.Value.LastSeenAt <= _hostTimeout) continue;
            if (!_hosts.TryRemove(pair.Key, out var removed)) continue;
            foreach (var pending in removed.Pending.Values)
            {
                pending.TrySetException(new InvalidOperationException(
                    "The Word task pane disconnected before the tool call completed."));
            }
        }
    }

    private sealed class HostState
    {
        private readonly object _gate = new();
        private IReadOnlyList<OfficeToolDescriptor> _tools;

        public HostState(
            string sessionToken,
            string hostId,
            string origin,
            IReadOnlyList<OfficeToolDescriptor> tools,
            DateTimeOffset lastSeenAt)
        {
            SessionToken = sessionToken;
            HostId = hostId;
            _origin = origin;
            _tools = tools.ToArray();
            _lastSeenAt = lastSeenAt;
        }

        private string _origin;
        private DateTimeOffset _lastSeenAt;

        public string SessionToken { get; }
        public string HostId { get; }

        public string Origin
        {
            get { lock (_gate) return _origin; }
        }

        public DateTimeOffset LastSeenAt
        {
            get { lock (_gate) return _lastSeenAt; }
        }
        public Channel<ExternalOfficeToolCall> Queue { get; } =
            Channel.CreateUnbounded<ExternalOfficeToolCall>(new UnboundedChannelOptions
            {
                SingleReader = false,
                SingleWriter = false,
            });
        public ConcurrentDictionary<string, TaskCompletionSource<ExternalOfficeToolResultRequest>> Pending { get; } =
            new(StringComparer.Ordinal);

        public void Update(
            string origin,
            IReadOnlyList<OfficeToolDescriptor> tools,
            DateTimeOffset timestamp)
        {
            lock (_gate)
            {
                _origin = origin;
                _tools = tools.ToArray();
                _lastSeenAt = timestamp;
            }
        }

        public void Touch(DateTimeOffset timestamp)
        {
            lock (_gate)
            {
                _lastSeenAt = timestamp;
            }
        }

        public IReadOnlyList<OfficeToolDescriptor> GetTools()
        {
            lock (_gate)
            {
                return _tools.ToArray();
            }
        }

        public bool Supports(string name)
        {
            lock (_gate)
            {
                return _tools.Any(tool => string.Equals(tool.Name, name, StringComparison.OrdinalIgnoreCase));
            }
        }

        public bool IsOwnedBy(string sessionToken) =>
            string.Equals(SessionToken, sessionToken, StringComparison.Ordinal);

        public OfficeToolHostInfo Describe()
        {
            lock (_gate)
            {
                return new OfficeToolHostInfo(HostId, _tools.Count, _lastSeenAt);
            }
        }
    }
}
