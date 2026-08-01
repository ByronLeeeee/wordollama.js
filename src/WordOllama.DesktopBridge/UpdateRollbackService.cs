using System.Diagnostics;
using System.Text.Json;

namespace WordOllama.DesktopBridge;

public sealed record UpdateRollbackStatus(
    bool Available,
    string? CurrentVersion,
    string? PreviousVersion,
    string? Reason);

public interface IUpdateRollbackPlatform
{
    string? ResolveInstallRoot();
    void Launch(string installRoot);
}

public sealed class UpdateRollbackService
{
    private readonly IUpdateRollbackPlatform _platform;

    public UpdateRollbackService(IUpdateRollbackPlatform platform) => _platform = platform;

    public UpdateRollbackStatus GetStatus()
    {
        var root = _platform.ResolveInstallRoot();
        if (string.IsNullOrWhiteSpace(root))
        {
            return new(false, null, null, "not-installed");
        }
        try
        {
            var fullRoot = Path.GetFullPath(root);
            var statePath = Path.Combine(fullRoot, "current.json");
            var pointerPath = Path.Combine(fullRoot, "current-version");
            if (!File.Exists(statePath) || !File.Exists(pointerPath))
            {
                return new(false, null, null, "state-missing");
            }
            using var document = JsonDocument.Parse(File.ReadAllText(statePath));
            var current = document.RootElement.TryGetProperty("currentVersion", out var currentValue)
                ? currentValue.GetString()
                : null;
            var previous = document.RootElement.TryGetProperty("previousVersion", out var previousValue)
                ? previousValue.GetString()
                : null;
            var pointer = File.ReadAllText(pointerPath).Trim();
            if (!IsSafeVersion(current) || !IsSafeVersion(previous) ||
                !string.Equals(pointer, current, StringComparison.Ordinal) ||
                string.Equals(current, previous, StringComparison.Ordinal))
            {
                return new(false, current, previous, "previous-version-unavailable");
            }
            var previousRoot = Path.GetFullPath(Path.Combine(fullRoot, "versions", previous!));
            var versionsPrefix = Path.GetFullPath(Path.Combine(fullRoot, "versions"))
                .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var executable = Path.Combine(
                previousRoot,
                OperatingSystem.IsWindows()
                    ? "WordOllama.DesktopBridge.exe"
                    : "WordOllama.DesktopBridge");
            if (!previousRoot.StartsWith(versionsPrefix, StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(executable) ||
                !File.Exists(Path.Combine(previousRoot, "appsettings.json")))
            {
                return new(false, current, previous, "previous-version-missing");
            }
            return new(true, current, previous, null);
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        {
            return new(false, null, null, "state-invalid");
        }
    }

    public UpdateRollbackStatus Launch()
    {
        var status = GetStatus();
        if (!status.Available)
        {
            throw new UpdateRollbackUnavailableException(status.Reason ?? "rollback-unavailable");
        }
        var root = _platform.ResolveInstallRoot()
            ?? throw new UpdateRollbackUnavailableException("not-installed");
        _platform.Launch(root);
        return status;
    }

    private static bool IsSafeVersion(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        System.Text.RegularExpressions.Regex.IsMatch(value, "^[0-9A-Za-z][0-9A-Za-z._-]*$");
}

public sealed class UpdateRollbackUnavailableException(string reason)
    : InvalidOperationException(reason);

public sealed class SystemUpdateRollbackPlatform : IUpdateRollbackPlatform
{
    public string? ResolveInstallRoot()
    {
        var versionRoot = new DirectoryInfo(Path.GetFullPath(AppContext.BaseDirectory.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar)));
        var versionsRoot = versionRoot.Parent;
        if (versionsRoot is null ||
            !string.Equals(versionsRoot.Name, "versions", StringComparison.OrdinalIgnoreCase) ||
            versionsRoot.Parent is null)
        {
            return null;
        }
        return versionsRoot.Parent.FullName;
    }

    public void Launch(string installRoot)
    {
        ProcessStartInfo startInfo;
        if (OperatingSystem.IsWindows())
        {
            var executable = Path.Combine(installRoot, "WordOllama.JS-Uninstall.exe");
            if (!File.Exists(executable))
            {
                throw new UpdateRollbackUnavailableException("rollback-launcher-missing");
            }
            startInfo = new ProcessStartInfo(executable)
            {
                UseShellExecute = true,
                Arguments = "--rollback --quiet",
            };
        }
        else if (OperatingSystem.IsMacOS())
        {
            var command = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Applications",
                "WordOllama.JS",
                "Rollback WordOllama.JS Desktop Bridge.command");
            if (!File.Exists(command))
            {
                throw new UpdateRollbackUnavailableException("rollback-launcher-missing");
            }
            startInfo = new ProcessStartInfo("/bin/sh") { UseShellExecute = false };
            startInfo.ArgumentList.Add(command);
        }
        else
        {
            throw new PlatformNotSupportedException("Update rollback is supported only on Windows and macOS.");
        }
        _ = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The rollback helper could not be started.");
    }
}
