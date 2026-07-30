using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace WordOllama.DesktopBridge;

public sealed record UpdateInstallResult(
    string Status,
    string Version,
    string Runtime,
    string FileName);

public interface IUpdateInstallerPlatform
{
    Task VerifyAsync(
        string installerPath,
        string expectedPublisherSubject,
        CancellationToken cancellationToken);

    void Launch(string installerPath);
}

public sealed class UpdateInstallerService
{
    private const long MaxInstallerBytes = 512L * 1024 * 1024;
    private readonly HttpClient _httpClient;
    private readonly UpdateIndexService _updates;
    private readonly IUpdateInstallerPlatform _platform;
    private readonly string _downloadRoot;
    private readonly string _expectedPublisherSubject;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public UpdateInstallerService(
        HttpClient httpClient,
        UpdateIndexService updates,
        IUpdateInstallerPlatform platform,
        string downloadRoot,
        string expectedPublisherSubject)
    {
        _httpClient = httpClient;
        _updates = updates;
        _platform = platform;
        _downloadRoot = Path.GetFullPath(downloadRoot);
        _expectedPublisherSubject = expectedPublisherSubject.Trim();
    }

    public async Task<UpdateInstallResult> DownloadVerifyAndLaunchAsync(
        CancellationToken cancellationToken = default)
    {
        if (!await _gate.WaitAsync(0, cancellationToken))
        {
            throw new UpdateInstallBusyException();
        }

        string? temporaryPath = null;
        string? installerPath = null;
        try
        {
            var update = await _updates.CheckAsync(cancellationToken);
            var artifact = update.Artifact;
            if (!update.Configured ||
                !update.UpdateAvailable ||
                string.IsNullOrWhiteSpace(update.LatestVersion) ||
                artifact is null ||
                !string.Equals(artifact.Kind, "installer", StringComparison.Ordinal) ||
                !IsValidPublisherSubject(artifact.PublisherSubject) ||
                !IsValidPublisherSubject(_expectedPublisherSubject) ||
                !string.Equals(
                    artifact.PublisherSubject,
                    _expectedPublisherSubject,
                    StringComparison.Ordinal))
            {
                throw new UpdateInstallUnavailableException(
                    "A newer signed platform installer with pinned publisher metadata is not available.");
            }
            if (!string.Equals(
                    artifact.Runtime,
                    UpdateIndexService.CurrentRuntime(),
                    StringComparison.Ordinal))
            {
                throw new InvalidDataException("Update installer runtime does not match this Bridge.");
            }
            if (artifact.SizeBytes <= 0 || artifact.SizeBytes > MaxInstallerBytes)
            {
                throw new InvalidDataException("Update installer size is outside the permitted range.");
            }
            var publisherSubject = _expectedPublisherSubject;

            var installerUri = ValidateInstallerUri(artifact.Url, artifact.Runtime);
            Directory.CreateDirectory(_downloadRoot);
            var extension = OperatingSystem.IsWindows() ? ".exe" : ".pkg";
            var safeVersion = update.LatestVersion;
            installerPath = Path.Combine(
                _downloadRoot,
                $"WordOllama-Installer-{safeVersion}-{artifact.Runtime}{extension}");
            temporaryPath = Path.Combine(
                _downloadRoot,
                $".download-{Guid.NewGuid():N}.tmp");

            using var response = await _httpClient.GetAsync(
                installerUri,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            response.EnsureSuccessStatusCode();
            var finalUri = response.RequestMessage?.RequestUri
                ?? throw new InvalidDataException("Update installer response has no final URL.");
            _ = ValidateInstallerUri(finalUri.AbsoluteUri, artifact.Runtime);
            if (response.Content.Headers.ContentLength is long contentLength &&
                contentLength != artifact.SizeBytes)
            {
                throw new InvalidDataException("Update installer content length does not match the index.");
            }

            await using (var source = await response.Content.ReadAsStreamAsync(cancellationToken))
            await using (var target = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                64 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan))
            using (var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
            {
                var buffer = new byte[64 * 1024];
                long total = 0;
                while (true)
                {
                    var count = await source.ReadAsync(buffer, cancellationToken);
                    if (count == 0) break;
                    total += count;
                    if (total > artifact.SizeBytes || total > MaxInstallerBytes)
                    {
                        throw new InvalidDataException("Update installer exceeds the indexed size.");
                    }
                    hash.AppendData(buffer, 0, count);
                    await target.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
                }
                await target.FlushAsync(cancellationToken);
                if (total != artifact.SizeBytes)
                {
                    throw new InvalidDataException("Update installer size does not match the index.");
                }
                var actualHash = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
                if (!CryptographicOperations.FixedTimeEquals(
                        Convert.FromHexString(actualHash),
                        Convert.FromHexString(artifact.Sha256)))
                {
                    throw new InvalidDataException("Update installer SHA-256 does not match the index.");
                }
            }

            File.Move(temporaryPath, installerPath, true);
            temporaryPath = null;
            await _platform.VerifyAsync(
                installerPath,
                publisherSubject,
                cancellationToken);
            _platform.Launch(installerPath);
            return new UpdateInstallResult(
                "launched",
                update.LatestVersion,
                artifact.Runtime,
                Path.GetFileName(installerPath));
        }
        catch
        {
            DeleteIfPresent(temporaryPath);
            DeleteIfPresent(installerPath);
            throw;
        }
        finally
        {
            _gate.Release();
        }
    }

    private static Uri ValidateInstallerUri(string value, string runtime)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            uri.IsLoopback ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Fragment))
        {
            throw new InvalidDataException(
                "Update installer URL must be absolute HTTPS without credentials or fragments.");
        }
        var extension = runtime.StartsWith("win-", StringComparison.Ordinal) ? ".exe" : ".pkg";
        if (!uri.AbsolutePath.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException($"Update installer URL must end with '{extension}'.");
        }
        return uri;
    }

    private static bool IsValidPublisherSubject(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        value.Length <= 512 &&
        !value.Any(char.IsControl);

    private static void DeleteIfPresent(string? path)
    {
        if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
        {
            try { File.Delete(path); } catch { /* Best-effort failure cleanup. */ }
        }
    }
}

public sealed class UpdateInstallBusyException : InvalidOperationException
{
    public UpdateInstallBusyException() : base("An update installer is already being prepared.") { }
}

public sealed class UpdateInstallUnavailableException : InvalidOperationException
{
    public UpdateInstallUnavailableException(string message) : base(message) { }
}

public sealed class SystemUpdateInstallerPlatform : IUpdateInstallerPlatform
{
    public async Task VerifyAsync(
        string installerPath,
        string expectedPublisherSubject,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(expectedPublisherSubject))
        {
            throw new InvalidDataException("Update installer publisher is not pinned.");
        }
        if (OperatingSystem.IsWindows())
        {
            await VerifyWindowsAsync(installerPath, expectedPublisherSubject, cancellationToken);
            return;
        }
        if (OperatingSystem.IsMacOS())
        {
            await VerifyMacAsync(installerPath, expectedPublisherSubject, cancellationToken);
            return;
        }
        throw new PlatformNotSupportedException(
            "Update installers are supported only on Windows and macOS.");
    }

    public void Launch(string installerPath)
    {
        ProcessStartInfo startInfo;
        if (OperatingSystem.IsWindows())
        {
            startInfo = new ProcessStartInfo(installerPath) { UseShellExecute = true };
        }
        else if (OperatingSystem.IsMacOS())
        {
            startInfo = new ProcessStartInfo("/usr/bin/open") { UseShellExecute = false };
            startInfo.ArgumentList.Add(installerPath);
        }
        else
        {
            throw new PlatformNotSupportedException(
                "Update installers are supported only on Windows and macOS.");
        }
        _ = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The platform installer could not be started.");
    }

    private static async Task VerifyWindowsAsync(
        string installerPath,
        string expectedPublisherSubject,
        CancellationToken cancellationToken)
    {
        const string script = """
            $signature = Get-AuthenticodeSignature -LiteralPath $args[0]
            [pscustomobject]@{
              status = [string]$signature.Status
              subject = [string]$signature.SignerCertificate.Subject
              issuer = [string]$signature.SignerCertificate.Issuer
              hasTimestamp = $null -ne $signature.TimeStamperCertificate
            } | ConvertTo-Json -Compress
            """;
        var result = await RunAsync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", script, installerPath],
            cancellationToken);
        if (result.ExitCode != 0)
        {
            throw new InvalidDataException("Windows installer signature verification failed.");
        }
        using var document = JsonDocument.Parse(result.Output);
        var root = document.RootElement;
        var status = root.GetProperty("status").GetString();
        var subject = root.GetProperty("subject").GetString();
        var issuer = root.GetProperty("issuer").GetString();
        var hasTimestamp = root.GetProperty("hasTimestamp").GetBoolean();
        if (!string.Equals(status, "Valid", StringComparison.Ordinal) ||
            !string.Equals(subject, expectedPublisherSubject, StringComparison.Ordinal) ||
            string.Equals(subject, issuer, StringComparison.Ordinal) ||
            !hasTimestamp)
        {
            throw new InvalidDataException(
                "Windows installer signature, publisher, CA chain, or timestamp is invalid.");
        }
    }

    private static async Task VerifyMacAsync(
        string installerPath,
        string expectedPublisherSubject,
        CancellationToken cancellationToken)
    {
        var signature = await RunAsync(
            "/usr/sbin/pkgutil",
            ["--check-signature", installerPath],
            cancellationToken);
        var publisherMatched = signature.Output
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .Select(line =>
            {
                var separator = line.IndexOf(". ", StringComparison.Ordinal);
                return separator > 0 && line[..separator].All(char.IsDigit)
                    ? line[(separator + 2)..].Trim()
                    : string.Empty;
            })
            .Any(subject => string.Equals(
                subject,
                expectedPublisherSubject,
                StringComparison.Ordinal));
        if (signature.ExitCode != 0 || !publisherMatched)
        {
            throw new InvalidDataException(
                "macOS installer signature or pinned publisher is invalid.");
        }
        var assessment = await RunAsync(
            "/usr/sbin/spctl",
            ["--assess", "--type", "install", "--verbose=2", installerPath],
            cancellationToken);
        if (assessment.ExitCode != 0)
        {
            throw new InvalidDataException(
                "macOS Gatekeeper rejected the update installer.");
        }
    }

    private static async Task<ProcessResult> RunAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo(fileName)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"Could not start signature verifier: {fileName}");
        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        var output = (await outputTask) + Environment.NewLine + (await errorTask);
        return new ProcessResult(process.ExitCode, output);
    }

    private sealed record ProcessResult(int ExitCode, string Output);
}
