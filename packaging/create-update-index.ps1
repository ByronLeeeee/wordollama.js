param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$DownloadBaseUrl,
    [string]$ReleaseNotes = "",
    [string]$OutputPath = "",
    [string]$SignatureUrl = "",
    [string[]]$VerifiedReleaseDescriptorPaths = @(),
    [switch]$AllowUnsignedForTests
)

$ErrorActionPreference = "Stop"
$artifactRootPath = (Resolve-Path $ArtifactRoot).Path
$runtimes = @("win-x64", "osx-arm64")
$verifiedDescriptors = @{}
if (-not $AllowUnsignedForTests) {
    if ($VerifiedReleaseDescriptorPaths.Count -eq 0) {
        throw "Production update indexes require -VerifiedReleaseDescriptorPaths from finalize-unified-release.ps1."
    }
    foreach ($descriptorPath in $VerifiedReleaseDescriptorPaths) {
        $resolvedDescriptor = (Resolve-Path -LiteralPath $descriptorPath).Path
        $descriptor = Get-Content -LiteralPath $resolvedDescriptor -Raw | ConvertFrom-Json
        if ($descriptor.schemaVersion -ne 1 -or $descriptor.product -ne "WordOllama.JS" -or
            $descriptor.releaseReady -ne $true -or $descriptor.version -ne $Version -or
            $descriptor.runtime -notin $runtimes -or
            [string]::IsNullOrWhiteSpace($descriptor.publisherSubject) -or
            [string]::IsNullOrWhiteSpace($descriptor.installerPublisherSubject) -or
            [string]::IsNullOrWhiteSpace($descriptor.finalizedAt) -or
            @($descriptor.evidence).Count -lt 5) {
            throw "Verified release descriptor is incomplete or does not match version ${Version}: $resolvedDescriptor"
        }
        $requiredEvidenceKinds = if ($descriptor.runtime -eq "win-x64") {
            @("windows-installer-package")
        }
        else {
            @("apple-notarization", "apple-installer-package")
        }
        foreach ($requiredKind in $requiredEvidenceKinds) {
            if (@($descriptor.evidence |
                    Where-Object { $_.kind -eq $requiredKind }).Count -ne 1) {
                throw "Verified release descriptor is missing '$requiredKind' evidence for $($descriptor.runtime)."
            }
        }
        if ($verifiedDescriptors.ContainsKey($descriptor.runtime)) {
            throw "Duplicate verified release descriptor for runtime $($descriptor.runtime)."
        }
        $verifiedDescriptors[$descriptor.runtime] = $descriptor
    }
    foreach ($runtime in $runtimes) {
        if (-not $verifiedDescriptors.ContainsKey($runtime)) {
            throw "Production update index is missing a verified release descriptor for $runtime."
        }
    }
}
$artifacts = @()
$installers = @()
foreach ($runtime in $runtimes) {
    $archive = Join-Path $artifactRootPath "WordOllama-Bridge-$Version-$runtime.zip"
    if (-not (Test-Path -LiteralPath $archive)) {
        continue
    }
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = (Get-Item -LiteralPath $archive).Length
    if (-not $AllowUnsignedForTests) {
        $descriptorArtifact = @($verifiedDescriptors[$runtime].artifacts |
            Where-Object { $_.kind -eq "desktop-bridge" })
        if ($descriptorArtifact.Count -ne 1 -or
            (Resolve-Path -LiteralPath $descriptorArtifact[0].path).Path -ne
                (Resolve-Path -LiteralPath $archive).Path -or
            $descriptorArtifact[0].sha256 -ne $hash -or
            [long]$descriptorArtifact[0].sizeBytes -ne $size) {
            throw "Verified descriptor does not match the $runtime Bridge archive."
        }
        $descriptorInstaller = @($verifiedDescriptors[$runtime].artifacts |
            Where-Object { $_.kind -eq "desktop-bridge-installer" })
        if ($descriptorInstaller.Count -ne 1) {
            throw "Verified descriptor is missing the $runtime user installer."
        }
        $installerPath = (Resolve-Path -LiteralPath $descriptorInstaller[0].path).Path
        $installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $installerSize = (Get-Item -LiteralPath $installerPath).Length
        if ($descriptorInstaller[0].sha256 -ne $installerHash -or
            [long]$descriptorInstaller[0].sizeBytes -ne $installerSize) {
            throw "Verified descriptor does not match the $runtime user installer."
        }
        $installers += [pscustomobject]@{
            runtime = $runtime
            url = ($DownloadBaseUrl.TrimEnd('/') + "/" + [IO.Path]::GetFileName($installerPath))
            sha256 = $installerHash
            sizeBytes = $installerSize
            publisherSubject = [string]$verifiedDescriptors[$runtime].installerPublisherSubject
            signerThumbprint = if ($runtime -eq "win-x64") {
                [string]$verifiedDescriptors[$runtime].installerSignerThumbprint
            } else { $null }
            signerPublicKeySha256 = if ($runtime -eq "win-x64") {
                [string]$verifiedDescriptors[$runtime].installerSignerPublicKeySha256
            } else { $null }
        }
    }
    $artifacts += [pscustomobject]@{
        runtime = $runtime
        url = ($DownloadBaseUrl.TrimEnd('/') + "/" + [IO.Path]::GetFileName($archive))
        sha256 = $hash
        sizeBytes = $size
        signatureUrl = if ([string]::IsNullOrWhiteSpace($SignatureUrl)) { $null } else { $SignatureUrl }
    }
}
if ($artifacts.Count -eq 0) {
    throw "No Bridge archives found under $artifactRootPath for version $Version."
}
if (-not $AllowUnsignedForTests -and $installers.Count -ne $runtimes.Count) {
    throw "Production distribution metadata requires all supported user installers."
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $artifactRootPath "update-index-$Version.json"
}
$index = [pscustomobject]@{
    schemaVersion = 1
    product = "WordOllama"
    version = $Version
    generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
    releaseNotes = $ReleaseNotes
    artifacts = @($artifacts)
    installers = @($installers)
}
$temp = "$OutputPath.$([Guid]::NewGuid().ToString('N')).tmp"
$index | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temp -Encoding UTF8
Move-Item -LiteralPath $temp -Destination $OutputPath -Force
Write-Host "Created signed-release input index $OutputPath"
