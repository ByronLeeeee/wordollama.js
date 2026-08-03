[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PreviousPackagePath,
    [Parameter(Mandatory = $true)][string]$CandidateInstallerEvidencePath,
    [Parameter(Mandatory = $true)][string]$BuildDescriptorPath,
    [Parameter(Mandatory = $true)][string]$ExpectedInstallerIdentity,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [switch]$AllowCurrentUserInstallAndCertificateChanges
)

$ErrorActionPreference = "Stop"
$root = Join-Path $HOME "Library/Application Support/WordOllama.JS/DesktopBridge"
$applicationRoot = Join-Path $HOME "Applications/WordOllama.JS"
$launchAgent = Join-Path $HOME "Library/LaunchAgents/com.wordollama.desktopbridge.plist"
$manifest = Join-Path $HOME "Library/Containers/com.microsoft.Word/Data/Documents/wef/WordOllama.JS.xml"
$keychain = Join-Path $HOME "Library/Keychains/login.keychain-db"

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-Json([string]$Path, [string]$Label) {
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    try { return Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json }
    catch { throw "$Label is not valid JSON: $resolved" }
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments, [string]$Failure) {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Failure (exit $LASTEXITCODE)." }
}

function Assert-PackageIdentity([string]$Path) {
    $text = (& /usr/sbin/pkgutil --check-signature $Path 2>&1) -join "`n"
    Assert-True ($LASTEXITCODE -eq 0) "Package signature verification failed: $Path"
    Assert-True ($text.Contains($ExpectedInstallerIdentity, [StringComparison]::Ordinal)) "Package signer does not match the pinned identity: $Path"
    return $text
}

function Get-InstalledSnapshot {
    $pointerPath = Join-Path $root "current-version"
    $statePath = Join-Path $root "current.json"
    $ownershipPath = Join-Path $root "certs/ownership.json"
    foreach ($required in @($pointerPath, $statePath, $ownershipPath, $launchAgent, $manifest)) {
        Assert-True (Test-Path -LiteralPath $required -PathType Leaf) "Installed file is missing: $required"
    }
    $pointer = (Get-Content -LiteralPath $pointerPath -Raw).Trim()
    $state = Get-Json $statePath "Install state"
    $ownership = Get-Json $ownershipPath "Certificate ownership"
    Assert-True ($pointer -eq [string]$state.currentVersion) "current-version and current.json disagree."
    Assert-True ([string]$ownership.subject -eq "CN=李伯阳/Boyang Li") "Certificate ownership subject is invalid."
    Assert-True ((@($ownership.hosts) -join "|") -eq "localhost|127.0.0.1|::1") "Certificate ownership SAN list is invalid."
    $certificateText = (& /usr/bin/security find-certificate -Z -c "李伯阳/Boyang Li" $keychain 2>&1) -join "`n"
    Assert-True ($LASTEXITCODE -eq 0 -and $certificateText -match [Regex]::Escape([string]$ownership.thumbprint)) "Owned localhost certificate is absent from the login keychain."
    $versionRoot = Join-Path $root ("versions/" + $pointer)
    $bridge = Join-Path $versionRoot "WordOllama.DesktopBridge"
    Assert-True (Test-Path -LiteralPath $bridge -PathType Leaf) "Installed Bridge executable is missing."
    Invoke-Native $bridge @("https-certificate-secret", "verify") "HTTPS certificate secret is missing from Keychain"
    Invoke-Native /usr/bin/curl @("--fail", "--silent", "--show-error", "--max-time", "15", "https://localhost:37421/health") "Bridge health check failed"
    Invoke-Native /usr/bin/curl @("--fail", "--silent", "--show-error", "--max-time", "15", "https://localhost:37421/index.html") "Frontend health check failed"
    [ordered]@{
        version = $pointer
        previousVersion = [string]$state.previousVersion
        installer = [string]$state.installer
        certificateThumbprint = [string]$ownership.thumbprint
        launchAgentLoaded = $true
        health = "ok"
    }
}

if (-not $IsMacOS) { throw "macOS release lifecycle evidence must be recorded on macOS." }
if ((& /usr/bin/uname -m).Trim() -ne "arm64") { throw "Only Apple Silicon arm64 is supported." }
if (-not $AllowCurrentUserInstallAndCertificateChanges) {
    throw "This command installs/uninstalls the product and changes login-keychain localhost trust. Re-run with -AllowCurrentUserInstallAndCertificateChanges after reviewing the target account."
}
if (Get-Process "Microsoft Word" -ErrorAction SilentlyContinue) { throw "Close Microsoft Word before recording lifecycle evidence." }
$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $outputFullPath) { throw "OutputPath already exists; refusing to overwrite evidence." }
foreach ($existing in @($root, $applicationRoot, $launchAgent, $manifest)) {
    if (Test-Path -LiteralPath $existing) { throw "A WordOllama.JS installation already exists: $existing" }
}

$descriptorPath = (Resolve-Path -LiteralPath $BuildDescriptorPath).Path
$evidencePath = (Resolve-Path -LiteralPath $CandidateInstallerEvidencePath).Path
$descriptor = Get-Json $descriptorPath "Build descriptor"
$installerEvidence = Get-Json $evidencePath "Candidate installer evidence"
Assert-True ($descriptor.schemaVersion -eq 1 -and $descriptor.runtime -eq "osx-arm64" -and $descriptor.releaseReady -eq $false) "Build descriptor is not an unsigned osx-arm64 release descriptor."
Assert-True ($installerEvidence.kind -eq "apple-local-installer-package" -and $installerEvidence.version -eq $descriptor.version -and $installerEvidence.notarized -eq $false -and $installerEvidence.explicitUserTrustRequired -eq $true) "Candidate installer evidence does not describe the expected local-self-signed build."
Assert-True ([string]$installerEvidence.installerAuthority -eq $ExpectedInstallerIdentity) "Candidate installer evidence does not pin the requested installer identity."
$candidatePackage = [string]$installerEvidence.packagePath
if (-not [IO.Path]::IsPathRooted($candidatePackage)) { $candidatePackage = Join-Path (Split-Path -Parent $evidencePath) $candidatePackage }
$candidatePackage = (Resolve-Path -LiteralPath $candidatePackage).Path
$previousPackage = (Resolve-Path -LiteralPath $PreviousPackagePath).Path
Assert-True ((Get-FileHash -LiteralPath $candidatePackage -Algorithm SHA256).Hash.ToLowerInvariant() -eq [string]$installerEvidence.packageSha256) "Candidate package hash does not match its evidence."
$previousSignature = Assert-PackageIdentity $previousPackage
$candidateSignature = Assert-PackageIdentity $candidatePackage

$startedAt = [DateTimeOffset]::UtcNow
$observations = [ordered]@{}
try {
    Invoke-Native /usr/sbin/installer @("-pkg", $previousPackage, "-target", "CurrentUserHomeDirectory") "Previous package installation failed"
    $setup = Join-Path $applicationRoot "Complete WordOllama.JS Setup.command"
    Assert-True (Test-Path -LiteralPath $setup -PathType Leaf) "Complete Setup command is missing."
    "y" | & $setup
    Assert-True ($LASTEXITCODE -eq 0) "Complete Setup failed."
    $observations.initialInstall = Get-InstalledSnapshot
    Assert-True ($observations.initialInstall.version -ne [string]$descriptor.version) "Previous package must contain a version distinct from the candidate."

    Invoke-Native /usr/sbin/installer @("-pkg", $candidatePackage, "-target", "CurrentUserHomeDirectory") "Candidate package installation failed"
    $observations.upgrade = Get-InstalledSnapshot
    Assert-True ($observations.upgrade.version -eq [string]$descriptor.version) "Upgrade did not activate the candidate version."
    Assert-True ($observations.upgrade.previousVersion -eq $observations.initialInstall.version) "Upgrade did not retain the previous version."

    $rollback = Join-Path $applicationRoot "Rollback WordOllama.JS Desktop Bridge.command"
    Invoke-Native $rollback @() "Rollback command failed"
    $observations.rollback = Get-InstalledSnapshot
    Assert-True ($observations.rollback.version -eq $observations.initialInstall.version) "Rollback did not reactivate the previous version."

    $sandboxProject = Join-Path (Split-Path -Parent $PSScriptRoot) "tools/agent-sandbox-smoke/WordOllama.AgentSandboxSmoke.csproj"
    Invoke-Native dotnet @("run", "--project", $sandboxProject, "-c", "Release") "macOS agent sandbox regression failed"
    $observations.agentSandbox = [ordered]@{ architecture = "arm64"; sandboxExec = "passed"; shells = @("bash", "zsh") }

    $finalCertificateThumbprint = [string]$observations.rollback.certificateThumbprint
    $uninstaller = Join-Path $applicationRoot "Uninstall WordOllama.JS Desktop Bridge.command"
    Invoke-Native $uninstaller @("--yes") "Uninstall command failed"
    Assert-True (-not (Test-Path -LiteralPath $root)) "Uninstall did not remove the install root."
    Assert-True (-not (Test-Path -LiteralPath $launchAgent)) "Uninstall did not remove the LaunchAgent."
    Assert-True (-not (Test-Path -LiteralPath $manifest)) "Uninstall did not remove the Office manifest."
    $certificateAfter = (& /usr/bin/security find-certificate -Z -c "WordOllama.JS localhost" $keychain 2>&1) -join "`n"
    Assert-True (-not $certificateAfter.Contains($finalCertificateThumbprint, [StringComparison]::OrdinalIgnoreCase)) "Uninstall did not remove the owned localhost certificate."
    & /usr/bin/security find-generic-password -s "WordOllama.JS/WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD" -a (& /usr/bin/id -un) $keychain 2>$null | Out-Null
    Assert-True ($LASTEXITCODE -ne 0) "Uninstall did not remove the HTTPS certificate Keychain item."
    $observations.uninstall = [ordered]@{ installRootRemoved = $true; launchAgentRemoved = $true; manifestRemoved = $true; certificateRemoved = $true; credentialRemoved = $true }

    $report = [ordered]@{
        schemaVersion = 1
        kind = "platform-release-lifecycle"
        runtime = "osx-arm64"
        version = [string]$descriptor.version
        status = "passed"
        startedAt = $startedAt.ToString("O")
        finishedAt = [DateTimeOffset]::UtcNow.ToString("O")
        sourceBuild = [ordered]@{
            descriptorSha256 = (Get-FileHash -LiteralPath $descriptorPath -Algorithm SHA256).Hash.ToLowerInvariant()
            candidateInstallerSha256 = [string]$installerEvidence.packageSha256
            previousInstallerSha256 = (Get-FileHash -LiteralPath $previousPackage -Algorithm SHA256).Hash.ToLowerInvariant()
            installerIdentity = $ExpectedInstallerIdentity
        }
        observations = $observations
        errors = @()
    }
    $directory = Split-Path -Parent $outputFullPath
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $temporary = "$outputFullPath.$([Guid]::NewGuid().ToString('N')).tmp"
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $outputFullPath
    Write-Host "Recorded macOS arm64 release lifecycle evidence: $outputFullPath"
}
finally {
    $uninstaller = Join-Path $applicationRoot "Uninstall WordOllama.JS Desktop Bridge.command"
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) { & $uninstaller --yes | Out-Null }
}
