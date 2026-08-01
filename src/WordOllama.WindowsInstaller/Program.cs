using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
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
            var trustLocalhostCertificate = options.ContainsKey(
                "--trust-localhost-certificate") ||
                (!quiet && ConfirmLocalhostCertificateTrust());
            Install(
                installRoot,
                startupRoot,
                noStart,
                skipRegistration,
                trustLocalhostCertificate);
            Notify(InstallerText.Installed, quiet);
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
            if (argument is "--quiet" or "--no-start" or "--uninstall" or
                "--skip-registration" or "--trust-localhost-certificate")
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
            if (argument is "--cleanup-root" or "--wait-pid")
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
        bool trustLocalhostCertificate)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var metadata = ReadMetadata(assembly);
        if (metadata.SchemaVersion != 1 ||
            metadata.Product != "WordOllama.JS Desktop Bridge" ||
            metadata.Runtime != "win-x64" ||
            string.IsNullOrWhiteSpace(metadata.Version) ||
            !System.Text.RegularExpressions.Regex.IsMatch(
                metadata.Version,
                "^[0-9A-Za-z][0-9A-Za-z._-]*$") ||
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

        if (!skipRegistration)
        {
            RegisterOfficeAddin(
                Path.Combine(target, "WordOllama.JS.xml"));
            var processPath = Environment.ProcessPath
                ?? throw new InvalidOperationException(
                    "Unable to resolve the setup executable.");
            var uninstallPath = Path.Combine(
                installRoot,
                "WordOllama.JS-Uninstall.exe");
            File.Copy(processPath, uninstallPath, overwrite: true);
            RegisterUninstaller(
                uninstallPath,
                installRoot,
                metadata.Version,
                checked((int)Math.Ceiling(
                    new FileInfo(uninstallPath).Length / 1024d)));
        }

        if (!skipRegistration && trustLocalhostCertificate)
        {
            ProvisionLocalhostCertificate(installRoot, target);
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
        """
        @echo off
        setlocal
        set "WORDOLLAMA_BRIDGE_ROOT=%~dp0"
        if not exist "%WORDOLLAMA_BRIDGE_ROOT%certs\bridge.pfx" exit /b 0
        set /p "WORDOLLAMA_BRIDGE_VERSION="<"%WORDOLLAMA_BRIDGE_ROOT%current-version"
        if not defined WORDOLLAMA_BRIDGE_VERSION exit /b 2
        set "WORDOLLAMA_BRIDGE_EXE=%WORDOLLAMA_BRIDGE_ROOT%versions\%WORDOLLAMA_BRIDGE_VERSION%\WordOllama.DesktopBridge.exe"
        if not exist "%WORDOLLAMA_BRIDGE_EXE%" exit /b 3
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
        key.SetValue("InstallLocation", installRoot);
        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
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
    }

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

    private static bool ConfirmLocalhostCertificateTrust() =>
        MessageBoxW(
            IntPtr.Zero,
            InstallerText.CertificateTrustPrompt,
            InstallerText.Title,
            0x00000004 | 0x00000030) == 6;

    private static void ProvisionLocalhostCertificate(
        string installRoot,
        string versionRoot)
    {
        var certsRoot = Path.Combine(installRoot, "certs");
        Directory.CreateDirectory(certsRoot);
        DeleteOwnedLocalhostCertificate(installRoot);

        using var rsa = RSA.Create(3072);
        var request = new CertificateRequest(
            "CN=WordOllama.JS localhost",
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
                subject != "CN=WordOllama.JS localhost") return;
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
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
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
