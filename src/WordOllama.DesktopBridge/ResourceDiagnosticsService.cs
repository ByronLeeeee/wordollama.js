using System.Diagnostics;
using WordOllama.Contracts;

namespace WordOllama.DesktopBridge;

public sealed class ResourceDiagnosticsService
{
    private readonly object _gate = new();
    private readonly Dictionary<string, CpuSample> _cpuSamples = new(StringComparer.Ordinal);

    public ResourceDiagnosticsSnapshot Capture(int connectedMcpServers, int activeAgentSessions)
    {
        var now = DateTimeOffset.UtcNow;
        var bridgeProcesses = new[] { Process.GetCurrentProcess() };
        var ollamaProcesses = FindOllamaProcesses();
        try
        {
            return new ResourceDiagnosticsSnapshot(
                now,
                CaptureGroup("bridge", bridgeProcesses, now),
                CaptureGroup("ollama", ollamaProcesses, now),
                connectedMcpServers,
                activeAgentSessions);
        }
        finally
        {
            foreach (var process in bridgeProcesses.Concat(ollamaProcesses)) process.Dispose();
        }
    }

    private ProcessResourceSnapshot CaptureGroup(
        string key,
        IReadOnlyCollection<Process> processes,
        DateTimeOffset now)
    {
        long workingSetBytes = 0;
        long privateBytes = 0;
        var cpuTime = TimeSpan.Zero;
        var accessibleCount = 0;
        foreach (var process in processes)
        {
            try
            {
                process.Refresh();
                if (process.HasExited) continue;
                workingSetBytes += process.WorkingSet64;
                privateBytes += process.PrivateMemorySize64;
                cpuTime += process.TotalProcessorTime;
                accessibleCount++;
            }
            catch (Exception exception) when (
                exception is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException)
            {
                // A process can exit between discovery and sampling, or deny inspection.
            }
        }

        double cpuPercent = 0;
        lock (_gate)
        {
            if (_cpuSamples.TryGetValue(key, out var previous))
            {
                var elapsed = (now - previous.CapturedAt).TotalSeconds;
                var cpuSeconds = (cpuTime - previous.CpuTime).TotalSeconds;
                if (elapsed > 0 && cpuSeconds >= 0)
                {
                    cpuPercent = Math.Clamp(
                        cpuSeconds / elapsed / Math.Max(1, Environment.ProcessorCount) * 100,
                        0,
                        100);
                }
            }
            _cpuSamples[key] = new CpuSample(now, cpuTime);
        }

        return new ProcessResourceSnapshot(
            accessibleCount,
            workingSetBytes,
            privateBytes,
            Math.Round(cpuPercent, 1));
    }

    private static Process[] FindOllamaProcesses()
    {
        try
        {
            return Process.GetProcesses()
                .Where(process =>
                {
                    try { return process.ProcessName.Contains("ollama", StringComparison.OrdinalIgnoreCase); }
                    catch { return false; }
                })
                .ToArray();
        }
        catch
        {
            return [];
        }
    }

    private sealed record CpuSample(DateTimeOffset CapturedAt, TimeSpan CpuTime);
}
