[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$validator = Join-Path $repoRoot "packaging/validate-platform-release-lifecycle.ps1"
$windowsCollector = Join-Path $repoRoot "tools/record-windows-release-lifecycle.ps1"
$macCollector = Join-Path $repoRoot "tools/record-macos-release-lifecycle.ps1"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) `
    ("wordollama-lifecycle-smoke-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null

function Write-Json([string]$Path, $Value) {
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Assert-Rejected([scriptblock]$Action, [string]$Label) {
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    if (-not $rejected) { throw "Lifecycle smoke accepted $Label." }
}

try {
    foreach ($collector in @($windowsCollector, $macCollector)) {
        $source = Get-Content -LiteralPath $collector -Raw
        if ($source -notmatch "AllowCurrentUserInstallAndCertificateChanges" -or
            $source -notmatch "OutputPath already exists" -or
            $source -notmatch "platform-release-lifecycle") {
            throw "Lifecycle collector lacks explicit mutation authorization or immutable evidence output: $collector"
        }
    }

    foreach ($runtime in @("win-x64", "osx-arm64")) {
        $version = "1.2.lifecycle-smoke"
        $descriptorPath = Join-Path $temporaryRoot "$runtime-descriptor.json"
        $reportPath = Join-Path $temporaryRoot "$runtime-report.json"
        $descriptor = [ordered]@{
            schemaVersion = 1
            product = "WordOllama.JS"
            version = $version
            runtime = $runtime
            generatedAt = [DateTimeOffset]::UtcNow.AddMinutes(-2).ToString("O")
            releaseReady = $false
        }
        Write-Json $descriptorPath $descriptor
        $descriptorHash = (Get-FileHash -LiteralPath $descriptorPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $initial = "1.1.lifecycle-smoke"
        $observations = if ($runtime -eq "win-x64") {
            [ordered]@{
                initialInstall = [ordered]@{ version = $initial; certificateThumbprint = "A" }
                upgrade = [ordered]@{ version = $version; previousVersion = $initial; certificateThumbprint = "B" }
                rollback = [ordered]@{ version = $initial; previousVersion = $version }
                uninstall = [ordered]@{ installRootRemoved = $true; startupRemoved = $true; registrationRemoved = $true; certificateRemoved = $true; credentialRemoved = $true }
            }
        } else {
            [ordered]@{
                initialInstall = [ordered]@{ version = $initial }
                upgrade = [ordered]@{ version = $version; previousVersion = $initial }
                rollback = [ordered]@{ version = $initial; previousVersion = $version }
                agentSandbox = [ordered]@{ architecture = "arm64"; sandboxExec = "passed"; shells = @("zsh", "bash") }
                uninstall = [ordered]@{ installRootRemoved = $true; launchAgentRemoved = $true; manifestRemoved = $true; certificateRemoved = $true; credentialRemoved = $true }
            }
        }
        $report = [ordered]@{
            schemaVersion = 1
            kind = "platform-release-lifecycle"
            runtime = $runtime
            version = $version
            status = "passed"
            startedAt = [DateTimeOffset]::UtcNow.AddMinutes(-1).ToString("O")
            finishedAt = [DateTimeOffset]::UtcNow.ToString("O")
            sourceBuild = [ordered]@{
                descriptorSha256 = $descriptorHash
                candidateInstallerSha256 = ("a" * 64)
                previousInstallerSha256 = ("b" * 64)
                publisherSubject = "CN=Lifecycle Smoke"
                installerIdentity = "WordOllama.JS Lifecycle Smoke Installer"
            }
            observations = $observations
            errors = @()
        }
        Write-Json $reportPath $report
        & $validator -ReportPath $reportPath -BuildDescriptorPath $descriptorPath `
            -CandidateInstallerSha256 ("a" * 64) `
            -ExpectedWindowsPublisherSubject "CN=Lifecycle Smoke" `
            -ExpectedMacInstallerIdentity "WordOllama.JS Lifecycle Smoke Installer"

        $report.sourceBuild.candidateInstallerSha256 = "c" * 64
        Write-Json $reportPath $report
        Assert-Rejected {
            & $validator -ReportPath $reportPath -BuildDescriptorPath $descriptorPath `
                -CandidateInstallerSha256 ("a" * 64) `
                -ExpectedWindowsPublisherSubject "CN=Lifecycle Smoke" `
                -ExpectedMacInstallerIdentity "WordOllama.JS Lifecycle Smoke Installer"
        } "$runtime installer-hash tampering"

        $report.sourceBuild.candidateInstallerSha256 = "a" * 64
        if ($runtime -eq "win-x64") {
            $report.observations.upgrade.certificateThumbprint = "A"
        } else {
            $report.observations.agentSandbox.architecture = "x86_64"
        }
        Write-Json $reportPath $report
        Assert-Rejected {
            & $validator -ReportPath $reportPath -BuildDescriptorPath $descriptorPath `
                -CandidateInstallerSha256 ("a" * 64) `
                -ExpectedWindowsPublisherSubject "CN=Lifecycle Smoke" `
                -ExpectedMacInstallerIdentity "WordOllama.JS Lifecycle Smoke Installer"
        } "$runtime lifecycle observation tampering"
    }
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}

Write-Host "Platform release lifecycle evidence smoke passed."
