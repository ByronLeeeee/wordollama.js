[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("osx-arm64")]
    [string]$Runtime,
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9A-Za-z][0-9A-Za-z._-]*$")]
    [string]$Version,
    [string]$MacInstallerIdentity = "",
    [string]$MacNotaryProfile = "",
    [string]$MacNotaryKeychain = "",
    [string]$BridgeNotarizationEvidencePath = "",
    [string]$BridgeLocalSignatureEvidencePath = "",
    [string]$OutputPath = "",
    [string]$EvidencePath = "",
    [string]$DryRunStagingPath = "",
    [switch]$BuildUnsignedForTests,
    [switch]$LocalSelfSignedRelease,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$allowUnsignedTest = $BuildUnsignedForTests -and
    $Version -match "(?i)(smoke|test)"
$localSelfSigned = $LocalSelfSignedRelease -and -not $allowUnsignedTest
if (-not $DryRun -and -not $IsMacOS) {
    throw "The macOS installer must be built and signed on macOS; Developer ID mode also notarizes and assesses it there."
}
if ($localSelfSigned -and [string]::IsNullOrWhiteSpace($MacInstallerIdentity)) {
    throw "A local self-signed macOS package requires -MacInstallerIdentity."
}
if ($localSelfSigned -and -not [string]::IsNullOrWhiteSpace($MacNotaryProfile)) {
    throw "-LocalSelfSignedRelease cannot be combined with Apple notarization."
}
if (-not $allowUnsignedTest -and -not $localSelfSigned -and
    -not $MacInstallerIdentity.StartsWith(
        "Developer ID Installer:",
        [StringComparison]::Ordinal)) {
    throw "A production macOS package requires a 'Developer ID Installer:' identity."
}
if (-not $allowUnsignedTest -and -not $localSelfSigned -and
    [string]::IsNullOrWhiteSpace($MacNotaryProfile)) {
    throw "A production macOS package requires a notarytool keychain profile."
}

$root = (Resolve-Path -LiteralPath $ArtifactRoot).Path
$publishDirectory = Join-Path $root "$Version-$Runtime"
$bridgeArchive = Join-Path $root "WordOllama-Bridge-$Version-$Runtime.zip"
$bridgeBinary = Join-Path $publishDirectory "WordOllama.DesktopBridge"
foreach ($requiredPath in @($publishDirectory, $bridgeArchive, $bridgeBinary)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required signed Bridge artifact is missing: $requiredPath"
    }
}

$bridgeArchiveHash = (Get-FileHash -LiteralPath $bridgeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$bridgeEvidenceRecord = $null
if ($localSelfSigned) {
    if ([string]::IsNullOrWhiteSpace($BridgeLocalSignatureEvidencePath)) {
        throw "Local self-signed packaging requires -BridgeLocalSignatureEvidencePath."
    }
    $bridgeEvidenceRecord = Get-Content -LiteralPath `
        (Resolve-Path -LiteralPath $BridgeLocalSignatureEvidencePath).Path -Raw |
        ConvertFrom-Json
    if ($bridgeEvidenceRecord.schemaVersion -ne 1 -or
        $bridgeEvidenceRecord.kind -ne "apple-local-signature" -or
        $bridgeEvidenceRecord.version -ne $Version -or
        $bridgeEvidenceRecord.runtime -ne $Runtime -or
        $bridgeEvidenceRecord.archiveSha256 -ne $bridgeArchiveHash -or
        $bridgeEvidenceRecord.codeSignatureValid -ne $true -or
        $bridgeEvidenceRecord.notarized -ne $false -or
        $bridgeEvidenceRecord.explicitUserTrustRequired -ne $true) {
        throw "Bridge local-signature evidence does not match the signed Bridge archive."
    }
}
elseif (-not $allowUnsignedTest) {
    if ([string]::IsNullOrWhiteSpace($BridgeNotarizationEvidencePath)) {
        throw "Production macOS installer packaging requires Bridge notarization evidence."
    }
    $bridgeEvidenceRecord = Get-Content -LiteralPath `
        (Resolve-Path -LiteralPath $BridgeNotarizationEvidencePath).Path -Raw |
        ConvertFrom-Json
    if ($bridgeEvidenceRecord.schemaVersion -ne 1 -or
        $bridgeEvidenceRecord.kind -ne "apple-notarization" -or
        $bridgeEvidenceRecord.version -ne $Version -or
        $bridgeEvidenceRecord.runtime -ne $Runtime -or
        $bridgeEvidenceRecord.status -ne "Accepted" -or
        $bridgeEvidenceRecord.archiveSha256 -ne $bridgeArchiveHash -or
        [string]::IsNullOrWhiteSpace([string]$bridgeEvidenceRecord.submissionId)) {
        throw "Bridge notarization evidence does not match the signed Bridge archive."
    }
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $root "WordOllama-Installer-$Version-$Runtime.pkg"
}
$packagePath = [IO.Path]::GetFullPath($OutputPath)
$packageDirectory = Split-Path -Parent $packagePath
if (-not [string]::IsNullOrWhiteSpace($packageDirectory)) {
    New-Item -ItemType Directory -Force -Path $packageDirectory | Out-Null
}
if (Test-Path -LiteralPath $packagePath) {
    Remove-Item -LiteralPath $packagePath -Force
}
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = [IO.Path]::ChangeExtension($packagePath, ".installer.json")
}
$evidenceFullPath = [IO.Path]::GetFullPath($EvidencePath)
$evidenceDirectory = Split-Path -Parent $evidenceFullPath
if (-not [string]::IsNullOrWhiteSpace($evidenceDirectory)) {
    New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
}

$staging = if ([string]::IsNullOrWhiteSpace($DryRunStagingPath)) {
    Join-Path $root `
        (".$Version-$Runtime-installer-staging-" + [Guid]::NewGuid().ToString("N"))
}
else {
    if (-not $DryRun -or $Version -notmatch "(?i)(smoke|test)") {
        throw "-DryRunStagingPath is restricted to dry-run smoke/test versions."
    }
    [IO.Path]::GetFullPath($DryRunStagingPath)
}
$stagingPrefix = $root.TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $staging.StartsWith($stagingPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([IO.Path]::GetFileName($staging)).StartsWith(
        ".$Version-$Runtime-installer-staging-",
        [StringComparison]::Ordinal)) {
    throw "macOS installer staging must use the owned version/runtime prefix under ArtifactRoot."
}
if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}
$payload = Join-Path $staging "payload"
$scripts = Join-Path $staging "scripts"
$packages = Join-Path $staging "packages"
$componentPackage = Join-Path $packages "WordOllama.DesktopBridge.component.pkg"
$distributionPath = Join-Path $staging "Distribution.xml"
$payloadBridgeRoot = Join-Path $payload `
    "Library/Application Support/WordOllama.JS/DesktopBridge"
$payloadVersionRoot = Join-Path $payloadBridgeRoot "versions/$Version"
$payloadLaunchAgents = Join-Path $payload "Library/LaunchAgents"
$payloadApplications = Join-Path $payload "Applications/WordOllama.JS"
$uninstallerResources = Join-Path $payloadApplications "Uninstaller Resources"
$payloadDirectories = @(
    $payloadVersionRoot
    $payloadLaunchAgents
    $payloadApplications
    $uninstallerResources
    $scripts
    $packages
)
New-Item -ItemType Directory -Force -Path $payloadDirectories | Out-Null

function Invoke-InstallerTool {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if ($DryRun -and $localSelfSigned) {
        Invoke-InstallerTool -FileName "pkgutil" `
            -Arguments @("--check-signature", $packagePath) `
            -Label "local macOS installer signature verification" | Out-Null
        return
    }
    if ($DryRun -and -not $localSelfSigned) {
        Write-Host "DRY RUN: $FileName $($Arguments -join ' ')"
        return @()
    }
    $command = Get-Command $FileName -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "$Label requires '$FileName' on PATH."
    }
    $output = @(& $command.Source @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE`: $($output -join ' ')"
    }
    return $output
}

try {
    Copy-Item -Path (Join-Path $publishDirectory "*") `
        -Destination $payloadVersionRoot -Recurse -Force

    $launcherPath = Join-Path $payloadBridgeRoot "start-bridge"
    $launcher = @'
#!/bin/sh
set -eu
root="$HOME/Library/Application Support/WordOllama.JS/DesktopBridge"
version=$(cat "$root/current-version")
case "$version" in
  ''|*[!0-9A-Za-z._-]*) exit 2 ;;
esac
executable="$root/versions/$version/WordOllama.DesktopBridge"
[ -x "$executable" ] || exit 3
[ -f "$root/certs/bridge.pfx" ] || exit 0
export Bridge__HttpsCertificate__Path="$root/certs/bridge.pfx"
exec "$executable" >>"$root/bridge.log" 2>&1
'@
    Set-Content -LiteralPath $launcherPath -Value $launcher `
        -Encoding utf8NoBOM -NoNewline

    $plistPath = Join-Path $payloadLaunchAgents "com.wordollama.desktopbridge.plist"
    $plist = @'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.wordollama.desktopbridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>exec "$HOME/Library/Application Support/WordOllama.JS/DesktopBridge/start-bridge"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
'@
    Set-Content -LiteralPath $plistPath -Value $plist -Encoding utf8NoBOM

    $uninstallerPath = Join-Path $payloadApplications `
        "Uninstall WordOllama.JS Desktop Bridge.command"
    $uninstaller = @'
#!/bin/sh
set -eu
root="$HOME/Library/Application Support/WordOllama.JS/DesktopBridge"
launch_agent="$HOME/Library/LaunchAgents/com.wordollama.desktopbridge.plist"
application_dir="$HOME/Applications/WordOllama.JS"
addin_manifest="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef/WordOllama.JS.xml"
resources="$application_dir/Uninstaller Resources"
expected_root="$HOME/Library/Application Support/WordOllama.JS/DesktopBridge"
expected_agent="$HOME/Library/LaunchAgents/com.wordollama.desktopbridge.plist"
[ "$root" = "$expected_root" ] || exit 3
[ "$launch_agent" = "$expected_agent" ] || exit 3

locale="${LC_ALL:-${LC_MESSAGES:-${LANG:-en-US}}}"
case "$locale" in
  zh*|ZH*) messages="$resources/messages.zh-CN" ;;
  *) messages="$resources/messages.en-US" ;;
esac
[ -f "$messages" ] || exit 4
. "$messages"

if [ "${1:-}" != "--yes" ]; then
  printf '%s ' "$confirm_message"
  IFS= read -r answer
  case "$answer" in
    y|Y|yes|YES|是) ;;
    *) printf '%s\n' "$cancelled_message"; exit 0 ;;
  esac
fi

uid=$(id -u)
if [ -f "$launch_agent" ]; then
  launchctl bootout "gui/$uid" "$launch_agent" >/dev/null 2>&1 || true
fi

if [ -f "$root/current-version" ]; then
  version=$(cat "$root/current-version")
  case "$version" in
    ''|*[!0-9A-Za-z._-]*) version="" ;;
  esac
  if [ -n "$version" ]; then
    executable="$root/versions/$version/WordOllama.DesktopBridge"
    if [ -x "$executable" ]; then
      "$executable" https-certificate-secret delete >/dev/null 2>&1 || true
      for pid in $(pgrep -x WordOllama.DesktopBridge 2>/dev/null || true); do
        process_path=$(/usr/sbin/lsof -a -p "$pid" -d txt -Fn 2>/dev/null |
          sed -n 's/^n//p' | head -n 1)
        if [ "$process_path" = "$executable" ]; then
          kill "$pid" >/dev/null 2>&1 || true
        fi
      done
    fi
  fi
fi

/usr/bin/security delete-generic-password \
  -s "WordOllama.JS/WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD" \
  -a "$(id -un)" >/dev/null 2>&1 || true
ownership="$root/certs/ownership.json"
if [ -f "$ownership" ]; then
  thumbprint=$(sed -n 's/.*"thumbprint":"\([0-9A-Fa-f]*\)".*/\1/p' "$ownership" | head -n 1)
  case "$thumbprint" in
    ''|*[!0-9A-Fa-f]*) ;;
    *) /usr/bin/security delete-certificate -Z "$thumbprint" \
         "$HOME/Library/Keychains/login.keychain-db" >/dev/null 2>&1 || true ;;
  esac
fi
rm -f "$launch_agent"
if [ -f "$addin_manifest" ] && grep -q '4d2a7c5e-2d2a-4a1a-8b72-6a1cf4f7b701' "$addin_manifest"; then
  rm -f "$addin_manifest"
fi
rm -rf "$root"
/usr/sbin/pkgutil --forget com.wordollama.desktopbridge >/dev/null 2>&1 || true
rm -f "$resources/messages.en-US" "$resources/messages.zh-CN"
rmdir "$resources" >/dev/null 2>&1 || true
rm -f "$application_dir/Uninstall WordOllama.JS Desktop Bridge.command"
rm -f "$application_dir/Complete WordOllama.JS Setup.command"
rmdir "$application_dir" >/dev/null 2>&1 || true
printf '%s\n' "$removed_message"
'@
    Set-Content -LiteralPath $uninstallerPath -Value $uninstaller `
        -Encoding utf8NoBOM -NoNewline

    $setupPath = Join-Path $payloadApplications `
        "Complete WordOllama.JS Setup.command"
    $setup = @'
#!/bin/sh
set -eu
root="$HOME/Library/Application Support/WordOllama.JS/DesktopBridge"
expected="$HOME/Library/Application Support/WordOllama.JS/DesktopBridge"
[ "$root" = "$expected" ] || exit 3
pointer="$root/current-version"
[ -f "$pointer" ] || exit 4
version=$(cat "$pointer")
case "$version" in ''|*[!0-9A-Za-z._-]*) exit 5 ;; esac
executable="$root/versions/$version/WordOllama.DesktopBridge"
plist="$HOME/Library/LaunchAgents/com.wordollama.desktopbridge.plist"
[ -x "$executable" ] && [ -f "$plist" ] || exit 6

locale="${LC_ALL:-${LC_MESSAGES:-${LANG:-en-US}}}"
case "$locale" in
  zh*|ZH*)
    confirm='WordOllama.JS 需要为当前用户创建并信任一个仅限 localhost、127.0.0.1 和 ::1 的证书。macOS 可能继续显示系统授权提示。继续？[y/N] '
    success='WordOllama.JS 本地服务已启动并通过健康检查。请重新启动 Word。'
    cancelled='已取消安全设置；WordOllama.JS 本地服务尚未启动。'
    failed='本地服务未能通过健康检查。请查看 DesktopBridge/bridge.log。'
    ;;
  *)
    confirm='WordOllama.JS will create and trust a current-user certificate limited to localhost, 127.0.0.1 and ::1. macOS may show an additional authorization prompt. Continue? [y/N] '
    success='The WordOllama.JS local service is running and healthy. Restart Word.'
    cancelled='Setup was cancelled; the WordOllama.JS local service has not started.'
    failed='The local service did not pass its health check. Review DesktopBridge/bridge.log.'
    ;;
esac
printf '%s' "$confirm"
IFS= read -r answer
case "$answer" in y|Y|yes|YES|是) ;; *) printf '%s\n' "$cancelled"; exit 0 ;; esac

cert_root="$root/certs"
pfx="$cert_root/bridge.pfx"
ownership="$cert_root/ownership.json"
keychain="$HOME/Library/Keychains/login.keychain-db"
mkdir -p "$cert_root"
chmod 700 "$cert_root"
if [ ! -f "$pfx" ]; then
  command -v openssl >/dev/null 2>&1 || exit 20
  command -v security >/dev/null 2>&1 || exit 21
  password=$(openssl rand -base64 32 | tr -d '\r\n')
  work="$cert_root/.provision.$$"
  mkdir -m 700 "$work"
  cleanup_work() { rm -rf "$work"; }
  trap cleanup_work EXIT HUP INT TERM
  cat > "$work/openssl.cnf" <<'WORDOLLAMA_OPENSSL_CONFIG'
[req]
distinguished_name=dn
x509_extensions=server_ext
prompt=no
[dn]
CN=WordOllama.JS localhost
[server_ext]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=critical,@alt_names
[alt_names]
DNS.1=localhost
IP.1=127.0.0.1
IP.2=::1
WORDOLLAMA_OPENSSL_CONFIG
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 730 \
    -config "$work/openssl.cnf" -extensions server_ext \
    -keyout "$work/bridge.key" -out "$work/bridge.crt"
  printf '%s\n' "$password" | openssl pkcs12 -export -out "$work/bridge.pfx" \
    -inkey "$work/bridge.key" -in "$work/bridge.crt" -passout stdin
  security add-trusted-cert -d -r trustAsRoot -p ssl -k "$keychain" "$work/bridge.crt"
  fingerprint=$(openssl x509 -in "$work/bridge.crt" -sha1 -fingerprint -noout |
    sed 's/^[^=]*=//; s/://g')
  case "$fingerprint" in ''|*[!0-9A-Fa-f]*) exit 22 ;; esac
  mv "$work/bridge.pfx" "$pfx"
  chmod 600 "$pfx"
  printf '{"schemaVersion":1,"thumbprint":"%s","subject":"CN=WordOllama.JS localhost","hosts":["localhost","127.0.0.1","::1"]}\n' \
    "$fingerprint" > "$ownership"
  chmod 600 "$ownership"
  if ! printf '%s\n' "$password" | "$executable" https-certificate-secret set >/dev/null; then
    security delete-certificate -Z "$fingerprint" "$keychain" >/dev/null 2>&1 || true
    rm -f "$pfx" "$ownership"
    exit 23
  fi
  password=''
  cleanup_work
  trap - EXIT HUP INT TERM
fi

uid=$(id -u)
launchctl bootout "gui/$uid" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$plist"
launchctl kickstart -k "gui/$uid/com.wordollama.desktopbridge"
attempt=0
while [ "$attempt" -lt 30 ]; do
  if curl --fail --silent --show-error --max-time 2 https://localhost:37421/health >/dev/null 2>&1 &&
     curl --fail --silent --show-error --max-time 2 https://localhost:37421/index.html >/dev/null 2>&1; then
    printf '%s\n' "$success"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done
printf '%s\n' "$failed" >&2
exit 24
'@
    Set-Content -LiteralPath $setupPath -Value $setup `
        -Encoding utf8NoBOM -NoNewline
    Set-Content -LiteralPath (Join-Path $uninstallerResources "messages.en-US") `
        -Value @'
confirm_message='Remove WordOllama.JS Desktop Bridge for the current user? [y/N]'
cancelled_message='Uninstall cancelled.'
removed_message='WordOllama.JS Desktop Bridge was removed.'
'@ -Encoding utf8NoBOM -NoNewline
    Set-Content -LiteralPath (Join-Path $uninstallerResources "messages.zh-CN") `
        -Value @'
confirm_message='要移除当前用户的 WordOllama.JS Desktop Bridge 吗？[y/N]'
cancelled_message='已取消卸载。'
removed_message='已移除 WordOllama.JS Desktop Bridge。'
'@ -Encoding utf8NoBOM -NoNewline

    $postinstallPath = Join-Path $scripts "postinstall"
    $postinstall = @"
#!/bin/sh
set -eu
root="`$HOME/Library/Application Support/WordOllama.JS/DesktopBridge"
previous=""
if [ -f "`$root/current-version" ]; then
  previous=`$(cat "`$root/current-version")
fi
case "`$previous" in
  ''|*[!0-9A-Za-z._-]*) previous="" ;;
esac
mkdir -p "`$root"
addin_source="`$root/versions/$Version/WordOllama.JS.xml"
addin_root="`$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
[ -f "`$addin_source" ] || exit 5
mkdir -p "`$addin_root"
cp -f "`$addin_source" "`$addin_root/WordOllama.JS.xml"
pointer_tmp="`$root/.current-version.`$`$"
state_tmp="`$root/.current.json.`$`$"
printf '%s' '$Version' > "`$pointer_tmp"
printf '{"currentVersion":"%s","previousVersion":"%s","installedAt":"%s","installer":"pkg"}\n' \
  '$Version' "`$previous" "`$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "`$state_tmp"
mv -f "`$pointer_tmp" "`$root/current-version"
mv -f "`$state_tmp" "`$root/current.json"
uid=`$(id -u)
plist="`$HOME/Library/LaunchAgents/com.wordollama.desktopbridge.plist"
launchctl bootout "gui/`$uid" "`$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/`$uid" "`$plist"
launchctl kickstart -k "gui/`$uid/com.wordollama.desktopbridge" || true
if [ -f "`$root/certs/bridge.pfx" ]; then
  healthy=0
  attempt=0
  while [ "`$attempt" -lt 30 ]; do
    if curl --fail --silent --show-error --max-time 2 https://localhost:37421/health >/dev/null 2>&1 &&
       curl --fail --silent --show-error --max-time 2 https://localhost:37421/index.html >/dev/null 2>&1; then
      healthy=1
      break
    fi
    attempt=`$((attempt + 1))
    sleep 1
  done
  [ "`$healthy" -eq 1 ] || exit 24
else
  printf '%s\n' 'Run ~/Applications/WordOllama.JS/Complete WordOllama.JS Setup.command to approve localhost certificate trust and start the service.' > "`$root/setup-required.txt"
fi
"@
    Set-Content -LiteralPath $postinstallPath -Value $postinstall `
        -Encoding utf8NoBOM -NoNewline

    if (-not $DryRun) {
        & /bin/chmod 700 $launcherPath $postinstallPath $uninstallerPath $setupPath
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to set executable permissions in the package payload."
        }
        & /usr/bin/plutil -lint $plistPath
        if ($LASTEXITCODE -ne 0) { throw "Generated LaunchAgent plist is invalid." }
    }

    $architecture = if ($Runtime -eq "osx-arm64") { "arm64" } else { "x86_64" }
    $distribution = @"
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>WordOllama.JS Desktop Bridge</title>
  <options customize="never" require-scripts="false" hostArchitectures="$architecture"/>
  <domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>
  <choices-outline><line choice="default"/></choices-outline>
  <choice id="default" visible="false">
    <pkg-ref id="com.wordollama.desktopbridge"/>
  </choice>
  <pkg-ref id="com.wordollama.desktopbridge" version="$Version" onConclusion="none">
    WordOllama.DesktopBridge.component.pkg
  </pkg-ref>
</installer-gui-script>
"@
    Set-Content -LiteralPath $distributionPath -Value $distribution -Encoding utf8NoBOM

    Invoke-InstallerTool -FileName "pkgbuild" -Arguments @(
        "--root", $payload,
        "--identifier", "com.wordollama.desktopbridge",
        "--version", $Version,
        "--install-location", "/",
        "--scripts", $scripts,
        $componentPackage
    ) -Label "macOS component package build" | Out-Null
    $productBuildArguments = @(
        "--distribution", $distributionPath,
        "--package-path", $packages
    )
    if (-not $allowUnsignedTest) {
        $productBuildArguments += @("--sign", $MacInstallerIdentity)
    }
    $productBuildArguments += $packagePath
    Invoke-InstallerTool -FileName "productbuild" `
        -Arguments $productBuildArguments `
        -Label "macOS product package build/signing" | Out-Null

    if ($DryRun) {
        Invoke-InstallerTool -FileName "pkgutil" `
            -Arguments @("--check-signature", $packagePath) `
            -Label "macOS installer signature verification" | Out-Null
        $dryRunNotaryArguments = @(
            "notarytool", "submit", $packagePath,
            "--keychain-profile", $MacNotaryProfile,
            "--output-format", "json"
        )
        if (-not [string]::IsNullOrWhiteSpace($MacNotaryKeychain)) {
            $dryRunNotaryArguments += @("--keychain", $MacNotaryKeychain)
        }
        $dryRunNotaryArguments += "--wait"
        Invoke-InstallerTool -FileName "xcrun" -Arguments $dryRunNotaryArguments `
            -Label "macOS installer notarization" | Out-Null
        Invoke-InstallerTool -FileName "xcrun" `
            -Arguments @("stapler", "staple", $packagePath) `
            -Label "macOS installer ticket stapling" | Out-Null
        Invoke-InstallerTool -FileName "xcrun" `
            -Arguments @("stapler", "validate", $packagePath) `
            -Label "macOS installer ticket validation" | Out-Null
        Invoke-InstallerTool -FileName "spctl" `
            -Arguments @("--assess", "--type", "install", "--verbose=4", $packagePath) `
            -Label "macOS installer Gatekeeper assessment" | Out-Null
        return
    }

    if ($allowUnsignedTest) {
        Write-Host "Built unsigned macOS installer fixture $packagePath"
        return
    }

    $signatureDetails = @(Invoke-InstallerTool -FileName "pkgutil" `
        -Arguments @("--check-signature", $packagePath) `
        -Label "macOS installer signature verification")
    if (-not (($signatureDetails -join "`n").Contains(
            $MacInstallerIdentity,
            [StringComparison]::Ordinal))) {
        throw "The signed package does not contain the expected installer identity."
    }

    if ($localSelfSigned) {
        $installerEvidence = [ordered]@{
            schemaVersion = 1
            kind = "apple-local-installer-package"
            product = "WordOllama.JS Desktop Bridge"
            version = $Version
            runtime = $Runtime
            generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
            packagePath = [IO.Path]::GetFileName($packagePath)
            packageSha256 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
            packageSizeBytes = (Get-Item -LiteralPath $packagePath).Length
            installerAuthority = $MacInstallerIdentity
            bridgeArchiveSha256 = $bridgeArchiveHash
            bridgeSignatureAuthority = [string]$bridgeEvidenceRecord.authority
            signatureValid = $true
            notarized = $false
            ticketStapled = $false
            gatekeeperWarningExpected = $true
            explicitUserTrustRequired = $true
        }
        $evidenceTemp = "$evidenceFullPath.$([Guid]::NewGuid().ToString('N')).tmp"
        $installerEvidence | ConvertTo-Json -Depth 8 |
            Set-Content -LiteralPath $evidenceTemp -Encoding utf8
        Move-Item -LiteralPath $evidenceTemp -Destination $evidenceFullPath -Force
        Write-Host "Created locally signed macOS installer $packagePath"
        Write-Host "Created explicit-local-trust installer evidence $evidenceFullPath"
        return
    }

    $notaryArguments = @(
        "notarytool", "submit", $packagePath,
        "--keychain-profile", $MacNotaryProfile,
        "--output-format", "json"
    )
    if (-not [string]::IsNullOrWhiteSpace($MacNotaryKeychain)) {
        $notaryArguments += @("--keychain", $MacNotaryKeychain)
    }
    $notaryArguments += "--wait"
    $notaryOutput = @(Invoke-InstallerTool -FileName "xcrun" `
        -Arguments $notaryArguments -Label "macOS installer notarization")
    try {
        $notaryResult = ($notaryOutput -join "`n") | ConvertFrom-Json
    }
    catch {
        throw "macOS installer notarization did not return valid JSON."
    }
    if ($notaryResult.status -ne "Accepted" -or
        [string]::IsNullOrWhiteSpace([string]$notaryResult.id)) {
        throw "macOS installer notarization was not accepted."
    }

    $notaryLogPath = [IO.Path]::ChangeExtension($evidenceFullPath, ".log.json")
    $logArguments = @(
        "notarytool", "log", [string]$notaryResult.id,
        "--keychain-profile", $MacNotaryProfile
    )
    if (-not [string]::IsNullOrWhiteSpace($MacNotaryKeychain)) {
        $logArguments += @("--keychain", $MacNotaryKeychain)
    }
    $logArguments += $notaryLogPath
    Invoke-InstallerTool -FileName "xcrun" -Arguments $logArguments `
        -Label "macOS installer notarization log" | Out-Null
    $notaryLog = Get-Content -LiteralPath $notaryLogPath -Raw | ConvertFrom-Json
    if ($notaryLog.status -ne "Accepted" -or
        @($notaryLog.issues | Where-Object { $_.severity -eq "error" }).Count -ne 0) {
        throw "macOS installer notarization log contains a rejected status or errors."
    }

    Invoke-InstallerTool -FileName "xcrun" `
        -Arguments @("stapler", "staple", $packagePath) `
        -Label "macOS installer ticket stapling" | Out-Null
    Invoke-InstallerTool -FileName "xcrun" `
        -Arguments @("stapler", "validate", $packagePath) `
        -Label "macOS installer ticket validation" | Out-Null
    $gatekeeperDetails = @(Invoke-InstallerTool -FileName "spctl" `
        -Arguments @("--assess", "--type", "install", "--verbose=4", $packagePath) `
        -Label "macOS installer Gatekeeper assessment")

    $installerEvidence = [ordered]@{
        schemaVersion = 1
        kind = "apple-installer-package"
        product = "WordOllama.JS Desktop Bridge"
        version = $Version
        runtime = $Runtime
        generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
        packagePath = [IO.Path]::GetFileName($packagePath)
        packageSha256 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
        packageSizeBytes = (Get-Item -LiteralPath $packagePath).Length
        installerAuthority = $MacInstallerIdentity
        bridgeArchiveSha256 = $bridgeArchiveHash
        bridgeNotarizationSubmissionId = [string]$bridgeEvidenceRecord.submissionId
        submissionId = [string]$notaryResult.id
        status = [string]$notaryResult.status
        logPath = [IO.Path]::GetFileName($notaryLogPath)
        logSha256 = (Get-FileHash -LiteralPath $notaryLogPath -Algorithm SHA256).Hash.ToLowerInvariant()
        errorCount = @($notaryLog.issues | Where-Object { $_.severity -eq "error" }).Count
        ticketStapled = $true
        ticketValidated = $true
        gatekeeperAssessed = $true
        gatekeeperDetails = $gatekeeperDetails
    }
    $evidenceTemp = "$evidenceFullPath.$([Guid]::NewGuid().ToString('N')).tmp"
    $installerEvidence | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $evidenceTemp -Encoding utf8
    Move-Item -LiteralPath $evidenceTemp -Destination $evidenceFullPath -Force
    Write-Host "Created signed, notarized macOS installer $packagePath"
    Write-Host "Created macOS installer evidence $evidenceFullPath"
}
finally {
    if ([string]::IsNullOrWhiteSpace($DryRunStagingPath) -and
        (Test-Path -LiteralPath $staging)) {
        $resolvedStaging = (Resolve-Path -LiteralPath $staging).Path
        $expectedPrefix = $root.TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $resolvedStaging.StartsWith(
                $expectedPrefix,
                [StringComparison]::OrdinalIgnoreCase) -or
            -not ([IO.Path]::GetFileName($resolvedStaging)).StartsWith(
                ".$Version-$Runtime-installer-staging-",
                [StringComparison]::Ordinal)) {
            throw "Refusing to remove unexpected macOS installer staging path: $resolvedStaging"
        }
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
