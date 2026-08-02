[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ReportPath,
    [Parameter(Mandatory = $true)][string]$BuildDescriptorPath,
    [Parameter(Mandatory = $true)][string]$CandidateInstallerSha256,
    [string]$ExpectedWindowsPublisherSubject = "",
    [string]$ExpectedMacInstallerIdentity = ""
)

$ErrorActionPreference = "Stop"
$reportPathResolved = (Resolve-Path -LiteralPath $ReportPath).Path
$descriptorPathResolved = (Resolve-Path -LiteralPath $BuildDescriptorPath).Path
try {
    $report = Get-Content -LiteralPath $reportPathResolved -Raw | ConvertFrom-Json
    $descriptor = Get-Content -LiteralPath $descriptorPathResolved -Raw | ConvertFrom-Json
}
catch { throw "Platform lifecycle report or build descriptor is not valid JSON." }

if ($descriptor.schemaVersion -ne 1 -or
    $descriptor.product -ne "WordOllama.JS" -or
    $descriptor.releaseReady -ne $false -or
    $descriptor.runtime -notin @("win-x64", "osx-arm64") -or
    [string]::IsNullOrWhiteSpace([string]$descriptor.version)) {
    throw "Build descriptor is not an unsigned supported WordOllama.JS release descriptor."
}
[DateTimeOffset]$buildTime = [DateTimeOffset]::MinValue
[DateTimeOffset]$startedAt = [DateTimeOffset]::MinValue
[DateTimeOffset]$finishedAt = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse([string]$descriptor.generatedAt, [ref]$buildTime) -or
    -not [DateTimeOffset]::TryParse([string]$report.startedAt, [ref]$startedAt) -or
    -not [DateTimeOffset]::TryParse([string]$report.finishedAt, [ref]$finishedAt) -or
    $startedAt -lt $buildTime -or $finishedAt -lt $startedAt) {
    throw "Platform lifecycle timestamps are invalid or predate the packaged build."
}
$descriptorHash = (Get-FileHash -LiteralPath $descriptorPathResolved -Algorithm SHA256).Hash.ToLowerInvariant()
if ($report.schemaVersion -ne 1 -or
    $report.kind -ne "platform-release-lifecycle" -or
    $report.runtime -ne $descriptor.runtime -or
    $report.version -ne $descriptor.version -or
    $report.status -ne "passed" -or
    @($report.errors).Count -ne 0 -or
    [string]$report.sourceBuild.descriptorSha256 -ne $descriptorHash -or
    [string]$report.sourceBuild.candidateInstallerSha256 -ne $CandidateInstallerSha256 -or
    [string]$report.sourceBuild.previousInstallerSha256 -notmatch "^[0-9a-f]{64}$") {
    throw "Platform lifecycle evidence does not match this build and installer."
}

if ($descriptor.runtime -eq "win-x64") {
    if ([string]::IsNullOrWhiteSpace($ExpectedWindowsPublisherSubject) -or
        $report.sourceBuild.publisherSubject -ne $ExpectedWindowsPublisherSubject -or
        $report.observations.initialInstall.version -eq $descriptor.version -or
        $report.observations.upgrade.version -ne $descriptor.version -or
        $report.observations.upgrade.previousVersion -ne $report.observations.initialInstall.version -or
        $report.observations.rollback.version -ne $report.observations.initialInstall.version -or
        $report.observations.upgrade.certificateThumbprint -ne $report.observations.initialInstall.certificateThumbprint -or
        $report.observations.certificateRotation.certificateThumbprint -eq $report.observations.upgrade.certificateThumbprint -or
        $report.observations.uninstall.installRootRemoved -ne $true -or
        $report.observations.uninstall.startupRemoved -ne $true -or
        $report.observations.uninstall.registrationRemoved -ne $true -or
        $report.observations.uninstall.certificateRemoved -ne $true -or
        $report.observations.uninstall.credentialRemoved -ne $true) {
        throw "Windows lifecycle evidence does not prove install, certificate-preserving upgrade, explicit rotation, rollback, and uninstall."
    }
}
else {
    if ([string]::IsNullOrWhiteSpace($ExpectedMacInstallerIdentity) -or
        $report.sourceBuild.installerIdentity -ne $ExpectedMacInstallerIdentity -or
        $report.observations.initialInstall.version -eq $descriptor.version -or
        $report.observations.upgrade.version -ne $descriptor.version -or
        $report.observations.upgrade.previousVersion -ne $report.observations.initialInstall.version -or
        $report.observations.rollback.version -ne $report.observations.initialInstall.version -or
        $report.observations.agentSandbox.architecture -ne "arm64" -or
        $report.observations.agentSandbox.sandboxExec -ne "passed" -or
        (@($report.observations.agentSandbox.shells | Sort-Object) -join ",") -ne "bash,zsh" -or
        $report.observations.uninstall.installRootRemoved -ne $true -or
        $report.observations.uninstall.launchAgentRemoved -ne $true -or
        $report.observations.uninstall.manifestRemoved -ne $true -or
        $report.observations.uninstall.certificateRemoved -ne $true -or
        $report.observations.uninstall.credentialRemoved -ne $true) {
        throw "macOS lifecycle evidence does not prove arm64 install, trust, rollback, sandbox, and uninstall."
    }
}

Write-Host "Validated platform release lifecycle evidence: $reportPathResolved"
