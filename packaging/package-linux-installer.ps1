[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("linux-x64")]
    [string]$Runtime,
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9A-Za-z][0-9A-Za-z._-]*$")]
    [string]$Version,
    [string]$OutputPath = "",
    [string]$DryRunStagingPath = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
if (-not $DryRun -and -not $IsLinux) {
    throw "The Linux installer archive must be built on Linux. Use -DryRun for structural validation."
}

$root = (Resolve-Path -LiteralPath $ArtifactRoot).Path
$publishDirectory = Join-Path $root "$Version-$Runtime"
$bridgeExecutable = Join-Path $publishDirectory "WordOllama.DesktopBridge"
foreach ($requiredPath in @(
    $publishDirectory,
    $bridgeExecutable,
    (Join-Path $publishDirectory "appsettings.json"),
    (Join-Path $publishDirectory "wwwroot/wps.html"),
    (Join-Path $publishDirectory "wwwroot/wps-addin/index.html"),
    (Join-Path $publishDirectory "wwwroot/wps-addin/main.js"),
    (Join-Path $publishDirectory "wwwroot/wps-addin/ribbon.xml")
)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required Linux WPS artifact is missing: $requiredPath"
    }
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $root "WordOllama-Installer-$Version-$Runtime.tar.gz"
}
$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $outputFullPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$packageName = "WordOllama.JS-$Version-$Runtime"
$staging = if ([string]::IsNullOrWhiteSpace($DryRunStagingPath)) {
    Join-Path $root (".$Version-$Runtime-linux-installer-" + [Guid]::NewGuid().ToString("N"))
} else {
    [IO.Path]::GetFullPath($DryRunStagingPath)
}
$rootPrefix = $root.TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $staging.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([IO.Path]::GetFileName($staging)).StartsWith(
        ".$Version-$Runtime-linux-installer-",
        [StringComparison]::Ordinal)) {
    throw "Linux installer staging must use the owned version/runtime prefix under ArtifactRoot."
}
if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}

$packageRoot = Join-Path $staging $packageName
$payload = Join-Path $packageRoot "payload"
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Copy-Item -Path (Join-Path $publishDirectory "*") -Destination $payload -Recurse -Force

$installPath = Join-Path $packageRoot "install.sh"
$installScript = @"
#!/bin/sh
set -eu
version='$Version'
runtime='$Runtime'
[ "`$(uname -s)" = 'Linux' ] || { printf '%s\n' 'This installer requires Linux.' >&2; exit 2; }
[ "`$(uname -m)" = 'x86_64' ] || { printf '%s\n' 'This installer requires x86_64 Linux.' >&2; exit 3; }
[ "`$(id -u)" -ne 0 ] || { printf '%s\n' 'Run this installer as your desktop user, not root.' >&2; exit 4; }
command -v systemctl >/dev/null 2>&1 || { printf '%s\n' 'systemd user services are required.' >&2; exit 5; }
command -v curl >/dev/null 2>&1 || { printf '%s\n' 'curl is required.' >&2; exit 6; }

script_dir=`$(CDPATH= cd -- "`$(dirname -- "`$0")" && pwd)
source_root="`$script_dir/payload"
data_root="`$HOME/.local/share/WordOllama.JS/DesktopBridge"
version_root="`$data_root/versions/`$version"
bin_root="`$HOME/.local/bin"
unit_root="`$HOME/.config/systemd/user"
unit_path="`$unit_root/wordollama-js.service"
launcher="`$bin_root/wordollama-js-bridge"
uninstaller="`$HOME/.local/share/WordOllama.JS/uninstall.sh"
previous=''
if [ -f "`$data_root/current-version" ]; then
  previous=`$(cat "`$data_root/current-version")
  case "`$previous" in ''|*[!0-9A-Za-z._-]*) previous='' ;; esac
fi

mkdir -p "`$version_root" "`$bin_root" "`$unit_root" "`$(dirname "`$uninstaller")"
cp -R "`$source_root/." "`$version_root/"
chmod 700 "`$version_root/WordOllama.DesktopBridge"
pointer_tmp="`$data_root/.current-version.`$`$"
printf '%s' "`$version" > "`$pointer_tmp"
mv -f "`$pointer_tmp" "`$data_root/current-version"

cat > "`$launcher" <<'WORDOLLAMA_LAUNCHER'
#!/bin/sh
set -eu
root="`$HOME/.local/share/WordOllama.JS/DesktopBridge"
version=`$(cat "`$root/current-version")
case "`$version" in ''|*[!0-9A-Za-z._-]*) exit 2 ;; esac
exec "`$root/versions/`$version/WordOllama.DesktopBridge"
WORDOLLAMA_LAUNCHER
chmod 700 "`$launcher"

cat > "`$unit_path" <<'WORDOLLAMA_SYSTEMD_UNIT'
[Unit]
Description=WordOllama.JS Desktop Bridge
After=graphical-session.target

[Service]
Type=simple
ExecStart=%h/.local/bin/wordollama-js-bridge
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
WORDOLLAMA_SYSTEMD_UNIT

cp "`$script_dir/uninstall.sh" "`$uninstaller"
chmod 700 "`$uninstaller"
"`$version_root/WordOllama.DesktopBridge" wps-registration install \
  --url http://127.0.0.1:37421/wps-addin/

systemctl --user daemon-reload
systemctl --user enable --now wordollama-js.service
attempt=0
while [ "`$attempt" -lt 30 ]; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:37421/health >/dev/null 2>&1 &&
     curl --fail --silent --max-time 2 http://127.0.0.1:37421/wps-addin/ribbon.xml >/dev/null 2>&1; then
    printf '%s\n' 'WordOllama.JS is installed. Restart WPS Writer to load its Ribbon tab.'
    command -v secret-tool >/dev/null 2>&1 ||
      printf '%s\n' 'Optional: install libsecret-tools before saving cloud API keys.'
    command -v bwrap >/dev/null 2>&1 ||
      printf '%s\n' 'Optional: install bubblewrap to enable sandboxed Agent code execution.'
    exit 0
  fi
  attempt=`$((attempt + 1))
  sleep 1
done
if [ -n "`$previous" ] && [ "`$previous" != "`$version" ] &&
   [ -x "`$data_root/versions/`$previous/WordOllama.DesktopBridge" ]; then
  printf '%s' "`$previous" > "`$data_root/current-version"
  systemctl --user restart wordollama-js.service >/dev/null 2>&1 || true
  printf '%s\n' "The new Bridge failed its health check; restored version `$previous." >&2
else
  systemctl --user disable --now wordollama-js.service >/dev/null 2>&1 || true
fi
printf '%s\n' 'The Bridge did not pass its health check. Run: journalctl --user -u wordollama-js.service' >&2
exit 20
"@
Set-Content -LiteralPath $installPath -Value $installScript -Encoding utf8NoBOM -NoNewline

$uninstallPath = Join-Path $packageRoot "uninstall.sh"
$uninstallScript = @'
#!/bin/sh
set -eu
[ "$(id -u)" -ne 0 ] || { printf '%s\n' 'Run this uninstaller as your desktop user, not root.' >&2; exit 4; }
data_root="$HOME/.local/share/WordOllama.JS/DesktopBridge"
expected_root="$HOME/.local/share/WordOllama.JS/DesktopBridge"
[ "$data_root" = "$expected_root" ] || exit 5
pointer="$data_root/current-version"
unit="$HOME/.config/systemd/user/wordollama-js.service"
launcher="$HOME/.local/bin/wordollama-js-bridge"

systemctl --user disable --now wordollama-js.service >/dev/null 2>&1 || true
if [ -f "$pointer" ]; then
  version=$(cat "$pointer")
  case "$version" in ''|*[!0-9A-Za-z._-]*) version='' ;; esac
  executable="$data_root/versions/$version/WordOllama.DesktopBridge"
  if [ -n "$version" ] && [ -x "$executable" ]; then
    "$executable" wps-registration uninstall >/dev/null 2>&1 || true
  fi
fi
rm -f "$unit" "$launcher"
systemctl --user daemon-reload >/dev/null 2>&1 || true
rm -rf "$data_root"
rm -f "$HOME/.local/share/WordOllama.JS/uninstall.sh"
rmdir "$HOME/.local/share/WordOllama.JS" >/dev/null 2>&1 || true
printf '%s\n' 'WordOllama.JS was removed. Restart WPS Writer.'
'@
Set-Content -LiteralPath $uninstallPath -Value $uninstallScript -Encoding utf8NoBOM -NoNewline

Set-Content -LiteralPath (Join-Path $packageRoot "README.txt") -Encoding utf8NoBOM -Value @"
WordOllama.JS for WPS Writer on Linux x64

1. Extract this archive.
2. Run: ./install.sh
3. Restart WPS Writer.

The installer is per-user and must not be run with sudo.
Uninstall with: ~/.local/share/WordOllama.JS/uninstall.sh
Cloud API-key storage requires libsecret-tools. Sandboxed Agent code execution requires bubblewrap.
"@

if (-not $DryRun) {
    & chmod 700 $installPath $uninstallPath (Join-Path $payload "WordOllama.DesktopBridge")
    if ($LASTEXITCODE -ne 0) { throw "Unable to set Linux installer executable permissions." }
    $tar = Get-Command tar -ErrorAction Stop
    if (Test-Path -LiteralPath $outputFullPath) {
        Remove-Item -LiteralPath $outputFullPath -Force
    }
    & $tar.Source -czf $outputFullPath -C $staging $packageName
    if ($LASTEXITCODE -ne 0) { throw "Linux installer tar creation failed." }
    $hash = (Get-FileHash -LiteralPath $outputFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$outputFullPath.sha256" -Encoding ascii `
        -Value "$hash  $([IO.Path]::GetFileName($outputFullPath))"
    Write-Host "Created Linux x64 WPS installer $outputFullPath"
} else {
    Write-Host "Linux installer dry-run staging created at $staging"
}

if ([string]::IsNullOrWhiteSpace($DryRunStagingPath) -and (Test-Path -LiteralPath $staging)) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}
