[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PreviousInstallerPath,
    [Parameter(Mandatory = $true)][string]$CandidateInstallerEvidencePath,
    [Parameter(Mandatory = $true)][string]$BuildDescriptorPath,
    [Parameter(Mandatory = $true)][string]$ExpectedPublisherSubject,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [switch]$AllowCurrentUserInstallAndCertificateChanges
)

$ErrorActionPreference = "Stop"
$productId = "4d2a7c5e-2d2a-4a1a-8b72-6a1cf4f7b701"
$installRoot = Join-Path $env:LOCALAPPDATA "WordOllama.JS\DesktopBridge"
$startupPath = Join-Path ([Environment]::GetFolderPath("Startup")) `
    "WordOllama.JS Desktop Bridge.vbs"
$uninstallRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WordOllama.JS"
$wefRegistryPath = "HKCU:\Software\Microsoft\Office\16.0\Wef\Developer"

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-Json([string]$Path, [string]$Label) {
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    try { return Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json }
    catch { throw "$Label is not valid JSON: $resolved" }
}

function Get-ProductCertificate([string]$Thumbprint) {
    @(Get-ChildItem -LiteralPath Cert:\CurrentUser\Root |
        Where-Object {
            $_.Thumbprint -eq $Thumbprint -and
            $_.Subject -eq "CN=李伯阳/Boyang Li"
        }) | Select-Object -First 1
}

function Test-HttpsCredential {
    $listing = (& "$env:SystemRoot\System32\cmdkey.exe" /list 2>&1) -join "`n"
    $listing -match [Regex]::Escape("WordOllama.JS/WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD")
}

function Get-InstalledSnapshot {
    $statePath = Join-Path $installRoot "current.json"
    $pointerPath = Join-Path $installRoot "current-version"
    $ownershipPath = Join-Path $installRoot "certs\ownership.json"
    foreach ($required in @($statePath, $pointerPath, $ownershipPath, $startupPath)) {
        Assert-True (Test-Path -LiteralPath $required -PathType Leaf) "Installed file is missing: $required"
    }
    $state = Get-Json $statePath "Install state"
    $ownership = Get-Json $ownershipPath "Certificate ownership"
    $pointer = (Get-Content -LiteralPath $pointerPath -Raw).Trim()
    Assert-True ($pointer -eq [string]$state.currentVersion) "current-version and current.json disagree."
    Assert-True ([string]$ownership.subject -eq "CN=李伯阳/Boyang Li") "Certificate ownership subject is invalid."
    Assert-True ((@($ownership.hosts) -join "|") -eq "localhost|127.0.0.1|::1") "Certificate ownership SAN list is invalid."
    $certificate = Get-ProductCertificate ([string]$ownership.thumbprint)
    Assert-True ($null -ne $certificate) "Owned localhost certificate is not trusted in CurrentUser Root."
    $basic = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.19" } | Select-Object -First 1)
    Assert-True ($basic.Count -eq 1 -and -not $basic[0].CertificateAuthority) "Owned localhost certificate must be a non-CA leaf."
    $eku = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.37" } | Select-Object -First 1)
    Assert-True ($eku.Count -eq 1 -and $null -ne $eku[0].EnhancedKeyUsages["1.3.6.1.5.5.7.3.1"]) "Owned certificate lacks Server Authentication EKU."
    $versionRoot = Join-Path $installRoot ("versions\" + $pointer)
    $bridge = Join-Path $versionRoot "WordOllama.DesktopBridge.exe"
    foreach ($required in @($bridge, (Join-Path $versionRoot "appsettings.json"), (Join-Path $versionRoot "WordOllama.JS.xml"))) {
        Assert-True (Test-Path -LiteralPath $required -PathType Leaf) "Installed version is incomplete: $required"
    }
    $registeredManifest = (Get-ItemProperty -LiteralPath $wefRegistryPath -Name $productId -ErrorAction Stop).$productId
    Assert-True ([IO.Path]::GetFullPath($registeredManifest).StartsWith($installRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) "Office WEF registration is not owned by this installation."
    $uninstall = Get-ItemProperty -LiteralPath $uninstallRegistryPath -ErrorAction Stop
    Assert-True ([string]$uninstall.DisplayVersion -eq $pointer) "Uninstall registry version does not match current-version."
    & $bridge https-certificate-secret verify | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "HTTPS certificate secret is missing from Windows Credential Manager."
    Assert-True (Test-HttpsCredential) "HTTPS certificate credential target is missing from Windows Credential Manager."
    $health = Invoke-RestMethod -Uri "https://localhost:37421/health" -TimeoutSec 15
    Assert-True ($health.ready -eq $true) "Installed Bridge health check failed."
    $index = Invoke-WebRequest -UseBasicParsing -Uri "https://localhost:37421/index.html" -TimeoutSec 15
    Assert-True ($index.StatusCode -eq 200 -and $index.Content -match "WordOllama") "Installed frontend check failed."
    [ordered]@{
        version = $pointer
        previousVersion = [string]$state.previousVersion
        installer = [string]$state.installer
        certificateThumbprint = [string]$ownership.thumbprint
        certificateNotAfter = $certificate.NotAfter.ToUniversalTime().ToString("O")
        manifestPath = [IO.Path]::GetFullPath([string]$registeredManifest)
        health = "ok"
    }
}

function Invoke-Setup([string]$Path, [string[]]$Arguments) {
    # `Start-Process -Wait` follows the detached Bridge process tree, while
    # direct PowerShell invocation returns immediately for this GUI executable.
    # Waiting on the Process object itself tracks setup only.
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru
    $process.WaitForExit()
    $exitCode = $process.ExitCode
    Assert-True ($exitCode -eq 0) "Setup failed with exit code ${exitCode}: $Path $($Arguments -join ' ')"
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-Path -LiteralPath (Join-Path $installRoot "current.json")) { return }
        Start-Sleep -Milliseconds 250
    }
}

if (-not $IsWindows) { throw "Windows release lifecycle evidence must be recorded on Windows." }
if (-not $AllowCurrentUserInstallAndCertificateChanges) {
    throw "This command installs/uninstalls the product and changes CurrentUser localhost certificate trust. Re-run with -AllowCurrentUserInstallAndCertificateChanges after reviewing the target account."
}
if (Get-Process WINWORD -ErrorAction SilentlyContinue) {
    throw "Close every WINWORD process before recording installation lifecycle evidence."
}
$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $outputFullPath) { throw "OutputPath already exists; refusing to overwrite evidence." }
foreach ($existing in @($installRoot, $startupPath, $uninstallRegistryPath)) {
    if (Test-Path -LiteralPath $existing) { throw "A WordOllama.JS installation already exists: $existing" }
}
if (Test-Path -LiteralPath $wefRegistryPath) {
    $existingManifest = (Get-ItemProperty -LiteralPath $wefRegistryPath -Name $productId -ErrorAction SilentlyContinue).$productId
    if (-not [string]::IsNullOrWhiteSpace([string]$existingManifest)) { throw "The WordOllama.JS Office registration already exists." }
}
if (@(Get-ChildItem Cert:\CurrentUser\Root | Where-Object Subject -in @("CN=李伯阳/Boyang Li", "CN=WordOllama.JS localhost")).Count -ne 0) {
    throw "A WordOllama.JS localhost certificate already exists; use a clean current-user account."
}

$descriptor = Get-Json $BuildDescriptorPath "Build descriptor"
$installerEvidence = Get-Json $CandidateInstallerEvidencePath "Candidate installer evidence"
Assert-True ($descriptor.schemaVersion -eq 1 -and $descriptor.runtime -eq "win-x64" -and $descriptor.releaseReady -eq $false) "Build descriptor is not an unsigned win-x64 release descriptor."
Assert-True ($installerEvidence.kind -eq "windows-installer-package" -and $installerEvidence.version -eq $descriptor.version) "Candidate installer evidence does not match the build descriptor."
$candidateInstallerPath = [string]$installerEvidence.packagePath
if (-not [IO.Path]::IsPathRooted($candidateInstallerPath)) {
    $candidateInstallerPath = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $CandidateInstallerEvidencePath).Path) $candidateInstallerPath
}
$candidateInstallerPath = (Resolve-Path -LiteralPath $candidateInstallerPath).Path
$previousInstallerPath = (Resolve-Path -LiteralPath $PreviousInstallerPath).Path
Assert-True ((Get-FileHash -LiteralPath $candidateInstallerPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq [string]$installerEvidence.packageSha256) "Candidate installer hash does not match its evidence."
foreach ($installerPath in @($previousInstallerPath, $candidateInstallerPath)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
    Assert-True ($signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid) "Installer Authenticode signature is not trusted and valid: $installerPath"
    Assert-True ($signature.SignerCertificate.Subject -eq $ExpectedPublisherSubject) "Installer publisher does not match the pinned subject: $installerPath"
}

$startedAt = [DateTimeOffset]::UtcNow
$observations = [ordered]@{}
try {
    Invoke-Setup $previousInstallerPath @("--quiet", "--trust-localhost-certificate")
    $observations.initialInstall = Get-InstalledSnapshot
    Assert-True ($observations.initialInstall.version -ne [string]$descriptor.version) "Previous installer must contain a version distinct from the candidate."

    Invoke-Setup $candidateInstallerPath @("--quiet", "--trust-localhost-certificate")
    $observations.upgrade = Get-InstalledSnapshot
    Assert-True ($observations.upgrade.version -eq [string]$descriptor.version) "Upgrade did not activate the candidate version."
    Assert-True ($observations.upgrade.previousVersion -eq $observations.initialInstall.version) "Upgrade did not retain the previous version."
    Assert-True ($observations.upgrade.certificateThumbprint -eq $observations.initialInstall.certificateThumbprint) "Normal upgrade unexpectedly rotated the localhost certificate."

    Invoke-Setup $candidateInstallerPath @("--quiet", "--trust-localhost-certificate", "--rotate-localhost-certificate")
    $observations.certificateRotation = Get-InstalledSnapshot
    Assert-True ($observations.certificateRotation.certificateThumbprint -ne $observations.upgrade.certificateThumbprint) "Explicit maintenance did not rotate the localhost certificate."
    Assert-True ($null -eq (Get-ProductCertificate $observations.upgrade.certificateThumbprint)) "Explicit maintenance left the old localhost certificate trusted."

    $uninstaller = Join-Path $installRoot "WordOllama.JS-Uninstall.exe"
    Invoke-Setup $uninstaller @("--rollback", "--quiet")
    $observations.rollback = Get-InstalledSnapshot
    Assert-True ($observations.rollback.version -eq $observations.initialInstall.version) "Rollback did not reactivate the previous version."
    Assert-True ($observations.rollback.previousVersion -eq [string]$descriptor.version) "Rollback state does not retain the candidate as previous."

    Invoke-Setup $candidateInstallerPath @("--quiet", "--trust-localhost-certificate")
    $observations.reinstall = Get-InstalledSnapshot
    $finalCertificateThumbprint = $observations.reinstall.certificateThumbprint
    $uninstaller = Join-Path $installRoot "WordOllama.JS-Uninstall.exe"
    $process = Start-Process -FilePath $uninstaller `
        -ArgumentList @("--uninstall", "--quiet") -PassThru
    $process.WaitForExit()
    $uninstallExitCode = $process.ExitCode
    Assert-True ($uninstallExitCode -eq 0) "Uninstall failed with exit code $uninstallExitCode."
    for ($attempt = 0; $attempt -lt 60 -and (Test-Path -LiteralPath $installRoot); $attempt++) { Start-Sleep -Milliseconds 250 }
    Assert-True (-not (Test-Path -LiteralPath $installRoot)) "Uninstall did not remove the install root."
    Assert-True (-not (Test-Path -LiteralPath $startupPath)) "Uninstall did not remove Startup registration."
    Assert-True (-not (Test-Path -LiteralPath $uninstallRegistryPath)) "Uninstall did not remove Apps & Features registration."
    Assert-True ($null -eq (Get-ProductCertificate $finalCertificateThumbprint)) "Uninstall did not remove the owned localhost certificate."
    Assert-True (-not (Test-HttpsCredential)) "Uninstall did not remove the HTTPS certificate credential."
    $manifestAfter = (Get-ItemProperty -LiteralPath $wefRegistryPath -Name $productId -ErrorAction SilentlyContinue).$productId
    Assert-True ([string]::IsNullOrWhiteSpace([string]$manifestAfter)) "Uninstall did not remove Office WEF registration."
    $observations.uninstall = [ordered]@{ installRootRemoved = $true; startupRemoved = $true; registrationRemoved = $true; certificateRemoved = $true; credentialRemoved = $true }

    $report = [ordered]@{
        schemaVersion = 1
        kind = "platform-release-lifecycle"
        runtime = "win-x64"
        version = [string]$descriptor.version
        status = "passed"
        startedAt = $startedAt.ToString("O")
        finishedAt = [DateTimeOffset]::UtcNow.ToString("O")
        sourceBuild = [ordered]@{
            descriptorSha256 = (Get-FileHash -LiteralPath (Resolve-Path -LiteralPath $BuildDescriptorPath).Path -Algorithm SHA256).Hash.ToLowerInvariant()
            candidateInstallerSha256 = [string]$installerEvidence.packageSha256
            previousInstallerSha256 = (Get-FileHash -LiteralPath $previousInstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
            publisherSubject = $ExpectedPublisherSubject
        }
        observations = $observations
        errors = @()
    }
    $directory = Split-Path -Parent $outputFullPath
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $temporary = "$outputFullPath.$([Guid]::NewGuid().ToString('N')).tmp"
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $outputFullPath
    Write-Host "Recorded Windows release lifecycle evidence: $outputFullPath"
}
finally {
    if (Test-Path -LiteralPath (Join-Path $installRoot "WordOllama.JS-Uninstall.exe")) {
        & (Join-Path $installRoot "WordOllama.JS-Uninstall.exe") --uninstall --quiet | Out-Null
    }
}
