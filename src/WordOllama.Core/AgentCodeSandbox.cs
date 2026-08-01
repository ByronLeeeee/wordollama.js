using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace WordOllama.Core;

public interface IAgentCodeSandboxFactory
{
    IAgentCodeSandbox Create(string sessionId, string workspaceRoot);
}

public interface IAgentCodeSandbox : IDisposable
{
    bool Supports(string runtime);
    Task<ProcessExecutionResult> RunAsync(
        string runtime,
        string code,
        TimeSpan timeout,
        CancellationToken cancellationToken = default);
}

public sealed class AgentCodeSandboxFactory : IAgentCodeSandboxFactory
{
    private readonly IProcessRunner _processRunner;
    private readonly string? _pythonExecutable;
    private readonly string? _nodeExecutable;

    public AgentCodeSandboxFactory(
        IProcessRunner processRunner,
        string? pythonExecutable,
        string? nodeExecutable)
    {
        _processRunner = processRunner;
        _pythonExecutable = ResolveExecutable(pythonExecutable);
        _nodeExecutable = ResolveExecutable(nodeExecutable);
    }

    public IAgentCodeSandbox Create(string sessionId, string workspaceRoot) =>
        OperatingSystem.IsWindows()
            ? new WindowsAppContainerSandbox(sessionId, workspaceRoot, _pythonExecutable, _nodeExecutable)
            : OperatingSystem.IsMacOS()
                ? new MacSandboxExecCodeSandbox(_processRunner, workspaceRoot, _pythonExecutable, _nodeExecutable)
                : new UnsupportedCodeSandbox();

    private static string? ResolveExecutable(string? executable)
    {
        if (string.IsNullOrWhiteSpace(executable)) return null;
        if (Path.IsPathRooted(executable)) return File.Exists(executable) ? Path.GetFullPath(executable) : null;
        var extensions = OperatingSystem.IsWindows() && string.IsNullOrEmpty(Path.GetExtension(executable))
            ? new[] { ".exe", ".cmd", ".bat", string.Empty }
            : new[] { string.Empty };
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
                     .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        foreach (var extension in extensions)
        {
            var candidate = Path.Combine(directory, executable + extension);
            if (File.Exists(candidate)) return Path.GetFullPath(candidate);
        }
        return null;
    }
}

internal sealed class UnsupportedCodeSandbox : IAgentCodeSandbox
{
    public bool Supports(string runtime) => false;
    public Task<ProcessExecutionResult> RunAsync(string runtime, string code, TimeSpan timeout,
        CancellationToken cancellationToken = default) =>
        throw new PlatformNotSupportedException("No operating-system code sandbox is available.");
    public void Dispose() { }
}

internal sealed class MacSandboxExecCodeSandbox : IAgentCodeSandbox
{
    private readonly IProcessRunner _runner;
    private readonly string _workspace;
    private readonly IReadOnlyDictionary<string, string?> _runtimes;
    private readonly string? _sandboxExecutable;

    public MacSandboxExecCodeSandbox(
        IProcessRunner runner,
        string workspace,
        string? pythonExecutable,
        string? nodeExecutable)
    {
        _runner = runner;
        _workspace = Path.GetFullPath(workspace);
        _sandboxExecutable = File.Exists("/usr/bin/sandbox-exec") ? "/usr/bin/sandbox-exec" : null;
        _runtimes = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["python"] = pythonExecutable,
            ["node"] = nodeExecutable,
        };
    }

    public bool Supports(string runtime) =>
        _sandboxExecutable is not null && _runtimes.TryGetValue(runtime, out var executable) && executable is not null;

    public async Task<ProcessExecutionResult> RunAsync(
        string runtime,
        string code,
        TimeSpan timeout,
        CancellationToken cancellationToken = default)
    {
        if (!Supports(runtime)) throw new PlatformNotSupportedException($"The {runtime} sandbox is unavailable.");
        var executable = _runtimes[runtime]!;
        var script = Path.Combine(_workspace, $".wordollama-{Guid.NewGuid():N}.{(runtime == "python" ? "py" : "mjs")}");
        await File.WriteAllTextAsync(script, code, new UTF8Encoding(false), cancellationToken);
        var profile = BuildProfile(_workspace, executable!);
        try
        {
            var result = await _runner.RunAsync(new ProcessExecutionRequest(
                _sandboxExecutable!,
                ["-p", profile, executable!, script],
                _workspace,
                MinimalEnvironment(_workspace),
                timeout), cancellationToken);
            EnforceWorkspaceLimit(_workspace);
            return BoundOutput(result);
        }
        finally
        {
            try { File.Delete(script); } catch (IOException) { }
        }
    }

    private static string BuildProfile(string workspace, string executable)
    {
        static string Escape(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        var runtimeDirectory = Path.GetDirectoryName(executable)!;
        return $"(version 1) (deny default) " +
               "(allow process*) (allow sysctl-read) " +
               "(allow mach-lookup (global-name \"com.apple.system.opendirectoryd.libinfo\")) " +
               $"(allow file-read* (subpath \"/System\") (subpath \"/usr\") (subpath \"/Library\") " +
               $"(subpath \"{Escape(runtimeDirectory)}\") (subpath \"{Escape(workspace)}\")) " +
               $"(allow file-write* (subpath \"{Escape(workspace)}\")) " +
               "(deny network*)";
    }

    private static IReadOnlyDictionary<string, string> MinimalEnvironment(string workspace) =>
        new Dictionary<string, string>
        {
            ["HOME"] = workspace,
            ["TMPDIR"] = workspace,
            ["PYTHONIOENCODING"] = "utf-8",
            ["NO_PROXY"] = "*",
        };

    public void Dispose() { }

    internal static void EnforceWorkspaceLimit(string workspace)
    {
        long total = 0;
        foreach (var file in Directory.EnumerateFiles(workspace, "*", SearchOption.AllDirectories))
        {
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Sandbox output contains a link or reparse point.");
            total += new FileInfo(file).Length;
            if (total > 10_485_760) throw new InvalidOperationException("Sandbox workspace exceeded 10 MiB.");
        }
    }

    internal static ProcessExecutionResult BoundOutput(ProcessExecutionResult result) =>
        new(result.ExitCode, Bound(result.Stdout), Bound(result.Stderr), result.TimedOut);

    private static string Bound(string value) => value.Length <= 1_000_000 ? value : value[..1_000_000];
}

internal sealed class WindowsAppContainerSandbox : IAgentCodeSandbox
{
    private readonly string _workspace;
    private readonly string _profileName;
    private readonly IReadOnlyDictionary<string, string?> _runtimes;
    private readonly List<string> _aclRoots = [];
    private IntPtr _appContainerSid;
    private bool _disposed;

    public WindowsAppContainerSandbox(
        string sessionId,
        string workspace,
        string? pythonExecutable,
        string? nodeExecutable)
    {
        _workspace = Path.GetFullPath(workspace);
        Directory.CreateDirectory(_workspace);
        _profileName = "WordOllama.JS.Agent." + sessionId;
        _runtimes = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["python"] = pythonExecutable,
            ["node"] = nodeExecutable,
        };
        InitializeProfile();
    }

    public bool Supports(string runtime) =>
        !_disposed && _appContainerSid != IntPtr.Zero &&
        _runtimes.TryGetValue(runtime, out var executable) && executable is not null;

    public async Task<ProcessExecutionResult> RunAsync(
        string runtime,
        string code,
        TimeSpan timeout,
        CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!Supports(runtime)) throw new PlatformNotSupportedException($"The {runtime} AppContainer sandbox is unavailable.");
        var executable = _runtimes[runtime]!;
        var script = Path.Combine(_workspace, $".wordollama-{Guid.NewGuid():N}.{(runtime == "python" ? "py" : "mjs")}");
        await File.WriteAllTextAsync(script, code, new UTF8Encoding(false), cancellationToken);
        try
        {
            return await RunAppContainerAsync(executable!, script, timeout, cancellationToken);
        }
        finally
        {
            try { File.Delete(script); } catch (IOException) { }
        }
    }

    private void InitializeProfile()
    {
        var hr = CreateAppContainerProfile(_profileName, _profileName,
            "Per-session WordOllama.JS code sandbox", IntPtr.Zero, 0, out _appContainerSid);
        const int AlreadyExists = unchecked((int)0x800700B7);
        if (hr == AlreadyExists)
            hr = DeriveAppContainerSidFromAppContainerName(_profileName, out _appContainerSid);
        if (hr < 0 || _appContainerSid == IntPtr.Zero) return;
        var sid = SidToString(_appContainerSid);
        GrantAcl(_workspace, sid, "(OI)(CI)M", recursive: false);
        foreach (var runtimeDirectory in _runtimes.Values
                     .Where(value => value is not null)
                     .Select(value => Path.GetDirectoryName(value!)!)
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (IsUserOwnedPath(runtimeDirectory))
            {
                GrantAcl(runtimeDirectory, sid, "(OI)(CI)RX", recursive: true);
                _aclRoots.Add(runtimeDirectory);
            }
        }
    }

    private async Task<ProcessExecutionResult> RunAppContainerAsync(
        string executable,
        string script,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var stdoutPath = Path.Combine(_workspace, $".stdout-{Guid.NewGuid():N}.txt");
        var stderrPath = Path.Combine(_workspace, $".stderr-{Guid.NewGuid():N}.txt");
        IntPtr stdout = IntPtr.Zero, stderr = IntPtr.Zero, stdin = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero, capabilitiesPointer = IntPtr.Zero, environment = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        PROCESS_INFORMATION process = default;
        try
        {
            var security = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(), bInheritHandle = true };
            stdout = CreateFileW(stdoutPath, GenericWrite, FileShareRead | FileShareWrite, ref security, CreateAlways, NormalAttribute, IntPtr.Zero);
            stderr = CreateFileW(stderrPath, GenericWrite, FileShareRead | FileShareWrite, ref security, CreateAlways, NormalAttribute, IntPtr.Zero);
            stdin = CreateFileW("NUL", GenericRead, FileShareRead | FileShareWrite, ref security, OpenExisting, NormalAttribute, IntPtr.Zero);
            EnsureHandle(stdout); EnsureHandle(stderr); EnsureHandle(stdin);

            nuint attributeSize = 0;
            _ = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
            attributeList = Marshal.AllocHGlobal(checked((int)attributeSize));
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize)) ThrowLastWin32("initialize process attributes");
            var capabilities = new SECURITY_CAPABILITIES { AppContainerSid = _appContainerSid };
            capabilitiesPointer = Marshal.AllocHGlobal(Marshal.SizeOf<SECURITY_CAPABILITIES>());
            Marshal.StructureToPtr(capabilities, capabilitiesPointer, false);
            if (!UpdateProcThreadAttribute(attributeList, 0, ProcThreadAttributeSecurityCapabilities,
                    capabilitiesPointer, (nuint)Marshal.SizeOf<SECURITY_CAPABILITIES>(), IntPtr.Zero, IntPtr.Zero))
                ThrowLastWin32("apply AppContainer security capabilities");
            var startup = new STARTUPINFOEX
            {
                StartupInfo = new STARTUPINFO
                {
                    cb = Marshal.SizeOf<STARTUPINFOEX>(),
                    dwFlags = StartfUseStdHandles,
                    hStdInput = stdin,
                    hStdOutput = stdout,
                    hStdError = stderr,
                },
                lpAttributeList = attributeList,
            };
            environment = BuildEnvironmentBlock(_workspace);
            var commandLine = new StringBuilder(Quote(executable) + " " + Quote(script));
            var flags = ExtendedStartupInfoPresent | CreateNoWindow | CreateUnicodeEnvironment | CreateSuspended;
            if (!CreateProcessW(executable, commandLine, IntPtr.Zero, IntPtr.Zero, true, flags,
                    environment, _workspace, ref startup, out process))
                ThrowLastWin32("start AppContainer process");

            job = CreateJobObjectW(IntPtr.Zero, null);
            EnsureHandle(job);
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
            {
                BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
                {
                    LimitFlags = JobObjectLimitKillOnJobClose | JobObjectLimitActiveProcess | JobObjectLimitJobMemory,
                    ActiveProcessLimit = 16,
                },
                JobMemoryLimit = (nuint)(512L * 1024 * 1024),
            };
            var limitsSize = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
            var limitsPointer = Marshal.AllocHGlobal(limitsSize);
            try
            {
                Marshal.StructureToPtr(limits, limitsPointer, false);
                if (!SetInformationJobObject(job, 9, limitsPointer, (uint)limitsSize)) ThrowLastWin32("configure sandbox job");
            }
            finally { Marshal.FreeHGlobal(limitsPointer); }
            if (!AssignProcessToJobObject(job, process.hProcess)) ThrowLastWin32("assign sandbox process job");
            if (ResumeThread(process.hThread) == uint.MaxValue) ThrowLastWin32("resume sandbox process");

            var deadline = DateTimeOffset.UtcNow + timeout;
            var timedOut = false;
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var wait = WaitForSingleObject(process.hProcess, 100);
                if (wait == WaitObject0) break;
                if (wait == WaitFailed) ThrowLastWin32("wait for sandbox process");
                if (DateTimeOffset.UtcNow >= deadline)
                {
                    timedOut = true;
                    _ = TerminateJobObject(job, 124);
                    _ = WaitForSingleObject(process.hProcess, 5000);
                    break;
                }
                await Task.Yield();
                MacSandboxExecCodeSandbox.EnforceWorkspaceLimit(_workspace);
            }
            if (!GetExitCodeProcess(process.hProcess, out var exitCode)) ThrowLastWin32("read sandbox exit code");
            Close(ref stdout); Close(ref stderr); Close(ref stdin);
            MacSandboxExecCodeSandbox.EnforceWorkspaceLimit(_workspace);
            var result = new ProcessExecutionResult(
                unchecked((int)exitCode),
                ReadBounded(stdoutPath),
                ReadBounded(stderrPath),
                timedOut);
            return MacSandboxExecCodeSandbox.BoundOutput(result);
        }
        catch
        {
            if (job != IntPtr.Zero && job != InvalidHandle) _ = TerminateJobObject(job, 125);
            throw;
        }
        finally
        {
            Close(ref stdout); Close(ref stderr); Close(ref stdin);
            Close(ref process.hThread); Close(ref process.hProcess); Close(ref job);
            if (attributeList != IntPtr.Zero) { DeleteProcThreadAttributeList(attributeList); Marshal.FreeHGlobal(attributeList); }
            if (capabilitiesPointer != IntPtr.Zero) Marshal.FreeHGlobal(capabilitiesPointer);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            try { File.Delete(stdoutPath); } catch (IOException) { }
            try { File.Delete(stderrPath); } catch (IOException) { }
        }
    }

    private static IntPtr BuildEnvironmentBlock(string workspace)
    {
        var values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["HOME"] = workspace,
            ["USERPROFILE"] = workspace,
            ["TEMP"] = workspace,
            ["TMP"] = workspace,
            ["PYTHONIOENCODING"] = "utf-8",
            ["NO_PROXY"] = "*",
            ["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows",
            ["WINDIR"] = Environment.GetEnvironmentVariable("WINDIR") ?? @"C:\Windows",
        };
        var block = string.Join('\0', values.Select(pair => $"{pair.Key}={pair.Value}")) + "\0\0";
        return Marshal.StringToHGlobalUni(block);
    }

    private static string Quote(string value) => "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    private static string ReadBounded(string path)
    {
        if (!File.Exists(path)) return string.Empty;
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        var length = checked((int)Math.Min(stream.Length, 1_000_000));
        var bytes = new byte[length];
        _ = stream.Read(bytes, 0, length);
        return Encoding.UTF8.GetString(bytes);
    }

    private static bool IsUserOwnedPath(string path)
    {
        var user = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return !string.IsNullOrWhiteSpace(user) && Path.GetFullPath(path).StartsWith(
            Path.GetFullPath(user).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase);
    }

    private void GrantAcl(string path, string sid, string rights, bool recursive)
    {
        var args = new List<string> { path, "/grant", $"*{sid}:{rights}" };
        if (recursive) args.AddRange(["/T", "/C"]);
        RunIcacls(args);
    }

    private static void RunIcacls(IReadOnlyList<string> arguments)
    {
        var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "icacls.exe"))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Unable to configure AppContainer access.");
        if (!process.WaitForExit(30_000) || process.ExitCode != 0)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            throw new InvalidOperationException("Unable to configure AppContainer filesystem access.");
        }
    }

    private static string SidToString(IntPtr sid)
    {
        if (!ConvertSidToStringSidW(sid, out var text)) ThrowLastWin32("format AppContainer SID");
        try { return Marshal.PtrToStringUni(text) ?? throw new InvalidOperationException("Invalid AppContainer SID."); }
        finally { _ = LocalFree(text); }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_appContainerSid != IntPtr.Zero)
        {
            string? sid = null;
            try { sid = SidToString(_appContainerSid); } catch { }
            if (sid is not null)
            {
                foreach (var root in _aclRoots.Append(_workspace))
                {
                    try { RunIcacls([root, "/remove", $"*{sid}", "/T", "/C"]); } catch { }
                }
            }
            FreeSid(_appContainerSid);
            _appContainerSid = IntPtr.Zero;
        }
        _ = DeleteAppContainerProfile(_profileName);
    }

    private static void EnsureHandle(IntPtr handle)
    {
        if (handle == IntPtr.Zero || handle == InvalidHandle) ThrowLastWin32("open sandbox handle");
    }
    private static void Close(ref IntPtr handle)
    {
        if (handle != IntPtr.Zero && handle != InvalidHandle) _ = CloseHandle(handle);
        handle = IntPtr.Zero;
    }
    private static void ThrowLastWin32(string operation) =>
        throw new Win32Exception(Marshal.GetLastWin32Error(), $"Unable to {operation}.");

    private static readonly IntPtr InvalidHandle = new(-1);
    private const uint GenericRead = 0x80000000, GenericWrite = 0x40000000;
    private const uint FileShareRead = 1, FileShareWrite = 2, CreateAlways = 2, OpenExisting = 3, NormalAttribute = 0x80;
    private const uint StartfUseStdHandles = 0x100;
    private const uint ExtendedStartupInfoPresent = 0x00080000, CreateNoWindow = 0x08000000,
        CreateUnicodeEnvironment = 0x00000400, CreateSuspended = 0x00000004;
    private static readonly IntPtr ProcThreadAttributeSecurityCapabilities = new(0x00020009);
    private const uint JobObjectLimitActiveProcess = 0x8, JobObjectLimitJobMemory = 0x200,
        JobObjectLimitKillOnJobClose = 0x2000;
    private const uint WaitObject0 = 0, WaitFailed = 0xffffffff;

    [StructLayout(LayoutKind.Sequential)] private struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct STARTUPINFO { public int cb; public string? lpReserved, lpDesktop, lpTitle; public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] private struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] private struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] private struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid, Capabilities; public uint CapabilityCount, Reserved; }
    [StructLayout(LayoutKind.Sequential)] private struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public nuint MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public nuint Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public nuint ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int CreateAppContainerProfile(string name, string displayName, string description, IntPtr capabilities, uint capabilityCount, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ConvertSidToStringSidW(IntPtr sid, out IntPtr stringSid);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateFileW(string fileName, uint desiredAccess, uint shareMode, ref SECURITY_ATTRIBUTES securityAttributes, uint creationDisposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref nuint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, nuint size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint informationLength);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
