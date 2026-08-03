using System.Text;
using System.Text.Json;
using System.Collections.Concurrent;
using System.ComponentModel;
using WordOllama.Contracts;

namespace WordOllama.Core;

public interface IAgentWorkspaceFactory
{
    IInternalToolExecutor Create(string sessionId);
    void Delete(string sessionId);
}

public sealed class AgentWorkspaceFactory : IAgentWorkspaceFactory
{
    private readonly string _root;
    private readonly IAgentCodeSandboxFactory? _sandboxFactory;
    private readonly ConcurrentDictionary<string, AgentWorkspaceToolExecutor> _executors = new(StringComparer.Ordinal);

    public AgentWorkspaceFactory(string root, IAgentCodeSandboxFactory? sandboxFactory = null)
    {
        _root = Path.GetFullPath(root);
        _sandboxFactory = sandboxFactory;
        Directory.CreateDirectory(_root);
    }

    public IInternalToolExecutor Create(string sessionId)
    {
        sessionId = ValidateSessionId(sessionId);
        return _executors.GetOrAdd(sessionId, id =>
        {
            var workspace = Path.Combine(_root, id);
            IAgentCodeSandbox? sandbox = null;
            try
            {
                sandbox = _sandboxFactory?.Create(id, workspace);
            }
            catch (Exception exception) when (
                exception is Win32Exception or IOException or UnauthorizedAccessException or
                InvalidOperationException or NotSupportedException)
            {
                Console.Error.WriteLine(
                    "Agent code sandbox is unavailable; continuing without Python/Node execution: " +
                    exception.Message);
            }
            return new AgentWorkspaceToolExecutor(workspace, sandbox);
        });
    }

    public void Delete(string sessionId)
    {
        sessionId = ValidateSessionId(sessionId);
        if (_executors.TryRemove(sessionId, out var executor)) executor.Dispose();
        var path = Path.Combine(_root, sessionId);
        if (!Directory.Exists(path)) return;
        var directories = new List<string>();
        var files = new List<string>();
        var pending = new Stack<string>();
        pending.Push(path);
        while (pending.TryPop(out var current))
        {
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Agent workspace contains a reparse point and cannot be removed safely.");
            directories.Add(current);
            foreach (var entry in Directory.EnumerateFileSystemEntries(current))
            {
                var attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("Agent workspace contains a reparse point and cannot be removed safely.");
                if ((attributes & FileAttributes.Directory) != 0) pending.Push(entry);
                else files.Add(entry);
            }
        }
        foreach (var file in files) File.Delete(file);
        foreach (var directory in directories.OrderByDescending(value => value.Length)) Directory.Delete(directory);
    }

    private static string ValidateSessionId(string value) =>
        value.Length is >= 16 and <= 64 && value.All(char.IsAsciiLetterOrDigit)
            ? value
            : throw new ArgumentException("Invalid Agent session identifier.", nameof(value));
}

public sealed class AgentWorkspaceToolExecutor : IInternalToolExecutor, IDisposable
{
    private const int MaxFileBytes = 1_048_576;
    private const long MaxWorkspaceBytes = 10_485_760;
    private const int MaxListedFiles = 500;
    private readonly string _root;
    private readonly string _rootPrefix;
    private readonly IAgentCodeSandbox? _sandbox;

    public AgentWorkspaceToolExecutor(string root, IAgentCodeSandbox? sandbox = null)
    {
        _root = Path.GetFullPath(root);
        Directory.CreateDirectory(_root);
        RejectReparsePoint(_root);
        _rootPrefix = _root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
            Path.DirectorySeparatorChar;
        _sandbox = sandbox;
    }

    public bool IsKnownTool(string name) =>
        name is "list_workspace_files" or "read_workspace_file" or "write_workspace_file" ||
        (name == "run_python" && _sandbox?.Supports("python") == true) ||
        (name == "run_node" && _sandbox?.Supports("node") == true);

    public bool RequiresConfirmation(string name) => name is "run_python" or "run_node";

    public IReadOnlyList<OfficeToolDescriptor> GetToolDescriptors()
    {
        var tools = new List<OfficeToolDescriptor>
        {
        new("list_workspace_files", "List files in this Agent session's isolated workspace.", false,
            JsonSerializer.SerializeToElement(new
            {
                type = "object",
                properties = new { path = new { type = "string" } },
            })),
        new("read_workspace_file", "Read a UTF-8 text file from this Agent session's isolated workspace.", false,
            JsonSerializer.SerializeToElement(new
            {
                type = "object",
                properties = new { path = new { type = "string" } },
                required = new[] { "path" },
            })),
        new("write_workspace_file", "Create or replace a UTF-8 text file in this Agent session's isolated workspace.", false,
            JsonSerializer.SerializeToElement(new
            {
                type = "object",
                properties = new
                {
                    path = new { type = "string" },
                    content = new { type = "string" },
                },
                required = new[] { "path", "content" },
            })),
        };
        if (_sandbox?.Supports("python") == true)
            tools.Add(CodeTool("run_python", "Run Python code inside this session's isolated, network-disabled workspace."));
        if (_sandbox?.Supports("node") == true)
            tools.Add(CodeTool("run_node", "Run Node.js code inside this session's isolated, network-disabled workspace."));
        return tools;
    }

    private static OfficeToolDescriptor CodeTool(string name, string description) =>
        new(name, description, false, JsonSerializer.SerializeToElement(new
        {
            type = "object",
            properties = new
            {
                code = new { type = "string" },
                timeout_seconds = new { type = "integer", minimum = 1, maximum = 120 },
            },
            required = new[] { "code" },
        }));

    public Task<string> ExecuteAsync(
        string name,
        JsonElement arguments,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (name is "run_python" or "run_node")
            return RunCodeAsync(name == "run_python" ? "python" : "node", arguments, cancellationToken);
        return Task.FromResult(name switch
        {
            "list_workspace_files" => List(ReadString(arguments, "path", required: false)),
            "read_workspace_file" => Read(ReadString(arguments, "path")),
            "write_workspace_file" => Write(
                ReadString(arguments, "path"),
                ReadString(arguments, "content")),
            _ => throw new InvalidOperationException($"Unknown workspace tool: {name}"),
        });
    }

    private async Task<string> RunCodeAsync(
        string runtime,
        JsonElement arguments,
        CancellationToken cancellationToken)
    {
        if (_sandbox is null || !_sandbox.Supports(runtime))
            throw new InvalidOperationException($"The {runtime} sandbox is unavailable on this device.");
        var code = ReadString(arguments, "code");
        if (code.Length > 100_000) throw new InvalidOperationException("Sandbox code exceeds 100,000 characters.");
        var timeoutSeconds = arguments.TryGetProperty("timeout_seconds", out var timeoutValue) &&
            timeoutValue.TryGetInt32(out var requestedTimeout)
                ? Math.Clamp(requestedTimeout, 1, 120)
                : 30;
        var result = await _sandbox.RunAsync(runtime, code, TimeSpan.FromSeconds(timeoutSeconds), cancellationToken);
        return JsonSerializer.Serialize(new
        {
            result.ExitCode,
            result.Stdout,
            result.Stderr,
            result.TimedOut,
        });
    }

    public void Dispose() => _sandbox?.Dispose();

    private string List(string relativePath)
    {
        var directory = Resolve(relativePath, allowRoot: true);
        if (!Directory.Exists(directory)) throw new DirectoryNotFoundException("Workspace directory was not found.");
        RejectTreeReparsePoints(directory);
        var files = Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories)
            .Take(MaxListedFiles + 1)
            .Select(path => Path.GetRelativePath(_root, path).Replace(Path.DirectorySeparatorChar, '/'))
            .ToArray();
        if (files.Length > MaxListedFiles) throw new InvalidOperationException("Workspace contains too many files to list.");
        return JsonSerializer.Serialize(new { files });
    }

    private string Read(string relativePath)
    {
        var path = Resolve(relativePath);
        if (!File.Exists(path)) throw new FileNotFoundException("Workspace file was not found.");
        RejectReparsePoint(path);
        var info = new FileInfo(path);
        if (info.Length > MaxFileBytes) throw new InvalidOperationException("Workspace file exceeds the 1 MiB limit.");
        return JsonSerializer.Serialize(new
        {
            path = Path.GetRelativePath(_root, path).Replace(Path.DirectorySeparatorChar, '/'),
            content = File.ReadAllText(path, Encoding.UTF8),
        });
    }

    private string Write(string relativePath, string content)
    {
        var bytes = Encoding.UTF8.GetByteCount(content);
        if (bytes > MaxFileBytes) throw new InvalidOperationException("Workspace file exceeds the 1 MiB limit.");
        var path = Resolve(relativePath);
        EnsureSafeParents(path);
        if (File.Exists(path)) RejectReparsePoint(path);
        RejectTreeReparsePoints(_root);
        var existingBytes = File.Exists(path) ? new FileInfo(path).Length : 0;
        var currentBytes = Directory.EnumerateFiles(_root, "*", SearchOption.AllDirectories)
            .Sum(file => new FileInfo(file).Length);
        if (currentBytes - existingBytes + bytes > MaxWorkspaceBytes)
            throw new InvalidOperationException("Agent workspace exceeds the 10 MiB limit.");
        File.WriteAllText(path, content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        return JsonSerializer.Serialize(new
        {
            path = Path.GetRelativePath(_root, path).Replace(Path.DirectorySeparatorChar, '/'),
            bytes,
        });
    }

    private string Resolve(string value, bool allowRoot = false)
    {
        value = value.Trim();
        if (allowRoot && string.IsNullOrEmpty(value)) return _root;
        if (string.IsNullOrWhiteSpace(value) || Path.IsPathRooted(value) || value.IndexOf('\0') >= 0)
            throw new InvalidOperationException("Workspace paths must be non-empty relative paths.");
        var path = Path.GetFullPath(Path.Combine(_root, value));
        if (!path.StartsWith(_rootPrefix, PathComparison) || string.Equals(path, _root, PathComparison))
            throw new InvalidOperationException("Workspace path escapes the session directory.");
        EnsureExistingParentsAreSafe(path);
        return path;
    }

    private void EnsureExistingParentsAreSafe(string path)
    {
        var relative = Path.GetRelativePath(_root, Path.GetDirectoryName(path) ?? _root);
        var current = _root;
        RejectReparsePoint(current);
        if (relative == ".") return;
        foreach (var segment in relative.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
                     StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            if (Directory.Exists(current)) RejectReparsePoint(current);
            else break;
        }
    }

    private void EnsureSafeParents(string path)
    {
        var parent = Path.GetDirectoryName(path) ?? throw new InvalidOperationException("Invalid workspace path.");
        var relative = Path.GetRelativePath(_root, parent);
        var current = _root;
        if (relative == ".") return;
        foreach (var segment in relative.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
                     StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            if (Directory.Exists(current)) RejectReparsePoint(current);
            else Directory.CreateDirectory(current);
        }
    }

    private static void RejectTreeReparsePoints(string root)
    {
        RejectReparsePoint(root);
        foreach (var entry in Directory.EnumerateFileSystemEntries(root, "*", SearchOption.AllDirectories))
            RejectReparsePoint(entry);
    }

    private static void RejectReparsePoint(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Workspace links and reparse points are not allowed.");
    }

    private static string ReadString(JsonElement arguments, string name, bool required = true)
    {
        if (arguments.ValueKind == JsonValueKind.Object &&
            arguments.TryGetProperty(name, out var property) &&
            property.ValueKind == JsonValueKind.String)
        {
            return property.GetString() ?? string.Empty;
        }
        return required ? throw new InvalidOperationException($"Missing string argument: {name}") : string.Empty;
    }

    private static StringComparison PathComparison =>
        OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
}
