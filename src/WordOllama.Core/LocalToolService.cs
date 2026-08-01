using System.Text.Json;
using System.Text.RegularExpressions;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using WordOllama.Contracts;

namespace WordOllama.Core;

public sealed record LocalToolPolicy(
    IReadOnlySet<string> AllowedExecutables,
    IReadOnlyList<string> AuthorizedRoots,
    string SkillsRoot,
    string PythonExecutable,
    bool AllowHttpRequests = false,
    string? AuditPath = null);

public sealed class LocalToolPolicyException : Exception
{
    public LocalToolPolicyException(string message)
        : base(message)
    {
    }
}

/// <summary>
/// Structured local capabilities used by Desktop Full. It never invokes a
/// shell parser and never reads outside the configured authorization roots.
/// </summary>
public sealed class LocalToolService : IInternalToolExecutor
{
    private readonly IProcessRunner _processRunner;
    private readonly LocalToolPolicy _policy;

    public LocalToolService(IProcessRunner processRunner, LocalToolPolicy policy)
    {
        _processRunner = processRunner;
        _policy = policy;
        SeedBuiltInSkills();
    }

    public string SkillsRoot => Path.GetFullPath(_policy.SkillsRoot);

    public bool IsKnownTool(string name) =>
        name is "execute_command" or "run_python_script" or "run_terminal" or "grep" or "read_skill" ||
        (name == "fetch_url" && _policy.AllowHttpRequests);

    public IReadOnlyList<OfficeToolDescriptor> GetToolDescriptors()
    {
        var descriptors = new List<OfficeToolDescriptor>
        {
        new OfficeToolDescriptor(
            "execute_command",
            "Run an authorized local executable with structured arguments.",
            false,
            JsonSerializer.SerializeToElement(new
            {
                type = "object",
                properties = new
                {
                    command = new { type = "string" },
                    args = new { type = "string" },
                    timeout_seconds = new { type = "integer" },
                    working_directory = new { type = "string" },
                },
                required = new[] { "command" },
            })),
        new OfficeToolDescriptor(
            "run_python_script",
            "Run the first Python script inside an authorized Skill directory.",
            false,
            JsonSerializer.SerializeToElement(new
            {
                type = "object",
                properties = new
                {
                    skill_name = new { type = "string" },
                    script_args = new { type = "string" },
                    timeout_seconds = new { type = "integer" },
                },
                required = new[] { "skill_name" },
            })),
        new OfficeToolDescriptor(
            "run_terminal",
            "Run an unrestricted operating-system shell script. This tool is visible only in a user-confirmed full-access Agent session.",
            false,
            JsonSerializer.SerializeToElement(new
            {
                type = "object",
                properties = new
                {
                    script = new { type = "string" },
                    timeout_seconds = new { type = "integer" },
                    working_directory = new { type = "string" },
                },
                required = new[] { "script" },
            })),
        new OfficeToolDescriptor(
            "grep",
            "Search text inside authorized roots.",
            false,
            JsonSerializer.SerializeToElement(new
            {
                type = "object",
                properties = new
                {
                    root = new { type = "string" },
                    pattern = new { type = "string" },
                    regex = new { type = "boolean" },
                    max_results = new { type = "integer" },
                },
                required = new[] { "root", "pattern" },
            })),
        new OfficeToolDescriptor(
            "read_skill",
            "Read an authorized Skill.md file.",
            false,
            JsonSerializer.SerializeToElement(new
            {
                type = "object",
                properties = new
                {
                    skill_name = new { type = "string" },
                    reference = new { type = "string" },
                },
                required = new[] { "skill_name" },
            }))
        };
        if (_policy.AllowHttpRequests)
        {
            descriptors.Add(new OfficeToolDescriptor(
                "fetch_url",
                "Fetch readable text from an explicitly enabled public HTTPS URL. Redirects, DNS, MIME, size and timeout are restricted; credentials and private networks are blocked.",
                false,
                JsonSerializer.SerializeToElement(new
                {
                    type = "object",
                    properties = new
                    {
                        url = new { type = "string" },
                        timeout_seconds = new { type = "integer" },
                    },
                    required = new[] { "url" },
                })));
        }
        return descriptors;
    }

    public async Task<string> ExecuteAsync(
        string name,
        JsonElement arguments,
        CancellationToken cancellationToken = default)
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        return name switch
        {
            "execute_command" => JsonSerializer.Serialize(await ExecuteCommandAsync(
                JsonSerializer.Deserialize<ExecuteCommandRequest>(arguments.GetRawText(), options)
                    ?? throw new ArgumentException("Invalid execute_command arguments."),
                cancellationToken)),
            "run_python_script" => JsonSerializer.Serialize(await RunPythonScriptAsync(
                JsonSerializer.Deserialize<RunPythonScriptRequest>(arguments.GetRawText(), options)
                    ?? throw new ArgumentException("Invalid run_python_script arguments."),
                cancellationToken)),
            "grep" => JsonSerializer.Serialize(await GrepAsync(
                JsonSerializer.Deserialize<GrepRequest>(arguments.GetRawText(), options)
                    ?? throw new ArgumentException("Invalid grep arguments."),
                cancellationToken)),
            "read_skill" => await ReadSkillAsync(
                JsonSerializer.Deserialize<ReadSkillRequest>(arguments.GetRawText(), options)
                    ?? throw new ArgumentException("Invalid read_skill arguments."),
                cancellationToken),
            "fetch_url" when _policy.AllowHttpRequests => JsonSerializer.Serialize(await SafeWebFetcher.FetchAsync(
                JsonSerializer.Deserialize<FetchUrlToolRequest>(arguments.GetRawText(), options)
                    ?? throw new ArgumentException("Invalid fetch_url arguments."),
                cancellationToken)),
            "run_terminal" => JsonSerializer.Serialize(await RunTerminalAsync(
                JsonSerializer.Deserialize<RunTerminalRequest>(arguments.GetRawText(), options)
                    ?? throw new ArgumentException("Invalid run_terminal arguments."),
                cancellationToken)),
            _ => throw new ArgumentException($"Unknown local tool: {name}"),
        };
    }

    public Task<string> ExecuteAgentToolAsync(
        string name,
        JsonElement arguments,
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(name, arguments, cancellationToken);

    public async Task<LocalToolResponse> ExecuteCommandAsync(
        ExecuteCommandRequest request,
        CancellationToken cancellationToken = default)
    {
        var command = Path.GetFileName(request.Command);
        EnsureExecutableAllowed(command);
        var result = await _processRunner.RunAsync(
            new ProcessExecutionRequest(
                request.Command,
                SplitArguments(request.Args),
                ValidateOptionalWorkingDirectory(request.WorkingDirectory),
                new Dictionary<string, string> { ["PYTHONIOENCODING"] = "utf-8" },
                TimeSpan.FromSeconds(Math.Clamp(request.TimeoutSeconds, 1, 600))),
            cancellationToken);
        return new LocalToolResponse(result.ExitCode, result.Stdout, result.Stderr, result.TimedOut);
    }

    public async Task<LocalToolResponse> RunPythonScriptAsync(
        RunPythonScriptRequest request,
        CancellationToken cancellationToken = default)
    {
        var skillDirectory = ResolveSkillDirectory(request.SkillName);
        var script = Directory.EnumerateFiles(skillDirectory, "*.py", SearchOption.AllDirectories)
            .OrderBy(path => path.Contains($"{Path.DirectorySeparatorChar}scripts{Path.DirectorySeparatorChar}",
                StringComparison.OrdinalIgnoreCase) ? 0 : 1)
            .ThenBy(path => path, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
        if (script is null)
        {
            throw new LocalToolPolicyException($"No Python script found for skill '{request.SkillName}'.");
        }

        script = ValidateAuthorizedFile(script);

        EnsureExecutableAllowed(Path.GetFileName(_policy.PythonExecutable));
        var result = await _processRunner.RunAsync(
            new ProcessExecutionRequest(
                _policy.PythonExecutable,
                [script, .. SplitArguments(request.ScriptArgs)],
                skillDirectory,
                new Dictionary<string, string> { ["PYTHONIOENCODING"] = "utf-8" },
                TimeSpan.FromSeconds(Math.Clamp(request.TimeoutSeconds, 1, 600))),
            cancellationToken);
        return new LocalToolResponse(result.ExitCode, result.Stdout, result.Stderr, result.TimedOut);
    }

    public async Task<LocalToolResponse> RunTerminalAsync(
        RunTerminalRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Script))
            throw new ArgumentException("Terminal script is required.", nameof(request));
        if (request.Script.Length > 100_000)
            throw new LocalToolPolicyException("Terminal script exceeds the 100,000 character limit.");
        var (shell, arguments) = OperatingSystem.IsWindows()
            ? ("powershell.exe", (IReadOnlyList<string>)["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", request.Script])
            : (File.Exists("/bin/zsh") ? "/bin/zsh" : "/bin/bash",
                (IReadOnlyList<string>)["-lc", request.Script]);
        var workingDirectory = string.IsNullOrWhiteSpace(request.WorkingDirectory)
            ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            : Path.GetFullPath(request.WorkingDirectory);
        if (!Directory.Exists(workingDirectory))
            throw new DirectoryNotFoundException("Terminal working directory was not found.");
        var startedAt = DateTimeOffset.UtcNow;
        ProcessExecutionResult? result = null;
        try
        {
            result = await _processRunner.RunAsync(
                new ProcessExecutionRequest(
                    shell,
                    arguments,
                    workingDirectory,
                    new Dictionary<string, string> { ["PYTHONIOENCODING"] = "utf-8" },
                    TimeSpan.FromSeconds(Math.Clamp(request.TimeoutSeconds, 1, 600))),
                cancellationToken);
            return new LocalToolResponse(result.ExitCode, result.Stdout, result.Stderr, result.TimedOut);
        }
        finally
        {
            WriteTerminalAudit(request.Script, shell, startedAt, result);
        }
    }

    private void WriteTerminalAudit(
        string script,
        string shell,
        DateTimeOffset startedAt,
        ProcessExecutionResult? result)
    {
        if (string.IsNullOrWhiteSpace(_policy.AuditPath)) return;
        try
        {
            var path = Path.GetFullPath(_policy.AuditPath);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var record = JsonSerializer.Serialize(new
            {
                timestamp = startedAt,
                shell = Path.GetFileName(shell),
                scriptSha256 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(script))).ToLowerInvariant(),
                scriptCharacters = script.Length,
                exitCode = result?.ExitCode,
                timedOut = result?.TimedOut,
                durationMs = (long)(DateTimeOffset.UtcNow - startedAt).TotalMilliseconds,
            });
            lock (_policy)
            {
                File.AppendAllText(path, record + Environment.NewLine, new UTF8Encoding(false));
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Audit failure must not expose the script through an exception message.
        }
    }

    public async Task<IReadOnlyList<GrepMatch>> GrepAsync(
        GrepRequest request,
        CancellationToken cancellationToken = default)
    {
        var root = ValidateAuthorizedPath(request.Root, mustExist: true);
        if (string.IsNullOrWhiteSpace(request.Pattern))
        {
            throw new ArgumentException("Pattern is required.", nameof(request));
        }

        Regex? regex = null;
        if (request.Regex)
        {
            regex = new Regex(request.Pattern, RegexOptions.Compiled | RegexOptions.IgnoreCase, TimeSpan.FromSeconds(2));
        }

        var matches = new List<GrepMatch>();
        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (file.Contains($"{Path.DirectorySeparatorChar}.git{Path.DirectorySeparatorChar}",
                    StringComparison.OrdinalIgnoreCase) ||
                file.Contains($"{Path.DirectorySeparatorChar}node_modules{Path.DirectorySeparatorChar}",
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            string authorizedFile;
            try
            {
                authorizedFile = ValidateAuthorizedFile(file);
            }
            catch (LocalToolPolicyException)
            {
                // Do not follow a symlinked file outside the authorization roots.
                continue;
            }

            try
            {
                var lineNumber = 0;
                await foreach (var line in File.ReadLinesAsync(authorizedFile, cancellationToken))
                {
                    lineNumber++;
                    var found = regex is null
                        ? line.Contains(request.Pattern, StringComparison.OrdinalIgnoreCase)
                        : regex.IsMatch(line);
                    if (!found)
                    {
                        continue;
                    }

                    matches.Add(new GrepMatch(authorizedFile, lineNumber, line.Length > 500 ? line[..500] + "..." : line));
                    if (matches.Count >= Math.Clamp(request.MaxResults, 1, 1000))
                    {
                        return matches;
                    }
                }
            }
            catch (IOException)
            {
                // A changing or locked file is skipped, matching the current tool's best-effort behavior.
            }
            catch (UnauthorizedAccessException)
            {
                // Authorization is enforced at the root; individual unreadable files are skipped.
            }
        }

        return matches;
    }

    public async Task<string> ReadSkillAsync(
        ReadSkillRequest request,
        CancellationToken cancellationToken = default)
    {
        var skillDirectory = ResolveSkillDirectory(request.SkillName);
        var skillFile = ValidateAuthorizedFile(Path.Combine(skillDirectory, "SKILL.md"));
        if (!File.Exists(skillFile))
        {
            throw new LocalToolPolicyException($"Skill '{request.SkillName}' has no SKILL.md.");
        }
        if (string.IsNullOrWhiteSpace(request.Reference))
        {
            return await File.ReadAllTextAsync(skillFile, cancellationToken);
        }

        var reference = request.Reference.Replace('/', Path.DirectorySeparatorChar)
            .Replace('\\', Path.DirectorySeparatorChar);
        var referenceCandidate = Path.GetFullPath(Path.Combine(skillDirectory, reference));
        if (!IsUnderRoot(referenceCandidate, skillDirectory))
        {
            throw new LocalToolPolicyException("Skill reference escapes the skill directory.");
        }
        var referencePath = ValidateAuthorizedFile(referenceCandidate);
        var extension = Path.GetExtension(referencePath);
        if (!extension.Equals(".md", StringComparison.OrdinalIgnoreCase) &&
            !extension.Equals(".txt", StringComparison.OrdinalIgnoreCase))
        {
            throw new LocalToolPolicyException("Skill references must be Markdown or text files.");
        }
        if (new FileInfo(referencePath).Length > 128 * 1024)
        {
            throw new LocalToolPolicyException("Skill reference is too large.");
        }
        return await File.ReadAllTextAsync(referencePath, cancellationToken);
    }

    public IReadOnlyList<SkillSummary> ListSkills()
    {
        if (!Directory.Exists(_policy.SkillsRoot))
        {
            return Array.Empty<SkillSummary>();
        }

        var skills = new List<SkillSummary>();
        foreach (var file in Directory.EnumerateFiles(_policy.SkillsRoot, "SKILL.md", SearchOption.AllDirectories))
        {
            try
            {
                var authorizedFile = ValidateAuthorizedFile(file);
                var content = File.ReadAllText(authorizedFile);
                var name = Regex.Match(content, "(?m)^name:\\s*(?<value>.+?)\\s*$").Groups["value"].Value.Trim().Trim('"', '\'');
                var description = Regex.Match(content, "(?m)^description:\\s*(?<value>.+?)\\s*$").Groups["value"].Value.Trim().Trim('"', '\'');
                if (!string.IsNullOrWhiteSpace(name))
                {
                    skills.Add(new SkillSummary(name, description));
                }
            }
            catch (IOException)
            {
                // A changing skill is skipped from the catalog.
            }
            catch (UnauthorizedAccessException)
            {
                // Authorization is enforced when reading the skill.
            }
        }
        return skills.OrderBy(skill => skill.Name, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    public SkillSummary ImportSkill(ImportSkillRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.FileName) ||
            !request.FileName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Skill import requires a ZIP file.");
        }
        byte[] archiveBytes;
        try
        {
            archiveBytes = Convert.FromBase64String(request.ZipBase64);
        }
        catch (FormatException exception)
        {
            throw new ArgumentException("Skill ZIP payload is not valid base64.", exception);
        }
        if (archiveBytes.Length is 0 or > 10 * 1024 * 1024)
        {
            throw new ArgumentException("Skill ZIP must be between 1 byte and 10 MB.");
        }

        Directory.CreateDirectory(_policy.SkillsRoot);
        var skillsRoot = Path.GetFullPath(_policy.SkillsRoot);
        var staging = Path.Combine(skillsRoot, ".import-" + Guid.NewGuid().ToString("N"));
        try
        {
            using var stream = new MemoryStream(archiveBytes, writable: false);
            using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
            if (archive.Entries.Count is 0 or > 500) throw new InvalidDataException("Skill ZIP entry count is invalid.");
            var files = archive.Entries.Where(entry => !string.IsNullOrEmpty(entry.Name)).ToArray();
            var commonRoot = FindCommonArchiveRoot(files.Select(entry => entry.FullName));
            long expandedBytes = 0;
            foreach (var entry in files)
            {
                if (entry.Length > 5 * 1024 * 1024) throw new InvalidDataException("A Skill ZIP entry exceeds 5 MB.");
                expandedBytes += entry.Length;
                if (expandedBytes > 50 * 1024 * 1024) throw new InvalidDataException("Skill ZIP expands beyond 50 MB.");
                var relative = NormalizeArchivePath(entry.FullName, commonRoot);
                if (string.IsNullOrWhiteSpace(relative)) continue;
                var destination = Path.GetFullPath(Path.Combine(staging, relative));
                if (!IsUnderRoot(destination, staging)) throw new InvalidDataException("Skill ZIP contains a path traversal entry.");
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                using var source = entry.Open();
                using var target = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                source.CopyTo(target);
            }
            var skillFile = Path.Combine(staging, "SKILL.md");
            if (!File.Exists(skillFile)) throw new InvalidDataException("Skill ZIP must contain SKILL.md at its root.");
            var content = File.ReadAllText(skillFile);
            var name = Regex.Match(content, "(?m)^name:\\s*(?<value>.+?)\\s*$").Groups["value"].Value.Trim().Trim('"', '\'');
            var description = Regex.Match(content, "(?m)^description:\\s*(?<value>.+?)\\s*$").Groups["value"].Value.Trim().Trim('"', '\'');
            if (string.IsNullOrWhiteSpace(name)) throw new InvalidDataException("SKILL.md frontmatter must define name.");
            var folder = Regex.Replace(name, "[^A-Za-z0-9._-]+", "-").Trim('-', '.');
            if (string.IsNullOrWhiteSpace(folder)) throw new InvalidDataException("Skill name cannot form a safe folder name.");
            var destinationRoot = Path.GetFullPath(Path.Combine(skillsRoot, folder));
            if (!IsUnderRoot(destinationRoot, skillsRoot) || Directory.Exists(destinationRoot))
            {
                throw new InvalidOperationException($"Skill already exists: {name}");
            }
            Directory.Move(staging, destinationRoot);
            staging = string.Empty;
            return new SkillSummary(name, description);
        }
        finally
        {
            if (!string.IsNullOrEmpty(staging) && Directory.Exists(staging))
            {
                Directory.Delete(staging, recursive: true);
            }
        }
    }

    public void DeleteSkill(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("Skill name is required.");
        var skillsRoot = Path.GetFullPath(_policy.SkillsRoot);
        var match = Directory.Exists(skillsRoot)
            ? Directory.EnumerateFiles(skillsRoot, "SKILL.md", SearchOption.AllDirectories)
                .Select(path => (path, content: File.ReadAllText(path)))
                .FirstOrDefault(candidate =>
                    string.Equals(
                        Regex.Match(candidate.content, "(?m)^name:\\s*(?<value>.+?)\\s*$").Groups["value"].Value.Trim().Trim('"', '\''),
                        name,
                        StringComparison.OrdinalIgnoreCase))
            : default;
        if (string.IsNullOrEmpty(match.path)) throw new KeyNotFoundException($"Skill was not found: {name}");
        var directory = Path.GetFullPath(Path.GetDirectoryName(match.path)!);
        if (!IsUnderRoot(directory, skillsRoot) || string.Equals(directory, skillsRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new LocalToolPolicyException("Skill deletion target is outside the skills root.");
        }
        Directory.Delete(directory, recursive: true);
    }

    private static string FindCommonArchiveRoot(IEnumerable<string> paths)
    {
        var roots = paths
            .Select(path => path.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
            .Where(parts => parts.Length > 1 &&
                parts[0] is not "." and not ".." &&
                !parts[0].Contains(':', StringComparison.Ordinal))
            .Select(parts => parts[0])
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        return roots.Length == 1 ? roots[0] + "/" : string.Empty;
    }

    private static string NormalizeArchivePath(string path, string commonRoot)
    {
        var normalized = path.Replace('\\', '/');
        if (!string.IsNullOrEmpty(commonRoot) &&
            normalized.StartsWith(commonRoot, StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized[commonRoot.Length..];
        }
        return normalized.Replace('/', Path.DirectorySeparatorChar);
    }

    private void SeedBuiltInSkills()
    {
        var bundledRoot = Path.Combine(AppContext.BaseDirectory, "Skills");
        if (!Directory.Exists(bundledRoot))
        {
            return;
        }

        var targetRoot = Path.GetFullPath(_policy.SkillsRoot);
        foreach (var source in Directory.EnumerateFiles(bundledRoot, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(bundledRoot, source);
            var target = Path.GetFullPath(Path.Combine(targetRoot, relative));
            if (!IsUnderRoot(target, targetRoot) || File.Exists(target))
            {
                continue;
            }

            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Copy(source, target, overwrite: false);
            }
            catch (IOException)
            {
                // Another process may seed the same built-in skill concurrently.
            }
            catch (UnauthorizedAccessException)
            {
                // Read-only environments can still use explicitly installed skills.
            }
        }
    }

    private string ResolveSkillDirectory(string skillName)
    {
        if (string.IsNullOrWhiteSpace(skillName) ||
            skillName.Contains(Path.DirectorySeparatorChar) ||
            skillName.Contains(Path.AltDirectorySeparatorChar) ||
            skillName.Contains("..", StringComparison.Ordinal))
        {
            throw new LocalToolPolicyException("Invalid skill name.");
        }
        return ValidateAuthorizedPath(Path.Combine(_policy.SkillsRoot, skillName), mustExist: true);
    }

    private string ValidateOptionalWorkingDirectory(string? workingDirectory)
    {
        if (string.IsNullOrWhiteSpace(workingDirectory))
        {
            return Environment.CurrentDirectory;
        }
        return ValidateAuthorizedPath(workingDirectory, mustExist: true);
    }

    private string ValidateAuthorizedPath(string path, bool mustExist)
    {
        var fullPath = Path.GetFullPath(path);
        if (mustExist && !Directory.Exists(fullPath))
        {
            throw new LocalToolPolicyException($"Authorized path does not exist: {path}");
        }

        var canonicalPath = CanonicalizeExistingPath(fullPath);
        if (_policy.AuthorizedRoots.Count == 0 ||
            !_policy.AuthorizedRoots.Any(root => IsUnderRoot(canonicalPath, CanonicalizeExistingPath(root))))
        {
            throw new LocalToolPolicyException($"Path is outside authorized roots: {path}");
        }
        return canonicalPath;
    }

    private string ValidateAuthorizedFile(string path)
    {
        var fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath))
        {
            throw new LocalToolPolicyException($"Authorized file does not exist: {path}");
        }

        var canonicalPath = CanonicalizeExistingPath(fullPath);
        if (_policy.AuthorizedRoots.Count == 0 ||
            !_policy.AuthorizedRoots.Any(root => IsUnderRoot(canonicalPath, CanonicalizeExistingPath(root))))
        {
            throw new LocalToolPolicyException($"File is outside authorized roots: {path}");
        }
        return canonicalPath;
    }

    private void EnsureExecutableAllowed(string executable)
    {
        if (!IsExecutableAllowed(executable))
        {
            throw new LocalToolPolicyException($"Executable is not allowed: {executable}");
        }
    }

    public bool IsExecutableAllowed(string executable) =>
        _policy.AllowedExecutables.Contains(Path.GetFileName(executable));

    private static bool IsUnderRoot(string path, string root)
    {
        var normalizedPath = Path.GetFullPath(path)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var normalizedRoot = Path.GetFullPath(root)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return string.Equals(normalizedPath, normalizedRoot, StringComparison.OrdinalIgnoreCase) ||
               normalizedPath.StartsWith(normalizedRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    private static string CanonicalizeExistingPath(string path)
    {
        var fullPath = Path.GetFullPath(path);
        try
        {
            var root = Path.GetPathRoot(fullPath);
            if (string.IsNullOrWhiteSpace(root))
            {
                return fullPath;
            }

            var current = root;
            var remainder = fullPath[root.Length..]
                .Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
                    StringSplitOptions.RemoveEmptyEntries);
            foreach (var component in remainder)
            {
                var candidate = Path.Combine(current, component);
                if (Directory.Exists(candidate))
                {
                    current = new DirectoryInfo(candidate)
                        .ResolveLinkTarget(returnFinalTarget: true)?.FullName
                        ?? candidate;
                }
                else if (File.Exists(candidate))
                {
                    current = new FileInfo(candidate)
                        .ResolveLinkTarget(returnFinalTarget: true)?.FullName
                        ?? candidate;
                }
                else
                {
                    // The caller usually requires an existing path. Keep the
                    // remaining lexical path for a fail-closed root check.
                    current = candidate;
                }
            }
            return Path.GetFullPath(current);
        }
        catch (IOException)
        {
            // The caller will still enforce the lexical root check. A transiently unavailable
            // link is rejected when the file/directory is actually opened.
        }
        catch (UnauthorizedAccessException)
        {
            // Same fail-closed behavior at the open/read boundary.
        }
        return fullPath;
    }

    private static IReadOnlyList<string> SplitArguments(string? arguments)
    {
        if (string.IsNullOrWhiteSpace(arguments))
        {
            return Array.Empty<string>();
        }

        var result = new List<string>();
        var current = new System.Text.StringBuilder();
        var quoted = false;
        foreach (var character in arguments)
        {
            if (character == '"')
            {
                quoted = !quoted;
            }
            else if (char.IsWhiteSpace(character) && !quoted)
            {
                if (current.Length > 0)
                {
                    result.Add(current.ToString());
                    current.Clear();
                }
            }
            else
            {
                current.Append(character);
            }
        }
        if (current.Length > 0)
        {
            result.Add(current.ToString());
        }
        return result;
    }
}
