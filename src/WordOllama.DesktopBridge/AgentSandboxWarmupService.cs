using System.ComponentModel;
using WordOllama.Core;

namespace WordOllama.DesktopBridge;

public sealed class AgentSandboxWarmupService : BackgroundService
{
    private readonly IAgentCodeSandboxFactory _sandboxFactory;
    private readonly string _warmupRoot;
    private readonly ILogger<AgentSandboxWarmupService> _logger;

    public AgentSandboxWarmupService(
        IAgentCodeSandboxFactory sandboxFactory,
        string warmupRoot,
        ILogger<AgentSandboxWarmupService> logger)
    {
        _sandboxFactory = sandboxFactory;
        _warmupRoot = Path.GetFullPath(warmupRoot);
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the Bridge begin accepting normal UI requests before touching any
        // optional runtime or AppContainer API.
        await Task.Yield();

        var warmupId = "warmup" + Guid.NewGuid().ToString("N");
        var workspace = Path.Combine(_warmupRoot, warmupId);
        try
        {
            Directory.CreateDirectory(workspace);
            using var sandbox = _sandboxFactory.Create(warmupId, workspace);
            var runtime = sandbox.Supports("node")
                ? "node"
                : sandbox.Supports("python")
                    ? "python"
                    : null;
            if (runtime is null)
            {
                _logger.LogInformation(
                    "Agent code sandbox warm-up completed without an available code runtime; " +
                    "Agent workspace and Office tools remain available.");
                return;
            }

            var probe = runtime == "node"
                ? "process.stdout.write('wordollama-agent-sandbox-ready')"
                : "print('wordollama-agent-sandbox-ready')";
            var result = await sandbox.RunAsync(
                runtime,
                probe,
                TimeSpan.FromSeconds(10),
                stoppingToken);
            if (result.ExitCode == 0 &&
                result.Stdout.Contains(
                    "wordollama-agent-sandbox-ready",
                    StringComparison.Ordinal))
            {
                _logger.LogInformation(
                    "Agent code sandbox warm-up completed with {Runtime}.",
                    runtime);
                return;
            }

            _logger.LogWarning(
                "Agent code sandbox warm-up did not complete successfully for {Runtime}; " +
                "Agent sessions will continue without code execution when necessary.",
                runtime);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal Bridge shutdown.
        }
        catch (Exception exception) when (
            exception is Win32Exception or IOException or UnauthorizedAccessException or
            InvalidOperationException or NotSupportedException)
        {
            _logger.LogWarning(
                exception,
                "Agent code sandbox warm-up failed; Agent sessions will continue without " +
                "Python/Node execution when necessary.");
        }
        finally
        {
            try
            {
                if (Directory.Exists(workspace))
                {
                    Directory.Delete(workspace, recursive: true);
                }
                if (Directory.Exists(_warmupRoot) &&
                    !Directory.EnumerateFileSystemEntries(_warmupRoot).Any())
                {
                    Directory.Delete(_warmupRoot);
                }
            }
            catch (Exception exception) when (
                exception is IOException or UnauthorizedAccessException)
            {
                _logger.LogDebug(exception, "Unable to remove the Agent sandbox warm-up workspace.");
            }
        }
    }
}
