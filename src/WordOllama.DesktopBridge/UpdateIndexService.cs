using System.Net;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace WordOllama.DesktopBridge;

public sealed record UpdateArtifact(
    string Kind,
    string Runtime,
    string Url,
    string Sha256,
    long SizeBytes,
    string? SignatureUrl,
    string? PublisherSubject,
    string? SignerThumbprint,
    string? SignerPublicKeySha256);

public sealed record UpdateCheckResult(
    bool Configured,
    string CurrentVersion,
    string? LatestVersion,
    bool UpdateAvailable,
    string Runtime,
    string? GeneratedAt,
    string? ReleaseNotes,
    UpdateArtifact? Artifact);

internal sealed record UpdateIndexArtifact(
    string Runtime,
    string Url,
    string Sha256,
    long SizeBytes,
    string? SignatureUrl,
    string? PublisherSubject,
    string? SignerThumbprint,
    string? SignerPublicKeySha256);

internal sealed record UpdateIndex(
    int SchemaVersion,
    string Product,
    string Version,
    string GeneratedAt,
    string ReleaseNotes,
    IReadOnlyList<UpdateIndexArtifact>? Artifacts,
    IReadOnlyList<UpdateIndexArtifact>? Installers);

public sealed class UpdateIndexService
{
    private const int MaxIndexBytes = 1024 * 1024;
    private readonly HttpClient _httpClient;
    private readonly string _indexUrl;
    private readonly string _currentVersion;

    public UpdateIndexService(HttpClient httpClient, string indexUrl, string currentVersion)
    {
        _httpClient = httpClient;
        _indexUrl = indexUrl.Trim();
        _currentVersion = currentVersion;
    }

    public async Task<UpdateCheckResult> CheckAsync(CancellationToken cancellationToken = default)
    {
        var runtime = CurrentRuntime();
        if (string.IsNullOrWhiteSpace(_indexUrl))
        {
            return new UpdateCheckResult(
                false, _currentVersion, null, false, runtime, null, null, null);
        }

        var indexUri = ValidateHttpsUrl(_indexUrl, "update index");
        using var response = await _httpClient.GetAsync(
            indexUri,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > MaxIndexBytes)
        {
            throw new InvalidDataException("Update index exceeds the 1 MB limit.");
        }

        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var bounded = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var count = await source.ReadAsync(buffer, cancellationToken);
            if (count == 0) break;
            if (bounded.Length + count > MaxIndexBytes)
            {
                throw new InvalidDataException("Update index exceeds the 1 MB limit.");
            }
            await bounded.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
        }
        bounded.Position = 0;

        var index = await JsonSerializer.DeserializeAsync<UpdateIndex>(
            bounded,
            new JsonSerializerOptions(JsonSerializerDefaults.Web),
            cancellationToken)
            ?? throw new InvalidDataException("Update index is empty.");
        if (index.SchemaVersion != 1 ||
            !string.Equals(index.Product, "WordOllama", StringComparison.Ordinal) ||
            !IsValidVersion(index.Version))
        {
            throw new InvalidDataException("Update index metadata is invalid.");
        }

        var installer = SelectArtifact(index.Installers, runtime, "installer");
        var archive = installer is null
            ? SelectArtifact(index.Artifacts, runtime, "archive")
            : null;
        var selected = installer ?? archive;
        UpdateArtifact? artifact = null;
        if (selected is not null)
        {
            var kind = installer is not null ? "installer" : "archive";
            var artifactUri = ValidateHttpsUrl(selected.Url, $"update {kind}");
            var expectedExtension = kind == "installer"
                ? runtime.StartsWith("win-", StringComparison.Ordinal) ? ".exe" : ".pkg"
                : ".zip";
            if (!artifactUri.AbsolutePath.EndsWith(
                    expectedExtension,
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(
                    $"Update {kind} URL must end with '{expectedExtension}' for {runtime}.");
            }
            if (!Regex.IsMatch(selected.Sha256, "^[0-9a-fA-F]{64}$") ||
                selected.SizeBytes <= 0)
            {
                throw new InvalidDataException("Update artifact integrity metadata is invalid.");
            }
            if (!string.IsNullOrWhiteSpace(selected.SignatureUrl))
            {
                _ = ValidateHttpsUrl(selected.SignatureUrl, "artifact signature");
            }
            if (!string.IsNullOrWhiteSpace(selected.PublisherSubject) &&
                (selected.PublisherSubject.Length > 512 ||
                 selected.PublisherSubject.Any(char.IsControl)))
            {
                throw new InvalidDataException("Update artifact publisher metadata is invalid.");
            }
            if (!IsOptionalHex(selected.SignerThumbprint, 40, 128) ||
                !IsOptionalHex(selected.SignerPublicKeySha256, 64, 64))
                throw new InvalidDataException("Update artifact signer pin metadata is invalid.");
            artifact = new UpdateArtifact(
                kind,
                selected.Runtime,
                selected.Url,
                selected.Sha256.ToLowerInvariant(),
                selected.SizeBytes,
                selected.SignatureUrl,
                selected.PublisherSubject?.Trim(),
                NormalizeHex(selected.SignerThumbprint),
                NormalizeHex(selected.SignerPublicKeySha256));
        }

        return new UpdateCheckResult(
            true,
            _currentVersion,
            index.Version,
            IsNewer(index.Version, _currentVersion),
            runtime,
            index.GeneratedAt,
            index.ReleaseNotes,
            artifact);
    }

    private static UpdateIndexArtifact? SelectArtifact(
        IReadOnlyList<UpdateIndexArtifact>? artifacts,
        string runtime,
        string label)
    {
        var matches = (artifacts ?? [])
            .Where(item => string.Equals(item.Runtime, runtime, StringComparison.Ordinal))
            .ToArray();
        if (matches.Length > 1)
        {
            throw new InvalidDataException(
                $"Update index contains duplicate {label} entries for {runtime}.");
        }
        return matches.SingleOrDefault();
    }

    internal static string CurrentRuntime()
    {
        var prefix = OperatingSystem.IsWindows() ? "win" :
            OperatingSystem.IsMacOS() ? "osx" :
            throw new PlatformNotSupportedException("Updates are supported on Windows and macOS.");
        var architecture = RuntimeInformation.ProcessArchitecture switch
        {
            Architecture.X64 => "x64",
            Architecture.Arm64 => "arm64",
            _ => throw new PlatformNotSupportedException("Only x64 and arm64 update packages are supported."),
        };
        return $"{prefix}-{architecture}";
    }

    internal static bool IsNewer(string candidate, string current)
    {
        if (!TryParseVersion(candidate, out var candidateVersion, out var candidatePrerelease) ||
            !TryParseVersion(current, out var currentVersion, out var currentPrerelease))
        {
            return false;
        }
        var comparison = candidateVersion.CompareTo(currentVersion);
        if (comparison != 0) return comparison > 0;
        if (candidatePrerelease is null && currentPrerelease is not null) return true;
        if (candidatePrerelease is not null && currentPrerelease is null) return false;
        return string.Compare(candidatePrerelease, currentPrerelease, StringComparison.OrdinalIgnoreCase) > 0;
    }

    private static bool IsValidVersion(string? value) =>
        value is not null &&
        value.Length <= 64 &&
        Regex.IsMatch(value, "^[0-9A-Za-z][0-9A-Za-z._-]*$") &&
        TryParseVersion(value, out _, out _);

    private static bool IsOptionalHex(string? value, int minimumLength, int maximumLength) =>
        string.IsNullOrWhiteSpace(value) ||
        (value.Length >= minimumLength && value.Length <= maximumLength && value.All(Uri.IsHexDigit));

    private static string? NormalizeHex(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Replace(" ", string.Empty).ToLowerInvariant();

    private static bool TryParseVersion(string value, out Version version, out string? prerelease)
    {
        version = new Version();
        prerelease = null;
        var normalized = value.Trim().TrimStart('v', 'V');
        var plus = normalized.IndexOf('+');
        if (plus >= 0) normalized = normalized[..plus];
        var dash = normalized.IndexOf('-');
        if (dash >= 0)
        {
            prerelease = normalized[(dash + 1)..];
            normalized = normalized[..dash];
            if (string.IsNullOrWhiteSpace(prerelease)) return false;
        }
        return Version.TryParse(normalized, out version!);
    }

    private static Uri ValidateHttpsUrl(string value, string label)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            uri.IsLoopback ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Fragment))
        {
            throw new InvalidDataException($"{label} URL must be absolute HTTPS without credentials or fragments.");
        }
        return uri;
    }
}
