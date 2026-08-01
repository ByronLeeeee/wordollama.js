[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BuildDescriptorPath,
    [Parameter(Mandatory = $true)][string]$HttpsEvidencePath,
    [Parameter(Mandatory = $true)][string]$GoldenReportPath,
    [Parameter(Mandatory = $true)][string]$LongDocumentReportPath,
    [Parameter(Mandatory = $true)][string]$RevisionReportPath,
    [Parameter(Mandatory = $true)][string]$SupplementalHostReportPath,
    [Parameter(Mandatory = $true)][string]$ExpectedPublisherSubject,
    [string]$WindowsInstallerEvidencePath = "",
    [string]$MacNotarizationEvidencePath = "",
    [string]$MacInstallerEvidencePath = "",
    [string]$ExpectedMacInstallerPublisherSubject = "",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path,[Parameter(Mandatory = $true)][string]$Label)
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    try {
        return [pscustomobject]@{
            Path = $resolved
            Value = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
        }
    }
    catch {
        throw "$Label is not valid JSON: $resolved"
    }
}

function Assert-ReleaseIdentity {
    param(
        [Parameter(Mandatory = $true)]$Report,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Version
    )
    if ($null -eq $Report.release -or
        $Report.release.addinVersion -ne $Version -or
        $Report.release.bridgeVersion -ne $Version -or
        $Report.release.protocolVersion -ne "1.0") {
        throw "$Label does not prove Add-in/Bridge version $Version and protocol 1.0."
    }
}

function Assert-Host {
    param(
        [Parameter(Mandatory = $true)]$Report,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$ExpectedPlatform
    )
    if ($null -eq $Report.host -or
        $Report.host.host -ne "Word" -or
        $Report.host.platform -ne $ExpectedPlatform -or
        [string]::IsNullOrWhiteSpace($Report.host.version) -or
        $Report.host.version -eq "unknown") {
        throw "$Label does not identify a real Word $ExpectedPlatform host."
    }
}

function Assert-AfterBuild {
    param(
        [Parameter(Mandatory = $true)][string]$Timestamp,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][DateTimeOffset]$BuildTime
    )
    [DateTimeOffset]$reportTime = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($Timestamp, [ref]$reportTime) -or
        $reportTime -lt $BuildTime) {
        throw "$Label predates the packaged build and cannot be used as release evidence."
    }
}

$descriptorRecord = Read-JsonFile -Path $BuildDescriptorPath -Label "Build descriptor"
$descriptor = $descriptorRecord.Value
if ($descriptor.schemaVersion -ne 1 -or $descriptor.product -ne "WordOllama.JS" -or
    $descriptor.releaseReady -ne $false -or
    $descriptor.runtime -notin @("win-x64", "osx-arm64")) {
    throw "Build descriptor is not an unsigned WordOllama.JS runtime descriptor."
}
$version = [string]$descriptor.version
if ([string]::IsNullOrWhiteSpace($version)) { throw "Build descriptor version is missing." }
[DateTimeOffset]$buildTime = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse([string]$descriptor.generatedAt, [ref]$buildTime)) {
    throw "Build descriptor generatedAt is invalid."
}
$expectedPlatform = if ($descriptor.runtime -eq "win-x64") { "PC" } else { "Mac" }
$evidencePlatform = if ($descriptor.runtime -eq "win-x64") { "windows" } else { "macos" }
$expectedInstallerPublisher = if ($descriptor.runtime -eq "win-x64") {
    $ExpectedPublisherSubject
} else {
    $ExpectedMacInstallerPublisherSubject
}
if ([string]::IsNullOrWhiteSpace($expectedInstallerPublisher) -or
    $descriptor.expectedUpdatePublisherSubject -ne $expectedInstallerPublisher) {
    throw "Build descriptor does not pin the finalized installer publisher."
}
if (($descriptor.runtime -eq "win-x64" -and -not $IsWindows) -or
    ($descriptor.runtime -like "osx-*" -and -not $IsMacOS)) {
    throw "Release finalization for $($descriptor.runtime) must run on its target operating system."
}

$artifactRecords = @($descriptor.artifacts)
$addinArtifact = $artifactRecords | Where-Object { $_.kind -eq "office-addin" }
$bridgeArtifact = $artifactRecords | Where-Object { $_.kind -eq "desktop-bridge" }
if (@($addinArtifact).Count -ne 1 -or @($bridgeArtifact).Count -ne 1) {
    throw "Build descriptor must contain exactly one Add-in and one Desktop Bridge artifact."
}
$addinArchive = (Resolve-Path -LiteralPath $addinArtifact.path).Path
$bridgeArchive = (Resolve-Path -LiteralPath $bridgeArtifact.path).Path
$sourceAddinHash = [string]$addinArtifact.sha256
$sourceAddinSize = [long]$addinArtifact.sizeBytes
$actualAddinHash = (Get-FileHash -LiteralPath $addinArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$actualAddinSize = (Get-Item -LiteralPath $addinArchive).Length
if ($sourceAddinHash -notmatch "^[0-9a-f]{64}$" -or
    $sourceAddinHash -ne $actualAddinHash -or
    $sourceAddinSize -le 0 -or
    $sourceAddinSize -ne $actualAddinSize) {
    throw "Add-in artifact no longer matches the packaged build descriptor."
}

# Signing necessarily mutates the Bridge binaries and rebuilt archive. Preserve
# the unsigned hash as source evidence, then authenticate the current archive
# below with the target platform's signature and publisher policy.
$sourceBridgeHash = [string]$bridgeArtifact.sha256
$sourceBridgeSize = [long]$bridgeArtifact.sizeBytes
if ($sourceBridgeHash -notmatch "^[0-9a-f]{64}$" -or $sourceBridgeSize -le 0) {
    throw "Desktop Bridge source artifact metadata is invalid."
}
$actualBridgeHash = (Get-FileHash -LiteralPath $bridgeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$actualBridgeSize = (Get-Item -LiteralPath $bridgeArchive).Length

$extractRoot = Join-Path ([IO.Path]::GetTempPath()) ("wordollama-finalize-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
try {
    if ($IsMacOS) {
        & /usr/bin/ditto -x -k $bridgeArchive $extractRoot
        if ($LASTEXITCODE -ne 0) { throw "Unable to extract the macOS Bridge archive with ditto." }
    } else {
        Expand-Archive -LiteralPath $bridgeArchive -DestinationPath $extractRoot -Force
    }
    $bridgeBinaries = @(Get-ChildItem -LiteralPath $extractRoot -Recurse -File |
        Where-Object { $_.Name -in @("WordOllama.DesktopBridge.exe", "WordOllama.DesktopBridge") })
    if ($bridgeBinaries.Count -ne 1) {
        throw "Signed Bridge archive must contain exactly one Desktop Bridge executable."
    }
    if ($IsWindows) {
        $signedFiles = @(Get-ChildItem -LiteralPath $extractRoot -Recurse -File |
            Where-Object { $_.Extension -in @(".exe", ".dll") })
        if ($signedFiles.Count -eq 0) { throw "Windows Bridge archive contains no PE files." }
        foreach ($file in $signedFiles) {
            $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
            if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
                $null -eq $signature.SignerCertificate -or
                $null -eq $signature.TimeStamperCertificate -or
                $signature.SignerCertificate.Subject -ne $ExpectedPublisherSubject) {
                throw "Authenticode verification failed for $($file.Name), its RFC 3161 timestamp is missing, or its publisher does not match."
            }
        }
        if ([string]::IsNullOrWhiteSpace($WindowsInstallerEvidencePath)) {
            throw "Windows release finalization requires -WindowsInstallerEvidencePath."
        }
        $installerRecord = Read-JsonFile -Path $WindowsInstallerEvidencePath `
            -Label "Windows installer evidence"
        $installer = $installerRecord.Value
        if ($installer.schemaVersion -ne 1 -or
            $installer.kind -ne "windows-installer-package" -or
            $installer.version -ne $version -or
            $installer.runtime -ne "win-x64" -or
            $installer.bridgeArchiveSha256 -ne $actualBridgeHash -or
            $installer.publisherSubject -ne $ExpectedPublisherSubject -or
            [string]::IsNullOrWhiteSpace([string]$installer.signerThumbprint) -or
            [string]::IsNullOrWhiteSpace([string]$installer.signerPublicKeySha256) -or
            $installer.authenticodeValid -ne $true -or
            $installer.rfc3161TimestampPresent -ne $true -or
            $installer.perUserInstall -ne $true) {
            throw "Windows installer evidence does not match this signed Bridge release."
        }
        Assert-AfterBuild -Timestamp $installer.generatedAt `
            -Label "Windows installer evidence" -BuildTime $buildTime
        $installerPackageCandidate = [string]$installer.packagePath
        if (-not [IO.Path]::IsPathRooted($installerPackageCandidate)) {
            $installerPackageCandidate = Join-Path `
                (Split-Path -Parent $installerRecord.Path) $installerPackageCandidate
        }
        $installerPackagePath = (Resolve-Path -LiteralPath $installerPackageCandidate).Path
        if ((Get-FileHash -LiteralPath $installerPackagePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne
                $installer.packageSha256 -or
            (Get-Item -LiteralPath $installerPackagePath).Length -ne
                [long]$installer.packageSizeBytes) {
            throw "The Windows installer no longer matches its evidence."
        }
        $installerSignature = Get-AuthenticodeSignature -LiteralPath $installerPackagePath
        if ($installerSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
            $null -eq $installerSignature.SignerCertificate -or
            $null -eq $installerSignature.TimeStamperCertificate -or
            $installerSignature.SignerCertificate.Subject -ne $ExpectedPublisherSubject -or
            $installerSignature.SignerCertificate.Thumbprint -ne $installer.signerThumbprint -or
            $installerSignature.TimeStamperCertificate.Thumbprint -ne
                $installer.timestampThumbprint) {
            throw "Windows installer Authenticode identity or RFC 3161 timestamp does not match its evidence."
        }
    } else {
        if ([string]::IsNullOrWhiteSpace($MacNotarizationEvidencePath)) {
            throw "macOS release finalization requires -MacNotarizationEvidencePath."
        }
        if ([string]::IsNullOrWhiteSpace($MacInstallerEvidencePath) -or
            [string]::IsNullOrWhiteSpace($ExpectedMacInstallerPublisherSubject)) {
            throw "macOS release finalization requires installer evidence and its expected Developer ID Installer authority."
        }
        $notarizationRecord = Read-JsonFile -Path $MacNotarizationEvidencePath `
            -Label "Apple notarization evidence"
        $notarization = $notarizationRecord.Value
        if ($notarization.schemaVersion -ne 1 -or
            $notarization.kind -ne "apple-notarization" -or
            $notarization.version -ne $version -or
            $notarization.runtime -ne $descriptor.runtime -or
            $notarization.status -ne "Accepted" -or
            $notarization.archiveSha256 -ne $actualBridgeHash -or
            $notarization.authority -ne $ExpectedPublisherSubject -or
            $notarization.hardenedRuntime -ne $true -or
            $notarization.secureTimestamp -ne $true -or
            $notarization.errorCount -ne 0 -or
            [string]::IsNullOrWhiteSpace([string]$notarization.submissionId)) {
            throw "Apple notarization evidence does not match this signed Bridge archive."
        }
        Assert-AfterBuild -Timestamp $notarization.generatedAt `
            -Label "Apple notarization evidence" -BuildTime $buildTime
        $notaryLogCandidate = [string]$notarization.logPath
        if (-not [IO.Path]::IsPathRooted($notaryLogCandidate)) {
            $notaryLogCandidate = Join-Path `
                (Split-Path -Parent $notarizationRecord.Path) $notaryLogCandidate
        }
        $notaryLogPath = (Resolve-Path -LiteralPath $notaryLogCandidate).Path
        if ((Get-FileHash -LiteralPath $notaryLogPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne
            $notarization.logSha256) {
            throw "Apple notarization log no longer matches its evidence."
        }

        $installerRecord = Read-JsonFile -Path $MacInstallerEvidencePath `
            -Label "Apple installer evidence"
        $installer = $installerRecord.Value
        if ($installer.schemaVersion -ne 1 -or
            $installer.kind -ne "apple-installer-package" -or
            $installer.version -ne $version -or
            $installer.runtime -ne $descriptor.runtime -or
            $installer.status -ne "Accepted" -or
            $installer.installerAuthority -ne $ExpectedMacInstallerPublisherSubject -or
            $installer.bridgeArchiveSha256 -ne $actualBridgeHash -or
            $installer.bridgeNotarizationSubmissionId -ne $notarization.submissionId -or
            $installer.errorCount -ne 0 -or
            $installer.ticketStapled -ne $true -or
            $installer.ticketValidated -ne $true -or
            $installer.gatekeeperAssessed -ne $true -or
            [string]::IsNullOrWhiteSpace([string]$installer.submissionId)) {
            throw "Apple installer evidence does not match this signed Bridge release."
        }
        Assert-AfterBuild -Timestamp $installer.generatedAt `
            -Label "Apple installer evidence" -BuildTime $buildTime
        $installerPackageCandidate = [string]$installer.packagePath
        if (-not [IO.Path]::IsPathRooted($installerPackageCandidate)) {
            $installerPackageCandidate = Join-Path `
                (Split-Path -Parent $installerRecord.Path) $installerPackageCandidate
        }
        $installerPackagePath = (Resolve-Path -LiteralPath $installerPackageCandidate).Path
        if ((Get-FileHash -LiteralPath $installerPackagePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne
                $installer.packageSha256 -or
            (Get-Item -LiteralPath $installerPackagePath).Length -ne
                [long]$installer.packageSizeBytes) {
            throw "The macOS installer package no longer matches its evidence."
        }
        $installerLogCandidate = [string]$installer.logPath
        if (-not [IO.Path]::IsPathRooted($installerLogCandidate)) {
            $installerLogCandidate = Join-Path `
                (Split-Path -Parent $installerRecord.Path) $installerLogCandidate
        }
        $installerLogPath = (Resolve-Path -LiteralPath $installerLogCandidate).Path
        if ((Get-FileHash -LiteralPath $installerLogPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne
            $installer.logSha256) {
            throw "Apple installer notarization log no longer matches its evidence."
        }
        $installerSignature = & /usr/sbin/pkgutil --check-signature $installerPackagePath 2>&1
        if ($LASTEXITCODE -ne 0 -or
            -not (($installerSignature -join "`n").Contains(
                $ExpectedMacInstallerPublisherSubject,
                [StringComparison]::Ordinal))) {
            throw "macOS installer signature authority does not match."
        }
        $installerAssessment = & /usr/sbin/spctl --assess --type install `
            --verbose=4 $installerPackagePath 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "macOS installer Gatekeeper assessment failed: $($installerAssessment -join ' ')"
        }
        $binary = $bridgeBinaries[0].FullName
        & /usr/bin/codesign --verify --deep --strict --verbose=2 $binary
        if ($LASTEXITCODE -ne 0) { throw "macOS codesign verification failed." }
        $assessment = & /usr/sbin/spctl --assess --type execute --verbose=2 $binary 2>&1
        if ($LASTEXITCODE -ne 0) { throw "macOS Gatekeeper assessment failed: $($assessment -join ' ')" }
        $signatureDetails = & /usr/bin/codesign -dv --verbose=4 $binary 2>&1
        if (-not (($signatureDetails -join "`n").Contains(
            "Authority=$ExpectedPublisherSubject",
            [StringComparison]::Ordinal))) {
            throw "macOS publisher authority does not match '$ExpectedPublisherSubject'."
        }
    }
}
finally {
    if (Test-Path -LiteralPath $extractRoot) {
        $resolvedExtractRoot = (Resolve-Path -LiteralPath $extractRoot).Path
        $resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar)
        if (-not $resolvedExtractRoot.StartsWith(
                $resolvedTempRoot + [IO.Path]::DirectorySeparatorChar,
                [StringComparison]::OrdinalIgnoreCase) -or
            -not ([IO.Path]::GetFileName($resolvedExtractRoot)).StartsWith(
                "wordollama-finalize-",
                [StringComparison]::Ordinal)) {
            throw "Refusing to remove unexpected release-finalization path: $resolvedExtractRoot"
        }
        Remove-Item -LiteralPath $resolvedExtractRoot -Recurse -Force
    }
}

$httpsRecord = Read-JsonFile -Path $HttpsEvidencePath -Label "HTTPS evidence"
$https = $httpsRecord.Value
if ($https.schemaVersion -ne 1 -or $https.kind -ne "bridge-https" -or
    $https.platform -ne $evidencePlatform -or $https.version -ne $version -or
    $https.trustValidated -ne $true -or $https.secretStoreVerified -ne $true -or
    $https.configurationPasswordEmpty -ne $true -or
    @($https.expectedHosts | Where-Object { $_ -in @("localhost", "127.0.0.1") }).Count -ne 2) {
    throw "HTTPS evidence does not prove trusted localhost TLS and platform-secret storage."
}
Assert-AfterBuild -Timestamp $https.generatedAt -Label "HTTPS evidence" -BuildTime $buildTime
[DateTimeOffset]$certificateExpiry = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse([string]$https.certificateNotAfter, [ref]$certificateExpiry) -or
    $certificateExpiry -le [DateTimeOffset]::UtcNow) {
    throw "HTTPS evidence certificate is expired or has an invalid expiry."
}

$goldenRecord = Read-JsonFile -Path $GoldenReportPath -Label "Golden report"
$golden = $goldenRecord.Value
Assert-ReleaseIdentity -Report $golden -Label "Golden report" -Version $version
Assert-Host -Report $golden -Label "Golden report" -ExpectedPlatform $expectedPlatform
Assert-AfterBuild -Timestamp $golden.startedAt -Label "Golden report" -BuildTime $buildTime
if ($golden.schemaVersion -ne 1 -or $golden.passed -ne 36 -or $golden.failed -ne 0 -or
    $golden.unsupported -ne 0 -or $golden.blocked -ne 0 -or
    @($golden.results).Count -ne 36 -or
    @($golden.results | Where-Object { $_.status -ne "passed" }).Count -ne 0) {
    throw "Golden report does not prove all 36 Word tools passed."
}

$longRecord = Read-JsonFile -Path $LongDocumentReportPath -Label "Long-document report"
$long = $longRecord.Value
Assert-ReleaseIdentity -Report $long -Label "Long-document report" -Version $version
Assert-Host -Report $long -Label "Long-document report" -ExpectedPlatform $expectedPlatform
Assert-AfterBuild -Timestamp $long.startedAt -Label "Long-document report" -BuildTime $buildTime
$longCases = @($long.cases)
if ($long.schemaVersion -ne 1 -or $longCases.Count -ne 2 -or
    @($longCases.paragraphCount | Sort-Object) -join "," -ne "1000,5000" -or
    @($longCases | Where-Object { $_.status -ne "passed" -or @($_.errors).Count -ne 0 }).Count -ne 0) {
    throw "Long-document report does not prove passing 1,000/5,000 paragraph cases."
}

$revisionRecord = Read-JsonFile -Path $RevisionReportPath -Label "Revision report"
$revision = $revisionRecord.Value
Assert-ReleaseIdentity -Report $revision -Label "Revision report" -Version $version
Assert-Host -Report $revision -Label "Revision report" -ExpectedPlatform $expectedPlatform
Assert-AfterBuild -Timestamp $revision.startedAt -Label "Revision report" -BuildTime $buildTime
if ($revision.schemaVersion -ne 1 -or $revision.status -ne "passed" -or
    $revision.capabilities.wordApi14ChangeTracking -ne $true -or
    $revision.capabilities.wordApiDesktop14Revisions -ne $true -or
    $revision.focusVerified -ne $true -or $revision.acceptedMarkerRetained -ne $true -or
    $revision.rejectedMarkerRemoved -ne $true -or $revision.batchMarkerRetained -ne $true -or
    @($revision.errors).Count -ne 0) {
    throw "Revision report does not prove the complete Word revision workflow."
}

$supplementalRecord = Read-JsonFile -Path $SupplementalHostReportPath -Label "Supplemental host report"
$supplemental = $supplementalRecord.Value
$supplementalValidator = Join-Path $PSScriptRoot "validate-word-host-supplemental.ps1"
& $supplementalValidator -ReportPath $supplementalRecord.Path -ExpectedVersion $version `
    -ExpectedPlatform $expectedPlatform -BuildTime $buildTime

$evidenceRecords = @(
    @{ kind = "bridge-https"; record = $httpsRecord },
    @{ kind = "word-tools"; record = $goldenRecord },
    @{ kind = "long-document"; record = $longRecord },
    @{ kind = "word-revisions"; record = $revisionRecord },
    @{ kind = "host-supplemental"; record = $supplementalRecord }
)
if ($descriptor.runtime -like "osx-*") {
    $evidenceRecords += @{
        kind = "apple-notarization"
        record = $notarizationRecord
    }
    $evidenceRecords += @{
        kind = "apple-installer-package"
        record = $installerRecord
    }
}
else {
    $evidenceRecords += @{
        kind = "windows-installer-package"
        record = $installerRecord
    }
}
$finalArtifacts = @(
    [ordered]@{
        kind = "office-addin"
        path = $addinArchive
        sha256 = (Get-FileHash -LiteralPath $addinArchive -Algorithm SHA256).Hash.ToLowerInvariant()
        sizeBytes = (Get-Item -LiteralPath $addinArchive).Length
    },
    [ordered]@{
        kind = "desktop-bridge"
        path = $bridgeArchive
        sha256 = (Get-FileHash -LiteralPath $bridgeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
        sizeBytes = (Get-Item -LiteralPath $bridgeArchive).Length
    }
)
if ($descriptor.runtime -like "osx-*") {
    $finalArtifacts += [ordered]@{
        kind = "desktop-bridge-installer"
        path = $installerPackagePath
        sha256 = (Get-FileHash -LiteralPath $installerPackagePath -Algorithm SHA256).Hash.ToLowerInvariant()
        sizeBytes = (Get-Item -LiteralPath $installerPackagePath).Length
    }
}
else {
    $finalArtifacts += [ordered]@{
        kind = "desktop-bridge-installer"
        path = $installerPackagePath
        sha256 = (Get-FileHash -LiteralPath $installerPackagePath -Algorithm SHA256).Hash.ToLowerInvariant()
        sizeBytes = (Get-Item -LiteralPath $installerPackagePath).Length
    }
}
$finalEvidence = @($evidenceRecords | ForEach-Object {
    [ordered]@{
        kind = $_.kind
        path = $_.record.Path
        sha256 = (Get-FileHash -LiteralPath $_.record.Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})
$finalDescriptor = [ordered]@{
    schemaVersion = 1
    product = "WordOllama.JS"
    version = $version
    manifestVersion = $descriptor.manifestVersion
    runtime = $descriptor.runtime
    addinOrigin = $descriptor.addinOrigin
    bridgeOrigin = $descriptor.bridgeOrigin
    updateIndexUrl = $descriptor.updateIndexUrl
    generatedAt = $descriptor.generatedAt
    finalizedAt = [DateTimeOffset]::UtcNow.ToString("O")
    releaseReady = $true
    publisherSubject = $ExpectedPublisherSubject
    installerPublisherSubject = if ($descriptor.runtime -like "osx-*") {
        $ExpectedMacInstallerPublisherSubject
    } else { $ExpectedPublisherSubject }
    installerSignerThumbprint = if ($descriptor.runtime -eq "win-x64") {
        [string]$installer.signerThumbprint
    } else { "macos-authority-pinned" }
    installerSignerPublicKeySha256 = if ($descriptor.runtime -eq "win-x64") {
        [string]$installer.signerPublicKeySha256
    } else { "macos-authority-pinned" }
    sourceDescriptorSha256 = (Get-FileHash -LiteralPath $descriptorRecord.Path -Algorithm SHA256).Hash.ToLowerInvariant()
    sourceArtifacts = @(
        [ordered]@{
            kind = "office-addin"
            path = $addinArchive
            sha256 = $sourceAddinHash
            sizeBytes = $sourceAddinSize
        },
        [ordered]@{
            kind = "desktop-bridge"
            path = $bridgeArchive
            sha256 = $sourceBridgeHash
            sizeBytes = $sourceBridgeSize
        }
    )
    signingTransition = [ordered]@{
        bridgeArchiveChanged = $sourceBridgeHash -ne $actualBridgeHash -or
            $sourceBridgeSize -ne $actualBridgeSize
        sourceSha256 = $sourceBridgeHash
        sourceSizeBytes = $sourceBridgeSize
        signedSha256 = $actualBridgeHash
        signedSizeBytes = $actualBridgeSize
    }
    artifacts = $finalArtifacts
    evidence = $finalEvidence
    sourceDescriptor = $descriptorRecord.Path
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path (Split-Path -Parent $descriptorRecord.Path) `
        "unified-release-$version-$($descriptor.runtime).json"
}
$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $outputFullPath
if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}
$outputTemp = "$outputFullPath.$([Guid]::NewGuid().ToString('N')).tmp"
$finalDescriptor | ConvertTo-Json -Depth 10 |
    Set-Content -LiteralPath $outputTemp -Encoding utf8
Move-Item -LiteralPath $outputTemp -Destination $outputFullPath -Force
Write-Host "Created verified release descriptor $outputFullPath"
