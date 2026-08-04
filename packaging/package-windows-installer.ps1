[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9A-Za-z][0-9A-Za-z._-]*$")]
    [string]$Version,
    [string]$WindowsCertificateThumbprint = "",
    [string]$ExpectedPublisherSubject = "",
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [string]$OutputPath = "",
    [string]$EvidencePath = "",
    [switch]$BuildUnsignedForTests
)

$ErrorActionPreference = "Stop"
$allowUnsignedTest = $BuildUnsignedForTests -and
    $Version -match "(?i)(smoke|test)"
if (-not $IsWindows) {
    throw "The Windows installer must be built and signed on Windows."
}
if (-not $allowUnsignedTest -and (
        [string]::IsNullOrWhiteSpace($WindowsCertificateThumbprint) -or
        [string]::IsNullOrWhiteSpace($ExpectedPublisherSubject) -or
        [string]::IsNullOrWhiteSpace($TimestampUrl))) {
    throw "Production Windows installer packaging requires a certificate thumbprint, exact publisher subject, and RFC 3161 timestamp URL."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$project = Join-Path $repoRoot `
    "src\WordOllama.WindowsInstaller\WordOllama.WindowsInstaller.csproj"
$root = (Resolve-Path -LiteralPath $ArtifactRoot).Path
$bridgeArchive = Join-Path $root "WordOllama-Bridge-$Version-win-x64.zip"
if (-not (Test-Path -LiteralPath $bridgeArchive -PathType Leaf)) {
    throw "Signed Windows Bridge archive is missing: $bridgeArchive"
}
$bridgeArchiveHash = (Get-FileHash -LiteralPath $bridgeArchive -Algorithm SHA256).Hash.ToLowerInvariant()

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $root "WordOllama-Installer-$Version-win-x64.exe"
}
$installerPath = [IO.Path]::GetFullPath($OutputPath)
$installerDirectory = Split-Path -Parent $installerPath
if (-not [string]::IsNullOrWhiteSpace($installerDirectory)) {
    New-Item -ItemType Directory -Force -Path $installerDirectory | Out-Null
}
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = [IO.Path]::ChangeExtension($installerPath, ".installer.json")
}
$evidenceFullPath = [IO.Path]::GetFullPath($EvidencePath)
$staging = Join-Path $root `
    (".$Version-win-x64-installer-staging-" + [Guid]::NewGuid().ToString("N"))
$publish = Join-Path $staging "publish"
$metadataPath = Join-Path $staging "bridge-metadata.json"
New-Item -ItemType Directory -Force -Path $publish | Out-Null

function Find-SignTool {
    $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }
    $windowsKitsRoot = if ([string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        ""
    }
    else {
        Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    }
    if (-not [string]::IsNullOrWhiteSpace($windowsKitsRoot) -and
        (Test-Path -LiteralPath $windowsKitsRoot -PathType Container)) {
        $candidates = @(Get-ChildItem -LiteralPath $windowsKitsRoot -Directory |
            ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            Sort-Object -Descending)
        if ($candidates.Count -gt 0) {
            return [string]$candidates[0]
        }
    }
    throw "Windows installer signing requires signtool.exe."
}

try {
    [ordered]@{
        schemaVersion = 1
        product = "WordOllama.JS Desktop Bridge"
        version = $Version
        runtime = "win-x64"
        archiveSha256 = $bridgeArchiveHash
    } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8

    if (-not $allowUnsignedTest) {
        $extractRoot = Join-Path $staging "bridge-signature-check"
        Expand-Archive -LiteralPath $bridgeArchive -DestinationPath $extractRoot -Force
        $signedFiles = @(Get-ChildItem -LiteralPath $extractRoot -Recurse -File |
            Where-Object { $_.Extension -in @(".exe", ".dll") })
        if ($signedFiles.Count -eq 0) {
            throw "Windows Bridge archive contains no PE files."
        }
        foreach ($file in $signedFiles) {
            $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
            if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
                $null -eq $signature.SignerCertificate -or
                $null -eq $signature.TimeStamperCertificate -or
            $signature.SignerCertificate.Subject -ne $ExpectedPublisherSubject) {
                throw "Bridge payload signature, timestamp, or publisher is invalid for $($file.Name)."
            }
        }
    }

    & dotnet publish $project -c Release -r win-x64 --self-contained true `
        "-p:BridgeArchive=$bridgeArchive" `
        "-p:BridgeMetadata=$metadataPath" `
        "-p:InformationalVersion=$Version" `
        -o $publish
    if ($LASTEXITCODE -ne 0) {
        throw "Windows installer publish failed with exit code $LASTEXITCODE."
    }
    $publishedInstaller = Join-Path $publish "WordOllama.JS.Setup.exe"
    if (-not (Test-Path -LiteralPath $publishedInstaller -PathType Leaf)) {
        throw "Windows installer publish did not produce the single-file setup executable."
    }
    if (Test-Path -LiteralPath $installerPath) {
        Remove-Item -LiteralPath $installerPath -Force
    }
    Move-Item -LiteralPath $publishedInstaller -Destination $installerPath

    if ($allowUnsignedTest) {
        Write-Host "Built unsigned Windows installer fixture $installerPath"
        return
    }

    $signTool = Find-SignTool
    & $signTool sign /fd SHA256 /sha1 $WindowsCertificateThumbprint `
        /tr $TimestampUrl /td SHA256 $installerPath
    if ($LASTEXITCODE -ne 0) {
        throw "Windows installer Authenticode signing failed with exit code $LASTEXITCODE."
    }
    & $signTool verify /pa /all /v $installerPath
    if ($LASTEXITCODE -ne 0) {
        throw "Windows installer Authenticode policy verification failed."
    }
    $installerSignature = Get-AuthenticodeSignature -LiteralPath $installerPath
    if ($installerSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $null -eq $installerSignature.SignerCertificate -or
        $null -eq $installerSignature.TimeStamperCertificate -or
        $installerSignature.SignerCertificate.Subject -ne $ExpectedPublisherSubject) {
        throw "Windows installer signature is invalid, untimestamped, or has the wrong publisher."
    }

    $publisherCertificatePath = [IO.Path]::ChangeExtension(
        $installerPath,
        ".publisher.cer")
    Export-Certificate -Cert $installerSignature.SignerCertificate `
        -FilePath $publisherCertificatePath -Type CERT -Force | Out-Null
    $exportedCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
        [IO.File]::ReadAllBytes($publisherCertificatePath))
    if ($exportedCertificate.Thumbprint -ne $installerSignature.SignerCertificate.Thumbprint) {
        throw "Exported publisher certificate does not match the installer signer."
    }
    $selfSignedPublisher = $exportedCertificate.Subject -eq $exportedCertificate.Issuer
    if ($selfSignedPublisher) {
        $basicConstraints = @($exportedCertificate.Extensions |
            Where-Object { $_.Oid.Value -eq "2.5.29.19" } |
            Select-Object -First 1)
        $enhancedKeyUsage = @($exportedCertificate.Extensions |
            Where-Object { $_.Oid.Value -eq "2.5.29.37" } |
            Select-Object -First 1)
        if ($basicConstraints.Count -gt 1 -or
            ($basicConstraints.Count -eq 1 -and
             ([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]$basicConstraints[0]).CertificateAuthority) -or
            $enhancedKeyUsage.Count -ne 1 -or
            -not ([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]$enhancedKeyUsage[0]).EnhancedKeyUsages[
                "1.3.6.1.5.5.7.3.3"]) {
            throw "A self-signed publisher certificate must be a non-CA certificate restricted to code signing."
        }
    }

    $evidenceDirectory = Split-Path -Parent $evidenceFullPath
    if (-not [string]::IsNullOrWhiteSpace($evidenceDirectory)) {
        New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
    }
    $evidence = [ordered]@{
        schemaVersion = 1
        kind = "windows-installer-package"
        product = "WordOllama.JS Desktop Bridge"
        version = $Version
        runtime = "win-x64"
        generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
        packagePath = [IO.Path]::GetFileName($installerPath)
        packageSha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
        packageSizeBytes = (Get-Item -LiteralPath $installerPath).Length
        bridgeArchiveSha256 = $bridgeArchiveHash
        publisherSubject = $installerSignature.SignerCertificate.Subject
        signerThumbprint = $installerSignature.SignerCertificate.Thumbprint
        signerPublicKeySha256 = [BitConverter]::ToString(
            [Security.Cryptography.SHA256]::Create().ComputeHash(
                $installerSignature.SignerCertificate.GetPublicKey())).Replace('-', '').ToLowerInvariant()
        timestampThumbprint = $installerSignature.TimeStamperCertificate.Thumbprint
        publisherCertificatePath = [IO.Path]::GetFileName($publisherCertificatePath)
        publisherCertificateSha256 = (Get-FileHash -LiteralPath $publisherCertificatePath -Algorithm SHA256).Hash.ToLowerInvariant()
        publisherCertificateSelfSigned = $selfSignedPublisher
        publisherCertificateExplicitTrustRequired = $selfSignedPublisher
        authenticodeValid = $true
        rfc3161TimestampPresent = $true
        perUserInstall = $true
    }
    $evidenceTemp = "$evidenceFullPath.$([Guid]::NewGuid().ToString('N')).tmp"
    $evidence | ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath $evidenceTemp -Encoding utf8
    Move-Item -LiteralPath $evidenceTemp -Destination $evidenceFullPath -Force
    Write-Host "Created signed Windows installer $installerPath"
    Write-Host "Created Windows installer evidence $evidenceFullPath"
}
finally {
    if (Test-Path -LiteralPath $staging) {
        $resolvedStaging = (Resolve-Path -LiteralPath $staging).Path
        $expectedPrefix = $root.TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $resolvedStaging.StartsWith(
                $expectedPrefix,
                [StringComparison]::OrdinalIgnoreCase) -or
            -not ([IO.Path]::GetFileName($resolvedStaging)).StartsWith(
                ".$Version-win-x64-installer-staging-",
                [StringComparison]::Ordinal)) {
            throw "Refusing to remove unexpected Windows installer staging path: $resolvedStaging"
        }
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
