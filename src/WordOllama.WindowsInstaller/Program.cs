using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using Microsoft.Win32;

namespace WordOllama.WindowsInstaller;

internal sealed record BridgeMetadata(
    int SchemaVersion,
    string Product,
    string Version,
    string Runtime,
    string ArchiveSha256);

internal sealed record InstallState(
    string CurrentVersion,
    string? PreviousVersion,
    string InstalledAt,
    string ArchiveSha256,
    string Installer);

internal static class Program
{
    private const string PayloadResource =
        "WordOllama.WindowsInstaller.BridgePayload.zip";
    private const string MetadataResource =
        "WordOllama.WindowsInstaller.BridgeMetadata.json";
    private const string UninstallRegistryPath =
        @"Software\Microsoft\Windows\CurrentVersion\Uninstall\WordOllama.JS";
    private const string OfficeAddinRegistryPath =
        @"Software\Microsoft\Office\16.0\Wef\Developer";
    private const string OfficeAddinId =
        "4d2a7c5e-2d2a-4a1a-8b72-6a1cf4f7b701";
    private const string OfficeAddinDebugRegistryPath =
        OfficeAddinRegistryPath + "\\" + OfficeAddinId;
    private const string WpsAddinName = "WordOllama.JS";
    private const string WpsAddinUrl = "https://localhost:37421/wps-addin/";
    private const string LocalhostCertificateSubject = "CN=李伯阳/Boyang Li";
    private const string LegacyLocalhostCertificateSubject = "CN=WordOllama.JS localhost";
    private static readonly string[] WpsProcessNames =
        ["wps", "wpscenter", "wpscloudsvr"];

    [STAThread]
    private static int Main(string[] args)
    {
        var quiet = args.Contains("--quiet", StringComparer.OrdinalIgnoreCase);
        try
        {
            if (!OperatingSystem.IsWindows())
            {
                throw new PlatformNotSupportedException(
                    "WordOllama.JS Setup supports Windows only.");
            }

            var options = ParseOptions(args);
            if (options.TryGetValue(
                    "--cleanup-root",
                    out var cleanupRoot))
            {
                CleanupAfterUninstall(
                    cleanupRoot,
                    options.TryGetValue(
                        "--wait-pid",
                        out var waitPid)
                        ? waitPid
                        : null);
                return 0;
            }
            var skipRegistration = options.ContainsKey(
                "--skip-registration");
            if (skipRegistration &&
                !IsTestBuild(Assembly.GetExecutingAssembly()))
            {
                throw new InvalidOperationException(
                    "--skip-registration is available only in smoke/test installer builds.");
            }
            var installRoot = ResolveInstallRoot(
                options,
                skipRegistration);
            var startupRoot = ResolveStartupRoot(
                options,
                skipRegistration);
            if (options.ContainsKey("--repair-office-registration"))
            {
                RepairOfficeAddinRegistrationAfterWordExit(
                    installRoot,
                    options.TryGetValue("--wait-pids", out var waitPids)
                        ? waitPids
                        : null);
                return 0;
            }
            if (options.ContainsKey("--repair-wps-registration"))
            {
                RegisterWpsAddin();
                return 0;
            }
            if (options.ContainsKey("--uninstall"))
            {
                Uninstall(
                    installRoot,
                    startupRoot,
                    skipRegistration);
                Notify(InstallerText.Removed, quiet);
                return 0;
            }

            var noStart = options.ContainsKey("--no-start");
            if (options.ContainsKey("--rollback"))
            {
                Rollback(installRoot, noStart, skipRegistration);
                Notify(InstallerText.RolledBack, quiet);
                return 0;
            }
            var trustLocalhostCertificate = options.ContainsKey(
                "--trust-localhost-certificate");
            var rotateLocalhostCertificate = options.ContainsKey(
                "--rotate-localhost-certificate");
            if (!quiet && args.Length == 0)
            {
                var metadata = ReadMetadata(Assembly.GetExecutingAssembly());
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using var wizard = new InstallerWizard(
                    metadata.Version,
                    installRoot,
                    wizardOptions =>
                    {
                        var wizardWordProcessIds = Process.GetProcessesByName("WINWORD")
                            .Select(process => process.Id)
                            .ToArray();
                        if (!skipRegistration && !EnsureWpsClosedBeforeInstall(quiet: false))
                        {
                            return new InstallerWizardResult(
                                Success: false,
                                RestartWord: false,
                                Error: InstallerText.Cancelled);
                        }
                        Install(
                            installRoot,
                            startupRoot,
                            noStart: !wizardOptions.StartBridge,
                            skipRegistration,
                            trustLocalhostCertificate: true,
                            promptForLocalhostCertificateTrust: false,
                            rotateLocalhostCertificate: false);
                        if (!skipRegistration && wizardWordProcessIds.Length > 0)
                        {
                            ScheduleOfficeAddinRegistrationRepair(
                                installRoot,
                                wizardWordProcessIds);
                        }
                        return new InstallerWizardResult(
                            Success: true,
                            RestartWord: wizardWordProcessIds.Length > 0,
                            Error: null);
                    });
                Application.Run(wizard);
                return wizard.ExitCode;
            }
            var promptForLocalhostCertificateTrust =
                !quiet && !trustLocalhostCertificate;
            var runningWordProcessIds = Process.GetProcessesByName("WINWORD")
                .Select(process => process.Id)
                .ToArray();
            if (!skipRegistration && !EnsureWpsClosedBeforeInstall(quiet))
            {
                return 2;
            }
            Install(
                installRoot,
                startupRoot,
                noStart,
                skipRegistration,
                trustLocalhostCertificate,
                promptForLocalhostCertificateTrust,
                rotateLocalhostCertificate);
            if (!skipRegistration && runningWordProcessIds.Length > 0)
            {
                ScheduleOfficeAddinRegistrationRepair(
                    installRoot,
                    runningWordProcessIds);
            }
            Notify(InstallerText.Installed, quiet);
            if (!quiet && runningWordProcessIds.Length > 0)
            {
                Notify(InstallerText.RestartWord, quiet: false);
            }
            return 0;
        }
        catch (Exception exception)
        {
            if (!quiet)
            {
                MessageBoxW(
                    IntPtr.Zero,
                    InstallerText.Failed(exception.Message),
                    InstallerText.Title,
                    0x00000010);
            }
            Console.Error.WriteLine(exception);
            return 1;
        }
    }

    private static Dictionary<string, string?> ParseOptions(string[] args)
    {
        var result = new Dictionary<string, string?>(
            StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index++)
        {
            var argument = args[index];
            if (argument is "--quiet" or "--no-start" or "--uninstall" or "--rollback" or
                "--skip-registration" or "--trust-localhost-certificate" or
                "--rotate-localhost-certificate" or "--repair-office-registration" or
                "--repair-wps-registration")
            {
                result[argument] = null;
                continue;
            }
            if (argument is "--install-root" or "--startup-root")
            {
                if (index + 1 >= args.Length ||
                    args[index + 1].StartsWith("--", StringComparison.Ordinal))
                {
                    throw new ArgumentException($"{argument} requires a path.");
                }
                result[argument] = args[++index];
                continue;
            }
            if (argument is "--cleanup-root" or "--wait-pid" or "--wait-pids")
            {
                if (index + 1 >= args.Length ||
                    args[index + 1].StartsWith("--", StringComparison.Ordinal))
                {
                    throw new ArgumentException($"{argument} requires a value.");
                }
                result[argument] = args[++index];
                continue;
            }
            throw new ArgumentException($"Unknown setup option: {argument}");
        }
        return result;
    }

    private static string ResolveInstallRoot(
        IReadOnlyDictionary<string, string?> options,
        bool testMode)
    {
        var custom = options.TryGetValue(
            "--install-root",
            out var configured);
        var path = custom
            ? configured
            : Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData),
                "WordOllama.JS",
                "DesktopBridge");
        var fullPath = ValidateOwnedPath(path, "install root");
        var localApplicationData = Path.GetFullPath(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData))
            .TrimEnd(Path.DirectorySeparatorChar) +
            Path.DirectorySeparatorChar;
        if (!testMode && (!fullPath.StartsWith(
                localApplicationData,
                StringComparison.OrdinalIgnoreCase) ||
            !fullPath.Contains(
                $"{Path.DirectorySeparatorChar}WordOllama.JS{Path.DirectorySeparatorChar}",
                StringComparison.OrdinalIgnoreCase)))
        {
            throw new ArgumentException(
                "The production install root must remain in the current user's LocalAppData WordOllama.JS directory.");
        }
        return fullPath;
    }

    private static string ResolveStartupRoot(
        IReadOnlyDictionary<string, string?> options,
        bool testMode)
    {
        var custom = options.TryGetValue(
            "--startup-root",
            out var configured);
        if (custom && !testMode)
        {
            throw new ArgumentException(
                "A custom Startup directory is allowed only in isolated setup tests.");
        }
        var path = custom
            ? configured
            : Environment.GetFolderPath(Environment.SpecialFolder.Startup);
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new InvalidOperationException(
                "Unable to resolve the current user's Startup directory.");
        }
        return Path.GetFullPath(path);
    }

    private static string ValidateOwnedPath(string? path, string label)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new ArgumentException($"{label} is empty.");
        }
        var fullPath = Path.GetFullPath(path);
        var root = Path.GetPathRoot(fullPath);
        if (string.Equals(
                fullPath.TrimEnd(Path.DirectorySeparatorChar),
                root?.TrimEnd(Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException($"{label} cannot be a drive root.");
        }
        return fullPath.TrimEnd(Path.DirectorySeparatorChar);
    }

    private static void Install(
        string installRoot,
        string startupRoot,
        bool noStart,
        bool skipRegistration,
        bool trustLocalhostCertificate,
        bool promptForLocalhostCertificateTrust,
        bool rotateLocalhostCertificate)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var metadata = ReadMetadata(assembly);
        if (metadata.SchemaVersion != 1 ||
            metadata.Product != "WordOllama.JS Desktop Bridge" ||
            metadata.Runtime != "win-x64" ||
            !IsValidVersion(metadata.Version) ||
            !System.Text.RegularExpressions.Regex.IsMatch(
                metadata.ArchiveSha256,
                "^[0-9a-fA-F]{64}$"))
        {
            throw new InvalidDataException(
                "Embedded Bridge metadata is invalid.");
        }

        using var payloadStream = assembly.GetManifestResourceStream(
            PayloadResource)
            ?? throw new InvalidDataException(
                "The setup payload is missing.");
        using var payload = new MemoryStream();
        payloadStream.CopyTo(payload);
        var payloadHash = Convert.ToHexString(
            SHA256.HashData(payload.GetBuffer().AsSpan(
                0,
                checked((int)payload.Length))));
        if (!string.Equals(
                payloadHash,
                metadata.ArchiveSha256,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException(
                "The embedded Bridge payload failed its SHA-256 check.");
        }

        Directory.CreateDirectory(installRoot);
        var versionsRoot = Path.Combine(installRoot, "versions");
        Directory.CreateDirectory(versionsRoot);
        var staging = Path.Combine(
            installRoot,
            ".staging-" + Guid.NewGuid().ToString("N"));
        var target = Path.Combine(versionsRoot, metadata.Version);
        var replacedTarget = Path.Combine(
            installRoot,
            ".replaced-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        try
        {
            payload.Position = 0;
            ExtractPayload(payload, staging);
            ValidatePayload(staging);

            // A repair install or explicit certificate rotation can target the
            // currently running version. Stop only this product's Bridge before
            // replacing that directory so same-version maintenance remains
            // atomic instead of failing on locked runtime files.
            StopOwnedBridgeProcesses(installRoot);

            if (Directory.Exists(target))
            {
                Directory.Move(target, replacedTarget);
            }
            try
            {
                Directory.Move(staging, target);
            }
            catch
            {
                if (Directory.Exists(replacedTarget) &&
                    !Directory.Exists(target))
                {
                    Directory.Move(replacedTarget, target);
                }
                throw;
            }
            if (Directory.Exists(replacedTarget))
            {
                Directory.Delete(replacedTarget, recursive: true);
            }
        }
        finally
        {
            if (Directory.Exists(staging))
            {
                Directory.Delete(staging, recursive: true);
            }
            if (Directory.Exists(replacedTarget) &&
                Directory.Exists(target))
            {
                Directory.Delete(replacedTarget, recursive: true);
            }
        }

        var currentVersionPath = Path.Combine(
            installRoot,
            "current-version");
        var previousVersion = File.Exists(currentVersionPath)
            ? File.ReadAllText(currentVersionPath).Trim()
            : null;
        if (previousVersion == metadata.Version)
        {
            previousVersion = TryReadPreviousVersion(installRoot);
        }
        WriteAtomic(
            currentVersionPath,
            metadata.Version,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        var state = new InstallState(
            metadata.Version,
            string.IsNullOrWhiteSpace(previousVersion)
                ? null
                : previousVersion,
            DateTimeOffset.UtcNow.ToString("O"),
            metadata.ArchiveSha256.ToLowerInvariant(),
            "exe");
        WriteAtomic(
            Path.Combine(target, "install-metadata.json"),
            JsonSerializer.Serialize(
                new
                {
                    version = metadata.Version,
                    archiveSha256 = metadata.ArchiveSha256.ToLowerInvariant(),
                },
                new JsonSerializerOptions { WriteIndented = true }),
            new UTF8Encoding(false));
        WriteAtomic(
            Path.Combine(installRoot, "current.json"),
            JsonSerializer.Serialize(
                state,
                new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = true,
                }),
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

        var launcherPath = Path.Combine(installRoot, "start-bridge.cmd");
        WriteAtomic(
            launcherPath,
            CreateLauncher(),
            Encoding.ASCII);
        Directory.CreateDirectory(startupRoot);
        var startupPath = Path.Combine(
            startupRoot,
            "WordOllama.JS Desktop Bridge.vbs");
        WriteAtomic(
            startupPath,
            CreateStartupScript(launcherPath),
            Encoding.ASCII);

        var processPath = Environment.ProcessPath
            ?? throw new InvalidOperationException(
                "Unable to resolve the setup executable.");
        var uninstallPath = Path.Combine(
            installRoot,
            "WordOllama.JS-Uninstall.exe");
        InstallUninstaller(processPath, uninstallPath);

        if (!skipRegistration)
        {
            RegisterOfficeAddin(
                Path.Combine(target, "WordOllama.JS.xml"));
            RegisterWpsAddin();
            RegisterUninstaller(
                uninstallPath,
                installRoot,
                metadata.Version,
                checked((int)Math.Ceiling(
                    new FileInfo(uninstallPath).Length / 1024d)));
        }

        if (!skipRegistration &&
            (trustLocalhostCertificate || promptForLocalhostCertificateTrust))
        {
            ProvisionLocalhostCertificate(
                installRoot,
                target,
                promptForLocalhostCertificateTrust,
                rotateLocalhostCertificate);
        }

        var certificatePath = Path.Combine(
            installRoot,
            "certs",
            "bridge.pfx");
        if (!noStart && File.Exists(certificatePath))
        {
            Process.Start(
                new ProcessStartInfo
                {
                    FileName = launcherPath,
                    WorkingDirectory = installRoot,
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                });
            VerifyBridgeReadyAsync().GetAwaiter().GetResult();
        }
    }

    private static void InstallUninstaller(
        string setupPath,
        string uninstallPath)
    {
        if (File.Exists(uninstallPath))
        {
            var existingAttributes = File.GetAttributes(uninstallPath);
            if ((existingAttributes & FileAttributes.ReadOnly) != 0)
            {
                File.SetAttributes(
                    uninstallPath,
                    existingAttributes & ~FileAttributes.ReadOnly);
            }
        }

        File.Copy(setupPath, uninstallPath, overwrite: true);

        // File.Copy preserves source attributes. Downloaded or transferred setup
        // executables can be read-only, which must not make the next upgrade fail.
        var installedAttributes = File.GetAttributes(uninstallPath);
        if ((installedAttributes & FileAttributes.ReadOnly) != 0)
        {
            File.SetAttributes(
                uninstallPath,
                installedAttributes & ~FileAttributes.ReadOnly);
        }
    }

    private static BridgeMetadata ReadMetadata(Assembly assembly)
    {
        using var stream = assembly.GetManifestResourceStream(
            MetadataResource)
            ?? throw new InvalidDataException(
                "The setup metadata is missing.");
        return JsonSerializer.Deserialize<BridgeMetadata>(
            stream,
            new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidDataException(
                "The setup metadata is empty.");
    }

    private static bool IsTestBuild(Assembly assembly)
    {
        try
        {
            var version = ReadMetadata(assembly).Version;
            return version.Contains(
                    "smoke",
                    StringComparison.OrdinalIgnoreCase) ||
                version.Contains(
                    "test",
                    StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static void ExtractPayload(Stream payload, string staging)
    {
        using var archive = new ZipArchive(
            payload,
            ZipArchiveMode.Read,
            leaveOpen: true);
        var stagingPrefix = Path.GetFullPath(staging).TrimEnd(
            Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        foreach (var entry in archive.Entries)
        {
            var destination = Path.GetFullPath(
                Path.Combine(staging, entry.FullName));
            if (!destination.StartsWith(
                    stagingPrefix,
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(
                    "The setup payload contains an unsafe path.");
            }
            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(destination);
                continue;
            }
            Directory.CreateDirectory(
                Path.GetDirectoryName(destination)!);
            entry.ExtractToFile(destination, overwrite: false);
        }
    }

    private static void ValidatePayload(string staging)
    {
        var executables = Directory.GetFiles(
            staging,
            "WordOllama.DesktopBridge.exe",
            SearchOption.AllDirectories);
        if (executables.Length != 1 ||
            !string.Equals(
                Path.GetDirectoryName(executables[0]),
                staging,
                StringComparison.OrdinalIgnoreCase) ||
            !File.Exists(Path.Combine(staging, "appsettings.json")) ||
            !File.Exists(Path.Combine(staging, "WordOllama.JS.xml")) ||
            !File.Exists(Path.Combine(staging, "wwwroot", "index.html")) ||
            !File.Exists(Path.Combine(staging, "wwwroot", "wps.html")) ||
            !File.Exists(Path.Combine(staging, "wwwroot", "wps-addin", "index.html")) ||
            !File.Exists(Path.Combine(staging, "wwwroot", "wps-addin", "main.js")) ||
            !File.Exists(Path.Combine(staging, "wwwroot", "wps-addin", "ribbon.xml")) ||
            !File.Exists(Path.Combine(staging, "wwwroot", "wps-addin", "assets", "ribbon", "agent.svg")) ||
            !File.Exists(Path.Combine(staging, "wwwroot", "wps-addin", "assets", "ribbon", "wps", "agent.svg")) ||
            !File.Exists(Path.Combine(staging, "wwwroot", "assets", "ribbon", "agent.svg")) ||
            !File.Exists(Path.Combine(staging, "wwwroot", "settings.html")) ||
            !File.Exists(Path.Combine(staging, "wwwroot", "commands.html")))
        {
            throw new InvalidDataException(
                "The setup payload does not use the expected Bridge root layout.");
        }
    }

    private static string? TryReadPreviousVersion(string installRoot)
    {
        try
        {
            using var document = JsonDocument.Parse(
                File.ReadAllText(
                    Path.Combine(installRoot, "current.json")));
            return document.RootElement.TryGetProperty(
                "previousVersion",
                out var value)
                ? value.GetString()
                : null;
        }
        catch
        {
            return null;
        }
    }

    private static string CreateLauncher() =>
        $"""
        @echo off
        setlocal
        set "WORDOLLAMA_BRIDGE_ROOT=%~dp0"
        set /p "WORDOLLAMA_BRIDGE_VERSION="<"%WORDOLLAMA_BRIDGE_ROOT%current-version"
        if not defined WORDOLLAMA_BRIDGE_VERSION exit /b 2
        set "WORDOLLAMA_BRIDGE_EXE=%WORDOLLAMA_BRIDGE_ROOT%versions\%WORDOLLAMA_BRIDGE_VERSION%\WordOllama.DesktopBridge.exe"
        set "WORDOLLAMA_MANIFEST=%WORDOLLAMA_BRIDGE_ROOT%versions\%WORDOLLAMA_BRIDGE_VERSION%\WordOllama.JS.xml"
        if not exist "%WORDOLLAMA_BRIDGE_EXE%" exit /b 3
        if not exist "%WORDOLLAMA_MANIFEST%" exit /b 4
        rem Repair only this product's per-user Office.js registration. Office may
        rem discard a developer value while refreshing its WEF cache; login startup
        rem must restore it without reinstalling or touching COM/VSTO registrations.
        reg.exe add "HKCU\{OfficeAddinRegistryPath}" /v "{OfficeAddinId}" /t REG_SZ /d "%WORDOLLAMA_MANIFEST%" /f >nul 2>&1
        rem Production startup must explicitly disable debugger wait flags left by
        rem office-addin-debugging; Cancel only suppresses the prompt per instance.
        reg.exe add "HKCU\{OfficeAddinDebugRegistryPath}" /v "UseDirectDebugger" /t REG_DWORD /d 0 /f >nul 2>&1
        reg.exe add "HKCU\{OfficeAddinDebugRegistryPath}" /v "UseWebDebugger" /t REG_DWORD /d 0 /f >nul 2>&1
        reg.exe add "HKCU\{OfficeAddinDebugRegistryPath}" /v "UseLiveReload" /t REG_DWORD /d 0 /f >nul 2>&1
        if not exist "%WORDOLLAMA_BRIDGE_ROOT%certs\bridge.pfx" exit /b 0
        start "WordOllama.JS Desktop Bridge" /b "%WORDOLLAMA_BRIDGE_EXE%" >>"%WORDOLLAMA_BRIDGE_ROOT%bridge.log" 2>&1
        """;

    private static string CreateStartupScript(string launcherPath)
    {
        var escapedPath = launcherPath.Replace("\"", "\"\"");
        return
            "CreateObject(\"WScript.Shell\").Run Chr(34) & \"" +
            escapedPath +
            "\" & Chr(34), 0, False\r\n";
    }

    private static void RegisterUninstaller(
        string uninstallPath,
        string installRoot,
        string version,
        int estimatedSizeKb)
    {
        using var key = Registry.CurrentUser.CreateSubKey(
            UninstallRegistryPath,
            writable: true)
            ?? throw new InvalidOperationException(
                "Unable to create the Windows uninstall registration.");
        key.SetValue("DisplayName", "WordOllama.JS Desktop Bridge");
        key.SetValue("DisplayVersion", version);
        key.SetValue("Publisher", "WordOllama");
        key.SetValue("DisplayIcon", uninstallPath);
        key.SetValue(
            "UninstallString",
            $"\"{uninstallPath}\" --uninstall");
        key.SetValue(
            "QuietUninstallString",
            $"\"{uninstallPath}\" --uninstall --quiet");
        key.SetValue(
            "ModifyPath",
            $"\"{uninstallPath}\" --rollback");
        key.SetValue("InstallLocation", installRoot);
        key.SetValue("NoModify", 0, RegistryValueKind.DWord);
        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        key.SetValue(
            "EstimatedSize",
            estimatedSizeKb,
            RegistryValueKind.DWord);
    }

    private static void Uninstall(
        string installRoot,
        string startupRoot,
        bool skipRegistration)
    {
        StopOwnedBridgeProcesses(installRoot);
        if (!skipRegistration)
        {
            DeleteOwnedLocalhostCertificate(installRoot);
            DeleteHttpsCredential();
            DeleteOfficeAddinRegistration(installRoot);
            DeleteWpsAddinRegistration();
        }
        var startupPath = Path.Combine(
            startupRoot,
            "WordOllama.JS Desktop Bridge.vbs");
        if (File.Exists(startupPath))
        {
            File.Delete(startupPath);
        }
        if (!skipRegistration)
        {
            Registry.CurrentUser.DeleteSubKeyTree(
                UninstallRegistryPath,
                throwOnMissingSubKey: false);
        }

        if (!Directory.Exists(installRoot))
        {
            return;
        }
        var processPath = Path.GetFullPath(
            Environment.ProcessPath ?? string.Empty);
        var installPrefix = installRoot + Path.DirectorySeparatorChar;
        if (processPath.StartsWith(
                installPrefix,
                StringComparison.OrdinalIgnoreCase))
        {
            ScheduleSelfRemoval(processPath, installRoot);
        }
        else
        {
            Directory.Delete(installRoot, recursive: true);
        }
    }

    private static void RegisterOfficeAddin(string manifestPath)
    {
        if (!File.Exists(manifestPath))
        {
            throw new InvalidDataException(
                "The WordOllama.JS Office manifest is missing.");
        }

        using var key = Registry.CurrentUser.CreateSubKey(
            OfficeAddinRegistryPath,
            writable: true)
            ?? throw new InvalidOperationException(
                "Unable to create the Office Add-in registration.");
        key.SetValue(
            OfficeAddinId,
            Path.GetFullPath(manifestPath),
            RegistryValueKind.String);

        using var debugKey = Registry.CurrentUser.CreateSubKey(
            OfficeAddinDebugRegistryPath,
            writable: true)
            ?? throw new InvalidOperationException(
                "Unable to create the Office Add-in debug registration.");
        debugKey.SetValue(
            "UseDirectDebugger",
            0,
            RegistryValueKind.DWord);
        debugKey.SetValue(
            "UseWebDebugger",
            0,
            RegistryValueKind.DWord);
        debugKey.SetValue(
            "UseLiveReload",
            0,
            RegistryValueKind.DWord);
    }

    private static bool EnsureWpsClosedBeforeInstall(bool quiet)
    {
        var running = GetRunningWpsProcesses();
        if (running.Length == 0)
        {
            return true;
        }
        foreach (var process in running)
        {
            process.Dispose();
        }
        if (quiet)
        {
            Console.Error.WriteLine(InstallerText.CloseWpsPrompt);
            return false;
        }
        var confirmed = MessageBoxW(
            IntPtr.Zero,
            InstallerText.CloseWpsPrompt,
            InstallerText.Title,
            0x00000004 | 0x00000030 | 0x00000100) == 6;
        if (!confirmed)
        {
            return false;
        }

        for (var attempt = 0; attempt < 3; attempt++)
        {
            running = GetRunningWpsProcesses();
            if (running.Length == 0)
            {
                return true;
            }
            foreach (var process in running)
            {
                try
                {
                    if (!process.HasExited)
                    {
                        process.Kill(entireProcessTree: true);
                        process.WaitForExit(5000);
                    }
                }
                catch (InvalidOperationException)
                {
                    // The process exited between enumeration and termination.
                }
                finally
                {
                    process.Dispose();
                }
            }
            Thread.Sleep(250);
        }

        running = GetRunningWpsProcesses();
        foreach (var process in running)
        {
            process.Dispose();
        }
        if (running.Length > 0)
        {
            throw new InvalidOperationException(InstallerText.CloseWpsFailed);
        }
        return true;
    }

    private static Process[] GetRunningWpsProcesses() =>
        WpsProcessNames
            .SelectMany(Process.GetProcessesByName)
            .GroupBy(process => process.Id)
            .Select(group => group.First())
            .ToArray();

    private static string WpsPublishPath() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "kingsoft",
        "wps",
        "jsaddons",
        "publish.xml");

    private static XDocument ReadWpsPublishDocument(string path)
    {
        if (!File.Exists(path))
        {
            return new XDocument(new XElement("jsplugins"));
        }
        try
        {
            var document = XDocument.Load(path, LoadOptions.PreserveWhitespace);
            if (!string.Equals(
                    document.Root?.Name.LocalName,
                    "jsplugins",
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(
                    "The existing WPS publish.xml has an unexpected root element.");
            }
            return document;
        }
        catch (Exception exception) when (
            exception is IOException or System.Xml.XmlException)
        {
            throw new InvalidDataException(
                "The existing WPS publish.xml could not be read; it was preserved unchanged.",
                exception);
        }
    }

    private static void RemoveOwnedWpsEntries(XElement root)
    {
        root.Elements()
            .Where(element =>
                (element.Name.LocalName is "jspluginonline" or "jsplugin") &&
                string.Equals(
                    element.Attribute("name")?.Value,
                    WpsAddinName,
                    StringComparison.OrdinalIgnoreCase))
            .Remove();
    }

    private static void RegisterWpsAddin()
    {
        var path = WpsPublishPath();
        var document = ReadWpsPublishDocument(path);
        var root = document.Root!;
        RemoveOwnedWpsEntries(root);
        root.Add(new XElement(
            "jspluginonline",
            new XAttribute("name", WpsAddinName),
            new XAttribute("type", "wps"),
            new XAttribute("url", WpsAddinUrl),
            new XAttribute("enable", "enable_dev"),
            new XAttribute("install", "null"),
            new XAttribute("customDomain", "")));
        WriteAtomic(path, document.ToString(), new UTF8Encoding(false));
    }

    private static void DeleteWpsAddinRegistration()
    {
        var path = WpsPublishPath();
        if (!File.Exists(path)) return;
        try
        {
            var document = ReadWpsPublishDocument(path);
            var root = document.Root!;
            var before = root.Elements().Count();
            RemoveOwnedWpsEntries(root);
            if (root.Elements().Count() == before) return;
            if (!root.Elements().Any())
            {
                File.Delete(path);
                return;
            }
            WriteAtomic(path, document.ToString(), new UTF8Encoding(false));
        }
        catch (Exception exception) when (
            exception is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            // An unrelated or locked WPS configuration must not block uninstall.
        }
    }

    private static void ScheduleOfficeAddinRegistrationRepair(
        string installRoot,
        IReadOnlyList<int> wordProcessIds)
    {
        var maintenanceExecutable = Path.Combine(
            installRoot,
            "WordOllama.JS-Uninstall.exe");
        if (!File.Exists(maintenanceExecutable) || wordProcessIds.Count == 0)
        {
            return;
        }
        var startInfo = new ProcessStartInfo
        {
            FileName = maintenanceExecutable,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        startInfo.ArgumentList.Add("--quiet");
        startInfo.ArgumentList.Add("--repair-office-registration");
        startInfo.ArgumentList.Add("--wait-pids");
        startInfo.ArgumentList.Add(string.Join(',', wordProcessIds));
        _ = Process.Start(startInfo);
    }

    private static void RepairOfficeAddinRegistrationAfterWordExit(
        string installRoot,
        string? processIds)
    {
        foreach (var value in (processIds ?? string.Empty).Split(
                     ',',
                     StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!int.TryParse(value, out var processId) || processId <= 0)
            {
                continue;
            }
            try
            {
                using var process = Process.GetProcessById(processId);
                if (string.Equals(
                        process.ProcessName,
                        "WINWORD",
                        StringComparison.OrdinalIgnoreCase))
                {
                    process.WaitForExit();
                }
            }
            catch (ArgumentException)
            {
                // Word already exited before the repair helper started.
            }
        }

        var currentVersionPath = Path.Combine(installRoot, "current-version");
        if (!File.Exists(currentVersionPath))
        {
            throw new InvalidDataException("The installed version pointer is missing.");
        }
        var version = File.ReadAllText(currentVersionPath).Trim();
        if (!IsValidVersion(version))
        {
            throw new InvalidDataException("The installed version pointer is invalid.");
        }
        var manifestPath = Path.Combine(
            installRoot,
            "versions",
            version,
            "WordOllama.JS.xml");
        RegisterOfficeAddin(manifestPath);
    }

    private static bool IsValidVersion(string? version) =>
        !string.IsNullOrWhiteSpace(version) &&
        System.Text.RegularExpressions.Regex.IsMatch(
            version,
            "^[0-9A-Za-z][0-9A-Za-z._-]*$");

    private static void DeleteOfficeAddinRegistration(string installRoot)
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            OfficeAddinRegistryPath,
            writable: true);
        if (key?.GetValue(OfficeAddinId) is not string registeredPath)
        {
            return;
        }

        var ownedPrefix = Path.GetFullPath(installRoot).TrimEnd(
            Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var registeredFullPath = Path.GetFullPath(registeredPath);
        if (registeredFullPath.StartsWith(
                ownedPrefix,
                StringComparison.OrdinalIgnoreCase))
        {
            key.DeleteValue(OfficeAddinId, throwOnMissingValue: false);
            key.DeleteSubKeyTree(
                OfficeAddinId,
                throwOnMissingSubKey: false);
        }
    }

    private static void DeleteHttpsCredential()
    {
        if (CredDelete(
                "WordOllama.JS/WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD",
                CredentialTypeGeneric,
                0))
        {
            return;
        }
        const int ErrorNotFound = 1168;
        var error = Marshal.GetLastWin32Error();
        if (error != ErrorNotFound)
        {
            throw new InvalidOperationException(
                $"Unable to remove the Bridge HTTPS credential ({error}).");
        }
    }

    private static void Rollback(string installRoot, bool noStart, bool skipRegistration)
    {
        var statePath = Path.Combine(installRoot, "current.json");
        var pointerPath = Path.Combine(installRoot, "current-version");
        if (!File.Exists(statePath) || !File.Exists(pointerPath))
        {
            throw new InvalidOperationException("No installed Bridge version is available to roll back.");
        }
        using var document = JsonDocument.Parse(File.ReadAllText(statePath));
        var root = document.RootElement;
        var current = root.TryGetProperty("currentVersion", out var currentValue)
            ? currentValue.GetString()
            : null;
        var previous = root.TryGetProperty("previousVersion", out var previousValue)
            ? previousValue.GetString()
            : null;
        var pointer = File.ReadAllText(pointerPath).Trim();
        if (!IsSafeVersion(current) || !IsSafeVersion(previous) ||
            !string.Equals(pointer, current, StringComparison.Ordinal) ||
            string.Equals(current, previous, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("No distinct previous Bridge version is available to roll back.");
        }
        var previousRoot = Path.GetFullPath(Path.Combine(installRoot, "versions", previous!));
        var versionsPrefix = Path.GetFullPath(Path.Combine(installRoot, "versions"))
            .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!previousRoot.StartsWith(versionsPrefix, StringComparison.OrdinalIgnoreCase) ||
            !File.Exists(Path.Combine(previousRoot, "WordOllama.DesktopBridge.exe")) ||
            !File.Exists(Path.Combine(previousRoot, "appsettings.json")))
        {
            throw new InvalidOperationException("The previous Bridge version is missing or incomplete.");
        }
        var previousMetadataPath = Path.Combine(previousRoot, "install-metadata.json");
        if (!File.Exists(previousMetadataPath))
        {
            throw new InvalidOperationException("The previous Bridge version has no trusted install metadata.");
        }
        using var previousMetadata = JsonDocument.Parse(File.ReadAllText(previousMetadataPath));
        var recordedVersion = previousMetadata.RootElement.GetProperty("version").GetString();
        var archiveHash = previousMetadata.RootElement.GetProperty("archiveSha256").GetString();
        if (!string.Equals(recordedVersion, previous, StringComparison.Ordinal) ||
            archiveHash is null ||
            !System.Text.RegularExpressions.Regex.IsMatch(archiveHash, "^[0-9a-f]{64}$"))
        {
            throw new InvalidOperationException("The previous Bridge install metadata is invalid.");
        }
        StopOwnedBridgeProcesses(installRoot);
        WriteAtomic(pointerPath, previous!, new UTF8Encoding(false));
        WriteAtomic(
            statePath,
            JsonSerializer.Serialize(
                new InstallState(previous!, current, DateTimeOffset.UtcNow.ToString("O"), archiveHash, "rollback"),
                new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = true,
                }),
            new UTF8Encoding(false));
        if (!skipRegistration)
        {
            using var uninstallKey = Registry.CurrentUser.OpenSubKey(
                UninstallRegistryPath,
                writable: true);
            uninstallKey?.SetValue("DisplayVersion", previous!);
        }

        var launcherPath = Path.Combine(installRoot, "start-bridge.cmd");
        var certificatePath = Path.Combine(installRoot, "certs", "bridge.pfx");
        if (!noStart && File.Exists(launcherPath) && File.Exists(certificatePath))
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = launcherPath,
                WorkingDirectory = installRoot,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            });
            VerifyBridgeReadyAsync().GetAwaiter().GetResult();
        }
    }

    private static bool IsSafeVersion(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        System.Text.RegularExpressions.Regex.IsMatch(value, "^[0-9A-Za-z][0-9A-Za-z._-]*$");

    private static async Task VerifyBridgeReadyAsync()
    {
        using var handler = new HttpClientHandler
        {
            UseProxy = false,
            AllowAutoRedirect = false,
        };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(3) };
        var deadline = DateTimeOffset.UtcNow.AddSeconds(30);
        Exception? lastError = null;
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                using var health = await client.GetAsync("https://127.0.0.1:37421/health");
                using var index = await client.GetAsync("https://127.0.0.1:37421/index.html");
                if (health.IsSuccessStatusCode && index.IsSuccessStatusCode)
                {
                    return;
                }
                lastError = new InvalidOperationException(
                    $"health={(int)health.StatusCode}, index={(int)index.StatusCode}");
            }
            catch (Exception exception) when (
                exception is HttpRequestException or TaskCanceledException)
            {
                lastError = exception;
            }
            await Task.Delay(300);
        }
        throw new InvalidOperationException(
            "The Desktop Bridge was installed but did not become ready within 30 seconds.",
            lastError);
    }

    private static bool ConfirmLocalhostCertificateTrust(
        X509Certificate2 certificate) =>
        MessageBoxW(
            IntPtr.Zero,
            InstallerText.CertificateTrustPrompt(
                certificate.Thumbprint,
                certificate.NotAfter.ToLocalTime()),
            InstallerText.Title,
            0x00000004 | 0x00000030) == 6;

    private static void ProvisionLocalhostCertificate(
        string installRoot,
        string versionRoot,
        bool promptForTrust,
        bool forceRotation)
    {
        var certsRoot = Path.Combine(installRoot, "certs");
        Directory.CreateDirectory(certsRoot);
        if (!forceRotation && TryReuseOwnedLocalhostCertificate(
                installRoot,
                versionRoot))
        {
            return;
        }
        DeleteOwnedLocalhostCertificate(installRoot);

        using var rsa = RSA.Create(3072);
        var request = new CertificateRequest(
            LocalhostCertificateSubject,
            rsa,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(
            certificateAuthority: false,
            hasPathLengthConstraint: false,
            pathLengthConstraint: 0,
            critical: true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment,
            critical: true));
        var eku = new OidCollection { new("1.3.6.1.5.5.7.3.1") };
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(eku, true));
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("localhost");
        san.AddIpAddress(System.Net.IPAddress.Loopback);
        san.AddIpAddress(System.Net.IPAddress.IPv6Loopback);
        request.CertificateExtensions.Add(san.Build(critical: true));

        using var certificate = request.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddMinutes(-5),
            DateTimeOffset.UtcNow.AddYears(2));
        if (promptForTrust && !ConfirmLocalhostCertificateTrust(certificate))
        {
            return;
        }
        var password = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var pfxPath = Path.Combine(certsRoot, "bridge.pfx");
        File.WriteAllBytes(pfxPath, certificate.Export(X509ContentType.Pfx, password));
        var ownershipPath = Path.Combine(certsRoot, "ownership.json");
        WriteAtomic(
            ownershipPath,
            JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                thumbprint = certificate.Thumbprint,
                subject = certificate.Subject,
                hosts = new[] { "localhost", "127.0.0.1", "::1" },
                notAfter = certificate.NotAfter.ToUniversalTime().ToString("O"),
            }, new JsonSerializerOptions { WriteIndented = true }),
            new UTF8Encoding(false));
        try
        {
            using (var rootStore = new X509Store(StoreName.Root, StoreLocation.CurrentUser))
            {
                rootStore.Open(OpenFlags.ReadWrite);
                rootStore.Add(new X509Certificate2(certificate.Export(X509ContentType.Cert)));
            }

            StoreHttpsPassword(versionRoot, password);
            ConfigureHttpsCertificate(versionRoot, pfxPath);
        }
        catch
        {
            DeleteOwnedLocalhostCertificate(installRoot);
            if (File.Exists(pfxPath)) File.Delete(pfxPath);
            if (File.Exists(ownershipPath)) File.Delete(ownershipPath);
            throw;
        }
    }

    private static bool TryReuseOwnedLocalhostCertificate(
        string installRoot,
        string versionRoot)
    {
        var certsRoot = Path.Combine(installRoot, "certs");
        var pfxPath = Path.Combine(certsRoot, "bridge.pfx");
        var ownershipPath = Path.Combine(certsRoot, "ownership.json");
        if (!File.Exists(pfxPath) || !File.Exists(ownershipPath))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(
                File.ReadAllText(ownershipPath));
            var root = document.RootElement;
            var thumbprint = root.GetProperty("thumbprint").GetString();
            var subject = root.GetProperty("subject").GetString();
            var hosts = root.GetProperty("hosts")
                .EnumerateArray()
                .Select(value => value.GetString())
                .ToArray();
            if (string.IsNullOrWhiteSpace(thumbprint) ||
                subject != LocalhostCertificateSubject ||
                !hosts.SequenceEqual(new[] { "localhost", "127.0.0.1", "::1" }))
            {
                return false;
            }

            using var store = new X509Store(
                StoreName.Root,
                StoreLocation.CurrentUser);
            store.Open(OpenFlags.ReadOnly);
            using var certificate = store.Certificates.Find(
                    X509FindType.FindByThumbprint,
                    thumbprint,
                    validOnly: false)
                .OfType<X509Certificate2>()
                .FirstOrDefault(candidate =>
                    candidate.Subject == subject);
            if (certificate is null ||
                certificate.NotBefore.ToUniversalTime() > DateTime.UtcNow ||
                certificate.NotAfter.ToUniversalTime() <= DateTime.UtcNow.AddDays(30) ||
                !IsLocalhostServerLeaf(certificate) ||
                !VerifyHttpsCertificate(
                    versionRoot,
                    pfxPath,
                    thumbprint))
            {
                return false;
            }

            ConfigureHttpsCertificate(versionRoot, pfxPath);
            return true;
        }
        catch (Exception exception) when (
            exception is CryptographicException or IOException or
            JsonException or InvalidOperationException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static bool IsLocalhostServerLeaf(X509Certificate2 certificate)
    {
        var basicConstraints = certificate.Extensions
            .OfType<X509BasicConstraintsExtension>()
            .FirstOrDefault();
        if (basicConstraints is null || basicConstraints.CertificateAuthority)
        {
            return false;
        }
        var keyUsage = certificate.Extensions
            .OfType<X509KeyUsageExtension>()
            .FirstOrDefault();
        if (keyUsage is null ||
            !keyUsage.KeyUsages.HasFlag(X509KeyUsageFlags.DigitalSignature))
        {
            return false;
        }
        var enhancedKeyUsage = certificate.Extensions
            .OfType<X509EnhancedKeyUsageExtension>()
            .FirstOrDefault();
        return enhancedKeyUsage is not null &&
               enhancedKeyUsage.EnhancedKeyUsages
                   .OfType<Oid>()
                   .Any(oid => oid.Value == "1.3.6.1.5.5.7.3.1");
    }

    private static bool VerifyHttpsCertificate(
        string versionRoot,
        string pfxPath,
        string thumbprint)
    {
        var executable = Path.Combine(
            versionRoot,
            "WordOllama.DesktopBridge.exe");
        var startInfo = new ProcessStartInfo
        {
            FileName = executable,
            WorkingDirectory = versionRoot,
            UseShellExecute = false,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add("https-certificate-secret");
        startInfo.ArgumentList.Add("verify-certificate");
        startInfo.ArgumentList.Add(pfxPath);
        startInfo.ArgumentList.Add(thumbprint);
        using var process = Process.Start(startInfo);
        if (process is null)
        {
            return false;
        }
        if (!process.WaitForExit(30_000))
        {
            process.Kill(entireProcessTree: true);
            return false;
        }
        return process.ExitCode == 0;
    }

    private static void StoreHttpsPassword(string versionRoot, string password)
    {
        var executable = Path.Combine(versionRoot, "WordOllama.DesktopBridge.exe");
        var startInfo = new ProcessStartInfo
        {
            FileName = executable,
            WorkingDirectory = versionRoot,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add("https-certificate-secret");
        startInfo.ArgumentList.Add("set");
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Unable to start HTTPS secret provisioning.");
        process.StandardInput.WriteLine(password);
        process.StandardInput.Close();
        if (!process.WaitForExit(30_000) || process.ExitCode != 0)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            throw new InvalidOperationException(
                "Unable to store the HTTPS certificate password: " +
                process.StandardError.ReadToEnd().Trim());
        }
    }

    private static void ConfigureHttpsCertificate(string versionRoot, string pfxPath)
    {
        var settingsPath = Path.Combine(versionRoot, "appsettings.json");
        var root = JsonNode.Parse(File.ReadAllText(settingsPath))?.AsObject()
            ?? throw new InvalidDataException("Bridge appsettings.json is invalid.");
        var bridge = root["Bridge"]?.AsObject()
            ?? throw new InvalidDataException("Bridge settings are missing.");
        var https = bridge["HttpsCertificate"]?.AsObject()
            ?? throw new InvalidDataException("Bridge HTTPS settings are missing.");
        https["Path"] = pfxPath.Replace('\\', '/');
        https["Password"] = string.Empty;
        WriteAtomic(
            settingsPath,
            root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }),
            new UTF8Encoding(false));
    }

    private static void DeleteOwnedLocalhostCertificate(string installRoot)
    {
        var ownershipPath = Path.Combine(installRoot, "certs", "ownership.json");
        if (!File.Exists(ownershipPath)) return;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(ownershipPath));
            var thumbprint = document.RootElement.GetProperty("thumbprint").GetString();
            var subject = document.RootElement.GetProperty("subject").GetString();
            if (string.IsNullOrWhiteSpace(thumbprint) ||
                !IsOwnedLocalhostCertificateSubject(subject)) return;
            using var store = new X509Store(StoreName.Root, StoreLocation.CurrentUser);
            store.Open(OpenFlags.ReadWrite);
            foreach (var certificate in store.Certificates.Find(
                         X509FindType.FindByThumbprint,
                         thumbprint,
                         validOnly: false))
            {
                if (certificate.Subject == subject) store.Remove(certificate);
                certificate.Dispose();
            }
        }
        catch (Exception exception) when (
            exception is CryptographicException or IOException or
            JsonException or InvalidOperationException or UnauthorizedAccessException)
        {
            // An absent or unreadable owned certificate must not block uninstall.
        }
    }

    private static bool IsOwnedLocalhostCertificateSubject(string? subject) =>
        subject is LocalhostCertificateSubject or LegacyLocalhostCertificateSubject;

    private static void StopOwnedBridgeProcesses(string installRoot)
    {
        var prefix = installRoot + Path.DirectorySeparatorChar;
        foreach (var process in Process.GetProcessesByName(
                     "WordOllama.DesktopBridge"))
        {
            using (process)
            {
                try
                {
                    var path = process.MainModule?.FileName;
                    if (path is not null &&
                        Path.GetFullPath(path).StartsWith(
                            prefix,
                            StringComparison.OrdinalIgnoreCase))
                    {
                        process.Kill(entireProcessTree: true);
                        process.WaitForExit(5000);
                    }
                }
                catch (InvalidOperationException)
                {
                    // The process exited between enumeration and inspection.
                }
            }
        }
    }

    private static void ScheduleSelfRemoval(
        string executablePath,
        string installRoot)
    {
        var cleanupExecutable = Path.Combine(
            Path.GetTempPath(),
            "WordOllama.JS-Cleanup-" +
            Guid.NewGuid().ToString("N") +
            ".exe");
        File.Copy(executablePath, cleanupExecutable);
        var startInfo = new ProcessStartInfo
        {
            FileName = cleanupExecutable,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        startInfo.ArgumentList.Add("--cleanup-root");
        startInfo.ArgumentList.Add(installRoot);
        startInfo.ArgumentList.Add("--wait-pid");
        startInfo.ArgumentList.Add(
            Environment.ProcessId.ToString(
                System.Globalization.CultureInfo.InvariantCulture));
        startInfo.ArgumentList.Add("--quiet");
        _ = Process.Start(startInfo)
            ?? throw new InvalidOperationException(
                "Unable to start the setup cleanup process.");
    }

    private static void CleanupAfterUninstall(
        string? installRoot,
        string? waitPid)
    {
        var root = ValidateOwnedPath(
            installRoot,
            "cleanup root");
        var localApplicationData = Path.GetFullPath(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData))
            .TrimEnd(Path.DirectorySeparatorChar) +
            Path.DirectorySeparatorChar;
        if (!root.StartsWith(
                localApplicationData,
                StringComparison.OrdinalIgnoreCase) ||
            !root.Contains(
                $"{Path.DirectorySeparatorChar}WordOllama.JS{Path.DirectorySeparatorChar}",
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "The cleanup root is outside the current user's WordOllama.JS LocalAppData directory.");
        }
        if (!int.TryParse(
                waitPid,
                System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture,
                out var processId) ||
            processId <= 0)
        {
            throw new ArgumentException(
                "The cleanup process id is invalid.");
        }
        try
        {
            using var owner = Process.GetProcessById(processId);
            owner.WaitForExit(15000);
        }
        catch (ArgumentException)
        {
            // The owning uninstaller has already exited.
        }
        for (var attempt = 0; Directory.Exists(root); attempt++)
        {
            try
            {
                Directory.Delete(root, recursive: true);
            }
            catch (Exception exception) when (
                attempt < 39 &&
                exception is IOException or UnauthorizedAccessException)
            {
                // Image locks from antivirus and process teardown can outlive
                // the owner briefly. Retry for up to ten seconds before
                // treating cleanup as failed.
                Thread.Sleep(250);
            }
        }
        var cleanupExecutable = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(cleanupExecutable))
        {
            _ = MoveFileEx(
                cleanupExecutable,
                null,
                MoveFileDelayUntilReboot);
        }
    }

    private static void WriteAtomic(
        string path,
        string content,
        Encoding encoding)
    {
        var directory = Path.GetDirectoryName(path)
            ?? throw new InvalidOperationException(
                "Unable to resolve the destination directory.");
        Directory.CreateDirectory(directory);
        if (File.Exists(path) &&
            string.Equals(
                File.ReadAllText(path, encoding),
                content,
                StringComparison.Ordinal))
        {
            return;
        }
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(temporary, content, encoding);
        File.Move(temporary, path, overwrite: true);
    }

    private static void Notify(string message, bool quiet)
    {
        if (!quiet)
        {
            MessageBoxW(
                IntPtr.Zero,
                message,
                InstallerText.Title,
                0x00000040);
        }
    }

    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    private static extern int MessageBoxW(
        IntPtr window,
        string text,
        string caption,
        uint type);

    private const uint MoveFileDelayUntilReboot = 0x00000004;
    private const uint CredentialTypeGeneric = 1;

    [DllImport(
        "kernel32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileEx(
        string existingFileName,
        string? newFileName,
        uint flags);

    [DllImport(
        "Advapi32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredDelete(
        string targetName,
        uint type,
        uint flags);
}
