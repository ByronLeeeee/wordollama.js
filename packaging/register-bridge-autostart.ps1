param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [ValidateSet("Auto", "Windows", "MacOS")]
    [string]$Platform = "Auto",
    [string]$RegistrationRoot = "",
    [switch]$SkipActivation
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar)
$currentVersionPath = Join-Path $root "current-version"
if (-not (Test-Path -LiteralPath $currentVersionPath -PathType Leaf)) {
    throw "Bridge current-version pointer is missing under $root. Install a Bridge version first."
}
$currentVersion = (Get-Content -LiteralPath $currentVersionPath -Raw).Trim()
if ($currentVersion -notmatch "^[0-9A-Za-z][0-9A-Za-z._-]*$") {
    throw "Bridge current-version pointer is invalid."
}

$resolvedPlatform = if ($Platform -ne "Auto") {
    $Platform
} elseif ($IsWindows) {
    "Windows"
} elseif ($IsMacOS) {
    "MacOS"
} else {
    throw "Bridge autostart registration supports Windows or macOS."
}

if ($resolvedPlatform -eq "Windows") {
    $executable = Join-Path $root "versions/$currentVersion/WordOllama.DesktopBridge.exe"
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "Installed Windows Bridge executable is missing: $executable"
    }
    $launcherPath = Join-Path $root "start-bridge.cmd"
    $launcher = @(
        "@echo off",
        "setlocal",
        'set /p "WORDOLLAMA_BRIDGE_VERSION="<"%~dp0current-version"',
        'if not defined WORDOLLAMA_BRIDGE_VERSION exit /b 2',
        'set "WORDOLLAMA_BRIDGE_EXE=%~dp0versions\%WORDOLLAMA_BRIDGE_VERSION%\WordOllama.DesktopBridge.exe"',
        'if not exist "%WORDOLLAMA_BRIDGE_EXE%" exit /b 3',
        'start "WordOllama.JS Desktop Bridge" /b "%WORDOLLAMA_BRIDGE_EXE%" >>"%~dp0bridge.log" 2>&1'
    ) -join "`r`n"
    Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding ascii -NoNewline

    $startupRoot = if ([string]::IsNullOrWhiteSpace($RegistrationRoot)) {
        [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
    } else {
        [IO.Path]::GetFullPath($RegistrationRoot)
    }
    New-Item -ItemType Directory -Force -Path $startupRoot | Out-Null
    $registrationPath = Join-Path $startupRoot "WordOllama.JS Desktop Bridge.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($registrationPath)
    $shortcut.TargetPath = $launcherPath
    $shortcut.WorkingDirectory = $root
    $shortcut.WindowStyle = 7
    $shortcut.Description = "Start WordOllama.JS Desktop Bridge"
    $shortcut.Save()

    if (-not $SkipActivation) {
        Start-Process -FilePath $launcherPath -WorkingDirectory $root -WindowStyle Hidden
    }
}
else {
    $executable = Join-Path $root "versions/$currentVersion/WordOllama.DesktopBridge"
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "Installed macOS Bridge executable is missing: $executable"
    }
    $launcherPath = Join-Path $root "start-bridge"
    $launcher = @'
#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
version=$(cat "$root/current-version")
case "$version" in
  ''|*[!0-9A-Za-z._-]*) exit 2 ;;
esac
executable="$root/versions/$version/WordOllama.DesktopBridge"
[ -x "$executable" ] || exit 3
exec "$executable" >>"$root/bridge.log" 2>&1
'@
    Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding utf8NoBOM -NoNewline
    if ($IsMacOS) {
        & chmod 700 $launcherPath
        if ($LASTEXITCODE -ne 0) { throw "Failed to make the macOS Bridge launcher executable." }
    }

    $launchAgentsRoot = if ([string]::IsNullOrWhiteSpace($RegistrationRoot)) {
        Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) "Library/LaunchAgents"
    } else {
        [IO.Path]::GetFullPath($RegistrationRoot)
    }
    New-Item -ItemType Directory -Force -Path $launchAgentsRoot | Out-Null
    $registrationPath = Join-Path $launchAgentsRoot "com.wordollama.desktopbridge.plist"
    $escapedLauncher = [Security.SecurityElement]::Escape($launcherPath)
    $escapedLog = [Security.SecurityElement]::Escape((Join-Path $root "bridge.log"))
    $plist = @"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.wordollama.desktopbridge</string>
  <key>ProgramArguments</key><array><string>$escapedLauncher</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$escapedLog</string>
  <key>StandardErrorPath</key><string>$escapedLog</string>
</dict>
</plist>
"@
    Set-Content -LiteralPath $registrationPath -Value $plist -Encoding utf8NoBOM

    if (-not $SkipActivation) {
        if (-not $IsMacOS) { throw "macOS LaunchAgent activation must run on macOS." }
        $uid = (& id -u).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($uid)) { throw "Unable to resolve macOS user id." }
        & launchctl bootout "gui/$uid" $registrationPath 2>$null
        & launchctl bootstrap "gui/$uid" $registrationPath
        if ($LASTEXITCODE -ne 0) { throw "launchctl bootstrap failed." }
        & launchctl kickstart -k "gui/$uid/com.wordollama.desktopbridge"
        if ($LASTEXITCODE -ne 0) { throw "launchctl kickstart failed." }
    }
}

Write-Host "Registered $resolvedPlatform Bridge autostart at $registrationPath"
