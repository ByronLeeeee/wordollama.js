param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9A-Za-z][0-9A-Za-z._-]*$")]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9A-Fa-f]{64}$")]
    [string]$ExpectedSha256,
    [switch]$RequirePlatformSignature,
    [string]$ExpectedPublisherSubject = "",
    [int]$KeepVersions = 2
)

$ErrorActionPreference = "Stop"
$archive = (Resolve-Path $ArchivePath).Path
$root = [IO.Path]::GetFullPath($InstallRoot)
New-Item -ItemType Directory -Force -Path $root | Out-Null

$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($actualHash -ne $ExpectedSha256) {
    throw "Bridge update hash mismatch. Expected $ExpectedSha256, got $actualHash."
}

$versionsRoot = Join-Path $root "versions"
$staging = Join-Path $root (".staging-" + [Guid]::NewGuid().ToString("N"))
$target = Join-Path $versionsRoot $Version
if (Test-Path -LiteralPath $target) {
    throw "Bridge version already installed: $Version"
}
New-Item -ItemType Directory -Force -Path $staging,$versionsRoot | Out-Null
try {
    Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
    $bridgeBinaries = @(Get-ChildItem -LiteralPath $staging -Recurse -File |
        Where-Object { $_.Name -in @("WordOllama.DesktopBridge.exe", "WordOllama.DesktopBridge") })
    if ($bridgeBinaries.Count -ne 1) {
        throw "Archive must contain exactly one DesktopBridge executable; found $($bridgeBinaries.Count)."
    }
    $payloadRoot = $bridgeBinaries[0].Directory.FullName
    $stagingFullPath = [IO.Path]::GetFullPath($staging).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar)
    $payloadRootFullPath = [IO.Path]::GetFullPath($payloadRoot).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar)
    if ($payloadRootFullPath -ne $stagingFullPath) {
        $payloadParent = [IO.Directory]::GetParent($payloadRootFullPath).FullName.TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar)
        $rootPayloadEntries = @(Get-ChildItem -LiteralPath $staging |
            Where-Object { $_.Name -ne "__MACOSX" })
        if ($payloadParent -ne $stagingFullPath -or $rootPayloadEntries.Count -ne 1 -or
            $rootPayloadEntries[0].FullName -ne $payloadRootFullPath) {
            throw "Archive payload must be at the ZIP root or in one legacy top-level directory."
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $payloadRootFullPath "appsettings.json") -PathType Leaf)) {
        throw "Archive payload is missing appsettings.json beside the DesktopBridge executable."
    }
    if ($RequirePlatformSignature) {
        $bridgeExecutable = $bridgeBinaries[0].FullName
        if ($bridgeBinaries[0].Name.EndsWith(".exe", [StringComparison]::OrdinalIgnoreCase)) {
            if (-not $IsWindows) {
                throw "Windows Authenticode verification must run on Windows."
            }
            $signature = Get-AuthenticodeSignature -LiteralPath $bridgeExecutable
            if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
                $null -eq $signature.SignerCertificate) {
                throw "Bridge update Authenticode signature is not valid: $($signature.Status)."
            }
            if ($null -eq $signature.TimeStamperCertificate) {
                throw "Bridge update Authenticode signature is missing its RFC 3161 timestamp."
            }
            if ($signature.SignerCertificate.Subject -eq $signature.SignerCertificate.Issuer) {
                throw "Bridge update Authenticode signer is self-signed instead of a CA-issued code-signing certificate."
            }
            if (-not [string]::IsNullOrWhiteSpace($ExpectedPublisherSubject) -and
                $signature.SignerCertificate.Subject -ne $ExpectedPublisherSubject) {
                throw "Bridge update publisher mismatch. Expected '$ExpectedPublisherSubject', got '$($signature.SignerCertificate.Subject)'."
            }
        }
        else {
            if (-not $IsMacOS) {
                throw "macOS code signature verification must run on macOS."
            }
            & /usr/bin/codesign --verify --deep --strict --verbose=2 $bridgeExecutable
            if ($LASTEXITCODE -ne 0) {
                throw "Bridge update codesign verification failed with exit code $LASTEXITCODE."
            }
            $assessment = & /usr/sbin/spctl --assess --type execute --verbose=2 $bridgeExecutable 2>&1
            if ($LASTEXITCODE -ne 0) {
                throw "Bridge update Gatekeeper assessment failed: $($assessment -join ' ')"
            }
            if (-not [string]::IsNullOrWhiteSpace($ExpectedPublisherSubject)) {
                $signatureDetails = & /usr/bin/codesign -dv --verbose=4 $bridgeExecutable 2>&1
                if ($LASTEXITCODE -ne 0 -or
                    -not (($signatureDetails -join "`n").Contains(
                        "Authority=$ExpectedPublisherSubject",
                        [StringComparison]::Ordinal))) {
                    throw "Bridge update macOS signing identity does not match '$ExpectedPublisherSubject'."
                }
            }
        }
    }
    Move-Item -LiteralPath $payloadRootFullPath -Destination $target
    $statePath = Join-Path $root "current.json"
    $previous = $null
    if (Test-Path -LiteralPath $statePath) {
        try { $previous = (Get-Content $statePath -Raw | ConvertFrom-Json).currentVersion } catch { $previous = $null }
    }
    $state = [pscustomobject]@{
        currentVersion = $Version
        previousVersion = $previous
        installedAt = [DateTimeOffset]::UtcNow.ToString("O")
        sha256 = $actualHash.ToLowerInvariant()
    }
    $stateTemp = "$statePath.$([Guid]::NewGuid().ToString('N')).tmp"
    $state | ConvertTo-Json | Set-Content -LiteralPath $stateTemp -Encoding UTF8
    Move-Item -LiteralPath $stateTemp -Destination $statePath -Force
    $currentVersionPath = Join-Path $root "current-version"
    $currentVersionTemp = "$currentVersionPath.$([Guid]::NewGuid().ToString('N')).tmp"
    Set-Content -LiteralPath $currentVersionTemp -Value $Version -Encoding utf8NoBOM -NoNewline
    Move-Item -LiteralPath $currentVersionTemp -Destination $currentVersionPath -Force
}
finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}

$keep = [Math]::Max(1, $KeepVersions)
$installed = @(Get-ChildItem -LiteralPath $versionsRoot -Directory | Sort-Object LastWriteTime -Descending)
foreach ($old in $installed | Select-Object -Skip $keep) {
    Remove-Item -LiteralPath $old.FullName -Recurse -Force
}
Write-Host "Installed Bridge $Version under $root; previous version is retained in current.json."
