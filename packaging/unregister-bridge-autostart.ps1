param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [ValidateSet("Auto", "Windows", "MacOS")]
    [string]$Platform = "Auto",
    [string]$RegistrationRoot = "",
    [switch]$SkipDeactivation
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar)
$resolvedPlatform = if ($Platform -ne "Auto") {
    $Platform
} elseif ($IsWindows) {
    "Windows"
} elseif ($IsMacOS) {
    "MacOS"
} else {
    throw "Bridge autostart removal supports Windows or macOS."
}

if ($resolvedPlatform -eq "Windows") {
    $startupRoot = if ([string]::IsNullOrWhiteSpace($RegistrationRoot)) {
        [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
    } else {
        [IO.Path]::GetFullPath($RegistrationRoot)
    }
    $registrationPath = Join-Path $startupRoot "WordOllama.JS Desktop Bridge.lnk"
    $launcherPath = Join-Path $root "start-bridge.cmd"
    if (-not $SkipDeactivation) {
        $rootPrefix = $root + [IO.Path]::DirectorySeparatorChar
        foreach ($process in @(Get-Process -Name "WordOllama.DesktopBridge" -ErrorAction SilentlyContinue)) {
            try {
                $processPath = [IO.Path]::GetFullPath($process.Path)
            }
            catch {
                Write-Warning "Could not inspect Bridge process $($process.Id): $($_.Exception.Message)"
                continue
            }
            if ($processPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
                if (-not $process.WaitForExit(5000)) {
                    throw "Timed out stopping Bridge process $($process.Id)."
                }
            }
        }
    }
}
else {
    $launchAgentsRoot = if ([string]::IsNullOrWhiteSpace($RegistrationRoot)) {
        Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) "Library/LaunchAgents"
    } else {
        [IO.Path]::GetFullPath($RegistrationRoot)
    }
    $registrationPath = Join-Path $launchAgentsRoot "com.wordollama.desktopbridge.plist"
    $launcherPath = Join-Path $root "start-bridge"
    if (-not $SkipDeactivation -and (Test-Path -LiteralPath $registrationPath)) {
        if (-not $IsMacOS) { throw "macOS LaunchAgent deactivation must run on macOS." }
        $uid = (& id -u).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($uid)) { throw "Unable to resolve macOS user id." }
        & launchctl bootout "gui/$uid" $registrationPath
    }
}

foreach ($ownedPath in @($registrationPath, $launcherPath)) {
    if (Test-Path -LiteralPath $ownedPath) {
        Remove-Item -LiteralPath $ownedPath -Force
    }
}
Write-Host "Removed $resolvedPlatform Bridge autostart registration."
