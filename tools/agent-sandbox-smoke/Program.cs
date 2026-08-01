using WordOllama.Core;

if (!OperatingSystem.IsWindows())
{
    Console.WriteLine("Agent sandbox smoke is skipped: this runner is not Windows.");
    return;
}

var root = Path.Combine(Path.GetTempPath(), "wordollama-agent-sandbox-smoke-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    var factory = new AgentCodeSandboxFactory(new ProcessRunner(), "python", "node");
    using var sandbox = factory.Create(Guid.NewGuid().ToString("N"), root);
    Assert(sandbox.Supports("node"), "Node AppContainer backend is available");

    var hello = await sandbox.RunAsync(
        "node",
        "console.log('sandbox-ok')",
        TimeSpan.FromSeconds(10));
    Assert(hello.ExitCode == 0 && hello.Stdout.Contains("sandbox-ok", StringComparison.Ordinal),
        "Node executes inside the AppContainer");

    var linkTarget = Path.Combine(Path.GetTempPath(), "wordollama-agent-link-target-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(linkTarget);
    var linkPath = Path.Combine(root, "outside-link");
    CreateDirectoryReparsePoint(linkPath, linkTarget);
    var linkRejected = false;
    try
    {
        await sandbox.RunAsync("node", "console.log('must-not-run')", TimeSpan.FromSeconds(10));
    }
    catch (InvalidOperationException exception) when (
        exception.Message.Contains("link or reparse point", StringComparison.Ordinal))
    {
        linkRejected = true;
    }
    Assert(linkRejected, "workspace mirror rejects symbolic links and reparse points");
    Directory.Delete(linkPath, recursive: false);
    Directory.Delete(linkTarget, recursive: true);

    var network = await sandbox.RunAsync(
        "node",
        "fetch('https://example.com').then(()=>console.log('network-open')).catch(()=>console.log('network-blocked'))",
        TimeSpan.FromSeconds(10));
    Assert(!network.Stdout.Contains("network-open", StringComparison.Ordinal) &&
           network.Stdout.Contains("network-blocked", StringComparison.Ordinal),
        "AppContainer denies network access");

    var outsidePath = Path.Combine(Path.GetTempPath(), "wordollama-agent-outside-" + Guid.NewGuid().ToString("N") + ".txt");
    var escapedOutside = outsidePath.Replace("\\", "\\\\").Replace("'", "\\'");
    var outsideWrite = await sandbox.RunAsync(
        "node",
        $"require('fs').writeFileSync('{escapedOutside}','forbidden')",
        TimeSpan.FromSeconds(10));
    Assert(outsideWrite.ExitCode != 0 && !File.Exists(outsidePath),
        "AppContainer denies writes outside the task workspace");

    var timeoutMarker = Path.Combine(root, "timeout-child-survived.txt");
    var escapedTimeoutMarker = timeoutMarker.Replace("\\", "\\\\").Replace("'", "\\'");
    var timeout = await sandbox.RunAsync(
        "node",
        $"const{{spawn}}=require('child_process');spawn(process.execPath,['-e',\"setTimeout(()=>require('fs').writeFileSync('{escapedTimeoutMarker}','bad'),3000)\"]);setInterval(()=>{{}},1000)",
        TimeSpan.FromMilliseconds(700));
    Assert(timeout.TimedOut, "sandbox timeout is reported");
    await Task.Delay(TimeSpan.FromSeconds(4));
    Assert(!File.Exists(timeoutMarker), "timeout terminates the complete sandbox process tree");

    using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
    var cancelled = false;
    try
    {
        await sandbox.RunAsync(
            "node",
            "setInterval(()=>{},1000)",
            TimeSpan.FromSeconds(30),
            cancellation.Token);
    }
    catch (OperationCanceledException)
    {
        cancelled = true;
    }
    Assert(cancelled, "sandbox cancellation interrupts execution");

    var oversizedOutput = await sandbox.RunAsync(
        "node",
        "process.stdout.write('x'.repeat(1200000))",
        TimeSpan.FromSeconds(10));
    Assert(oversizedOutput.Stdout.Length == 1_000_000, "sandbox output is bounded to 1 MB");

    Console.WriteLine("Windows Agent AppContainer smoke passed.");
}
finally
{
    if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
}

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException("Agent sandbox smoke failed: " + message);
    Console.WriteLine("PASS: " + message);
}

static void CreateDirectoryReparsePoint(string linkPath, string targetPath)
{
    try
    {
        Directory.CreateSymbolicLink(linkPath, targetPath);
        return;
    }
    catch (IOException)
    {
        var start = new System.Diagnostics.ProcessStartInfo(
            Environment.GetEnvironmentVariable("ComSpec") ?? @"C:\Windows\System32\cmd.exe")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in new[] { "/d", "/c", "mklink", "/J", linkPath, targetPath })
            start.ArgumentList.Add(argument);
        using var process = System.Diagnostics.Process.Start(start)
            ?? throw new InvalidOperationException("Unable to start junction fixture creation.");
        process.WaitForExit();
        if (process.ExitCode != 0)
            throw new InvalidOperationException("Unable to create the reparse-point fixture: " + process.StandardError.ReadToEnd());
    }
}
