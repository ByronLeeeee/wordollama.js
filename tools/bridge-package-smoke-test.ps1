param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [string]$BuildRoot = "",
    [switch]$IncludeCrossBuilds
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
$publishScript = Join-Path $repoRoot "packaging\publish-bridge.ps1"
$signScript = Join-Path $repoRoot "packaging\sign-bridge-release.ps1"
$macInstallerScript = Join-Path $repoRoot "packaging\package-macos-installer.ps1"
$windowsInstallerScript = Join-Path $repoRoot "packaging\package-windows-installer.ps1"
$installScript = Join-Path $repoRoot "packaging\install-bridge-update.ps1"
$rollbackScript = Join-Path $repoRoot "packaging\rollback-bridge.ps1"
$registerAutostartScript = Join-Path $repoRoot "packaging\register-bridge-autostart.ps1"
$unregisterAutostartScript = Join-Path $repoRoot "packaging\unregister-bridge-autostart.ps1"
$provisionHttpsScript = Join-Path $repoRoot "packaging\provision-bridge-https.ps1"
$finalizeReleaseScript = Join-Path $repoRoot "packaging\finalize-unified-release.ps1"
if ([string]::IsNullOrWhiteSpace($BuildRoot)) {
    $BuildRoot = Join-Path $repoRoot ".build-bridge-package-smoke"
}
$buildRootFullPath = [System.IO.Path]::GetFullPath($BuildRoot)
$version = "smoke"
$smokeAddinOrigin = "https://release.wordollama.example"
$smokeUpdateIndexUrl = "https://release.wordollama.example/bridge/update-index-smoke.json"
$smokeUpdatePublisherSubject = "CN=WordOllama Package Smoke Publisher"
$smokeAddinStaticRoot = Join-Path $buildRootFullPath "addin-static"
New-Item -ItemType Directory -Force -Path `
    (Join-Path $smokeAddinStaticRoot "assets") | Out-Null
Set-Content -LiteralPath (Join-Path $smokeAddinStaticRoot "index.html") `
    -Value "<!doctype html><title>WordOllama.JS</title><div id=`"root`"></div>" `
    -Encoding utf8NoBOM
Set-Content -LiteralPath (Join-Path $smokeAddinStaticRoot "settings.html") `
    -Value "<!doctype html><title>WordOllama.JS Settings</title><div id=`"root`"></div>" `
    -Encoding utf8NoBOM
Set-Content -LiteralPath (Join-Path $smokeAddinStaticRoot "commands.html") `
    -Value "<!doctype html><title>WordOllama.JS Commands</title>" `
    -Encoding utf8NoBOM
Set-Content -LiteralPath (Join-Path $smokeAddinStaticRoot "assets/app.js") `
    -Value "globalThis.wordOllamaDesktopHost = true;" -Encoding utf8NoBOM
Set-Content -LiteralPath (Join-Path $smokeAddinStaticRoot "manifest.xml") `
    -Value @'
<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1">
  <Id>4d2a7c5e-2d2a-4a1a-8b72-6a1cf4f7b701</Id>
  <DisplayName DefaultValue="WordOllama.JS"/>
  <DefaultSettings><SourceLocation DefaultValue="https://localhost:37421/index.html"/></DefaultSettings>
</OfficeApp>
'@ -Encoding utf8NoBOM

if ($IsWindows) {
    $hostRuntime = "win-x64"
}
elseif ($IsMacOS) {
    $hostRuntime = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq
        [System.Runtime.InteropServices.Architecture]::Arm64) { "osx-arm64" } else { "osx-x64" }
}
else {
    throw "Bridge release archive smoke supports Windows or macOS hosts."
}

function Get-CertificatePath {
    param([Parameter(Mandatory = $true)][string]$Runtime)
    if ($Runtime.StartsWith("osx-", [StringComparison]::Ordinal)) {
        return "/Library/Application Support/WordOllama.JS/certs/bridge.pfx"
    }
    return "C:/ProgramData/WordOllama.JS/certs/bridge.pfx"
}

function Assert-PublishDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Runtime,
        [Parameter(Mandatory = $true)][bool]$ExpectArchive
    )

    $directory = Join-Path $buildRootFullPath "$version-$Runtime"
    $executable = if ($Runtime -eq "win-x64") {
        Join-Path $directory "WordOllama.DesktopBridge.exe"
    } else {
        Join-Path $directory "WordOllama.DesktopBridge"
    }
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "Bridge package smoke: executable missing for $Runtime."
    }

    $settingsPath = Join-Path $directory "appsettings.json"
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    if ($settings.Bridge.Urls -ne "https://127.0.0.1:37421" -or
        $settings.Bridge.HttpsCertificate.Path -ne (Get-CertificatePath -Runtime $Runtime) -or
        @($settings.Bridge.AllowedOrigins).Count -ne 1 -or
        $settings.Bridge.AllowedOrigins[0] -ne $smokeAddinOrigin -or
        $settings.Bridge.Updates.IndexUrl -ne $smokeUpdateIndexUrl -or
        $settings.Bridge.Updates.ExpectedPublisherSubject -ne
            $smokeUpdatePublisherSubject -or
        $settings.Bridge.LocalTools.AllowHttpRequests -ne $false) {
        throw "Bridge package smoke: production HTTPS settings mismatch for $Runtime."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $directory "WordOllama.JS.xml") -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $directory "wwwroot/index.html") -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $directory "wwwroot/settings.html") -PathType Leaf)) {
        throw "Bridge package smoke: locally hosted Add-in payload is missing for $Runtime."
    }

    $archivePath = Join-Path $buildRootFullPath "WordOllama-Bridge-$version-$Runtime.zip"
    if ($ExpectArchive -and -not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        throw "Bridge package smoke: final archive missing for $Runtime."
    }
    if (-not $ExpectArchive -and (Test-Path -LiteralPath $archivePath)) {
        throw "Bridge package smoke: CrossBuildOnly created an archive for $Runtime."
    }

    if ($ExpectArchive) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
        try {
            $entryNames = @($zip.Entries.FullName | ForEach-Object { $_.Replace('\', '/') })
            $expectedExecutable = if ($Runtime -eq "win-x64") {
                "WordOllama.DesktopBridge.exe"
            } else { "WordOllama.DesktopBridge" }
            if ($entryNames -notcontains "appsettings.json" -or $entryNames -notcontains $expectedExecutable -or
                $entryNames -notcontains "Skills/contract-review/SKILL.md" -or
                $entryNames -notcontains "WordOllama.JS.xml" -or
                $entryNames -notcontains "wwwroot/index.html") {
                throw "Bridge package smoke: required entries must be at the archive root for $Runtime."
            }
        }
        finally {
            $zip.Dispose()
        }
    }
}

function Assert-PackagedBridgeFailsClosed {
    param([Parameter(Mandatory = $true)][string]$Runtime)

    $directory = Join-Path $buildRootFullPath "$version-$Runtime"
    $executable = if ($Runtime -eq "win-x64") {
        Join-Path $directory "WordOllama.DesktopBridge.exe"
    } else {
        Join-Path $directory "WordOllama.DesktopBridge"
    }
    $missingCertificate = Join-Path $buildRootFullPath "missing-certificate.pfx"
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $executable
    $startInfo.WorkingDirectory = $repoRoot.Path
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment["Bridge__HttpsCertificate__Path"] = $missingCertificate

    $process = [System.Diagnostics.Process]::Start($startInfo)
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(60000)) {
        $process.Kill($true)
        $process.WaitForExit()
        throw "Bridge package smoke: packaged Bridge loaded development configuration or hung instead of failing closed."
    }
    $process.WaitForExit()
    $output = $stdoutTask.Result + $stderrTask.Result
    if ($process.ExitCode -eq 0 -or
        $output -notlike "*Configured HTTPS certificate file was not found*") {
        throw "Bridge package smoke: packaged Bridge did not enforce its adjacent production HTTPS configuration."
    }
}


function Assert-InstallAndRollback {
    param([Parameter(Mandatory = $true)][string]$Runtime)

    $directory = Join-Path $buildRootFullPath "$version-$Runtime"
    $archivePath = Join-Path $buildRootFullPath "WordOllama-Bridge-$version-$Runtime.zip"
    $installRoot = Join-Path $buildRootFullPath "install-smoke-$Runtime"
    $legacyFixtureRoot = Join-Path $buildRootFullPath "legacy-archive-$Runtime"
    foreach ($ownedPath in @($installRoot, $legacyFixtureRoot)) {
        if (Test-Path -LiteralPath $ownedPath) {
            Remove-Item -LiteralPath $ownedPath -Recurse -Force
        }
    }

    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    & $installScript -ArchivePath $archivePath -InstallRoot $installRoot `
        -Version "root-package" -ExpectedSha256 $archiveHash
    $executableName = if ($Runtime -eq "win-x64") {
        "WordOllama.DesktopBridge.exe"
    } else { "WordOllama.DesktopBridge" }
    $installedExecutable = Join-Path $installRoot "versions/root-package/$executableName"
    if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
        throw "Bridge package smoke: root archive did not install into the normalized version directory."
    }
    $state = Get-Content -LiteralPath (Join-Path $installRoot "current.json") -Raw | ConvertFrom-Json
    if ($state.currentVersion -ne "root-package" -or $state.sha256 -ne $archiveHash.ToLowerInvariant()) {
        throw "Bridge package smoke: installed state did not preserve version and archive hash."
    }
    $currentVersion = (Get-Content -LiteralPath (Join-Path $installRoot "current-version") -Raw).Trim()
    if ($currentVersion -ne "root-package") {
        throw "Bridge package smoke: root install did not update the stable current-version pointer."
    }

    New-Item -ItemType Directory -Force -Path $legacyFixtureRoot | Out-Null
    $legacyPayload = Join-Path $legacyFixtureRoot "legacy-$Runtime"
    Copy-Item -LiteralPath $directory -Destination $legacyPayload -Recurse
    $legacyArchive = Join-Path $legacyFixtureRoot "legacy.zip"
    Compress-Archive -LiteralPath $legacyPayload -DestinationPath $legacyArchive -Force
    $legacyHash = (Get-FileHash -LiteralPath $legacyArchive -Algorithm SHA256).Hash
    & $installScript -ArchivePath $legacyArchive -InstallRoot $installRoot `
        -Version "legacy-package" -ExpectedSha256 $legacyHash
    $legacyExecutable = Join-Path $installRoot "versions/legacy-package/$executableName"
    if (-not (Test-Path -LiteralPath $legacyExecutable -PathType Leaf)) {
        throw "Bridge package smoke: legacy single-directory archive was not normalized during install."
    }

    $currentVersion = (Get-Content -LiteralPath (Join-Path $installRoot "current-version") -Raw).Trim()
    if ($currentVersion -ne "legacy-package") {
        throw "Bridge package smoke: second install did not advance the stable current-version pointer."
    }
    & $rollbackScript -InstallRoot $installRoot
    $rolledBackState = Get-Content -LiteralPath (Join-Path $installRoot "current.json") -Raw | ConvertFrom-Json
    if ($rolledBackState.currentVersion -ne "root-package" -or $rolledBackState.previousVersion -ne "legacy-package") {
        throw "Bridge package smoke: cross-platform rollback pointer did not switch versions."
    }

    $hashRejected = $false
    $currentVersion = (Get-Content -LiteralPath (Join-Path $installRoot "current-version") -Raw).Trim()
    if ($currentVersion -ne "root-package") {
        throw "Bridge package smoke: rollback did not restore the stable current-version pointer."
    }
    try {
        & $installScript -ArchivePath $archivePath -InstallRoot $installRoot `
            -Version "hash-rejected" -ExpectedSha256 ("0" * 64)
    }
    catch {
        $hashRejected = $_.Exception.Message -like "*hash mismatch*"
    }
    if (-not $hashRejected) {
        throw "Bridge package smoke: update installer accepted an archive with the wrong SHA-256."
    }
    $rejectedVersionPath = Join-Path $installRoot "versions/hash-rejected"
    if (Test-Path -LiteralPath $rejectedVersionPath) {
        throw "Bridge package smoke: rejected update left an installed version behind."
    }
    if ($Runtime -eq "win-x64") {
        $signatureRejected = $false
        try {
            & $installScript -ArchivePath $archivePath -InstallRoot $installRoot `
                -Version "signature-rejected" -ExpectedSha256 $archiveHash `
                -RequirePlatformSignature
        }
        catch {
            $signatureRejected =
                $_.Exception.Message -like "*Authenticode signature is not valid*"
        }
        if (-not $signatureRejected) {
            throw "Bridge package smoke: production signature gate accepted an unsigned archive."
        }
        if (Test-Path -LiteralPath (Join-Path $installRoot "versions/signature-rejected")) {
            throw "Bridge package smoke: rejected unsigned update left an installed version behind."
        }
    }
}

function Assert-AutostartArtifacts {
    param([Parameter(Mandatory = $true)][string]$Runtime)

    $installRoot = Join-Path $buildRootFullPath "install-smoke-$Runtime"
    $registrationRoot = Join-Path $buildRootFullPath "autostart-smoke-$Runtime"
    if (Test-Path -LiteralPath $registrationRoot) {
        Remove-Item -LiteralPath $registrationRoot -Recurse -Force
    }
    $platform = if ($Runtime -eq "win-x64") { "Windows" } else { "MacOS" }
    & $registerAutostartScript -InstallRoot $installRoot -Platform $platform `
        -RegistrationRoot $registrationRoot -SkipActivation

    if ($platform -eq "Windows") {
        $launcherPath = Join-Path $installRoot "start-bridge.cmd"
        $registrationPath = Join-Path $registrationRoot "WordOllama.JS Desktop Bridge.lnk"
        $launcherText = Get-Content -LiteralPath $launcherPath -Raw
        if ($launcherText -notlike "*%~dp0current-version*" -or
            -not (Test-Path -LiteralPath $registrationPath -PathType Leaf)) {
            throw "Bridge package smoke: Windows stable launcher or Startup shortcut is invalid."
        }
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($registrationPath)
        if ([IO.Path]::GetFullPath($shortcut.TargetPath) -ne [IO.Path]::GetFullPath($launcherPath)) {
            throw "Bridge package smoke: Windows Startup shortcut targets the wrong launcher."
        }
    }
    else {
        $launcherPath = Join-Path $installRoot "start-bridge"
        $registrationPath = Join-Path $registrationRoot "com.wordollama.desktopbridge.plist"
        $launcherText = Get-Content -LiteralPath $launcherPath -Raw
        [xml]$plist = Get-Content -LiteralPath $registrationPath -Raw
        if ($launcherText -notlike "*current-version*" -or
            $plist.plist.dict.string[0] -ne "com.wordollama.desktopbridge") {
            throw "Bridge package smoke: macOS stable launcher or LaunchAgent is invalid."
        }
    }

    & $unregisterAutostartScript -InstallRoot $installRoot -Platform $platform `
        -RegistrationRoot $registrationRoot -SkipDeactivation
    if ((Test-Path -LiteralPath $launcherPath) -or (Test-Path -LiteralPath $registrationPath)) {
        throw "Bridge package smoke: autostart unregister left owned artifacts behind."
    }

    if ($IsWindows) {
        $simulatedMacRoot = Join-Path $buildRootFullPath "simulated-mac-install"
        $simulatedMacRegistration = Join-Path $buildRootFullPath "simulated-mac-launchagents"
        foreach ($ownedPath in @($simulatedMacRoot, $simulatedMacRegistration)) {
            if (Test-Path -LiteralPath $ownedPath) { Remove-Item -LiteralPath $ownedPath -Recurse -Force }
        }
        $simulatedVersionRoot = Join-Path $simulatedMacRoot "versions/mac-fixture"
        New-Item -ItemType Directory -Force -Path $simulatedVersionRoot | Out-Null
        Set-Content -LiteralPath (Join-Path $simulatedMacRoot "current-version") `
            -Value "mac-fixture" -Encoding utf8NoBOM -NoNewline
        Set-Content -LiteralPath (Join-Path $simulatedVersionRoot "WordOllama.DesktopBridge") `
            -Value "macOS fixture" -Encoding utf8NoBOM
        & $registerAutostartScript -InstallRoot $simulatedMacRoot -Platform MacOS `
            -RegistrationRoot $simulatedMacRegistration -SkipActivation
        $simulatedPlistPath = Join-Path $simulatedMacRegistration "com.wordollama.desktopbridge.plist"
        [xml]$simulatedPlist = Get-Content -LiteralPath $simulatedPlistPath -Raw
        if ($simulatedPlist.plist.dict.string[0] -ne "com.wordollama.desktopbridge") {
            throw "Bridge package smoke: simulated macOS LaunchAgent XML is invalid."
        }
        & $unregisterAutostartScript -InstallRoot $simulatedMacRoot -Platform MacOS `
            -RegistrationRoot $simulatedMacRegistration -SkipDeactivation
    }
}

function Assert-HttpsProvisioning {
    param([Parameter(Mandatory = $true)][string]$Runtime)

    $installRoot = Join-Path $buildRootFullPath "install-smoke-$Runtime"
    $fixturePfx = Join-Path $buildRootFullPath "localhost-smoke.pfx"
    $rsa = [Security.Cryptography.RSA]::Create(2048)
    $certificate = $null
    try {
        $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
            "CN=localhost",
            $rsa,
            [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
        $san.AddDnsName("localhost")
        $san.AddIpAddress([Net.IPAddress]::Loopback)
        $request.CertificateExtensions.Add($san.Build())
        $certificate = $request.CreateSelfSigned(
            [DateTimeOffset]::UtcNow.AddMinutes(-5),
            [DateTimeOffset]::UtcNow.AddDays(1))
        [IO.File]::WriteAllBytes(
            $fixturePfx,
            $certificate.Export(
                [Security.Cryptography.X509Certificates.X509ContentType]::Pkcs12,
                "smoke-password"))
    }
    finally {
        if ($null -ne $certificate) { $certificate.Dispose() }
        $rsa.Dispose()
    }

    $securePassword = ConvertTo-SecureString "smoke-password" -AsPlainText -Force
    $unsafeEvidenceRejected = $false
    try {
        & $provisionHttpsScript -InstallRoot $installRoot -CertificatePath $fixturePfx `
            -CertificatePassword $securePassword -SkipTrustValidation -SkipSecretStoreWrite `
            -EvidencePath (Join-Path $buildRootFullPath "invalid-https-evidence.json")
    }
    catch {
        $unsafeEvidenceRejected = $_.Exception.Message -like "*cannot be written*"
    }
    if (-not $unsafeEvidenceRejected) {
        throw "Bridge package smoke: untrusted HTTPS fixture produced release evidence."
    }
    & $provisionHttpsScript -InstallRoot $installRoot -CertificatePath $fixturePfx `
        -CertificatePassword $securePassword -SkipTrustValidation -SkipSecretStoreWrite

    $currentVersion = (Get-Content -LiteralPath (Join-Path $installRoot "current-version") -Raw).Trim()
    $settingsPath = Join-Path $installRoot "versions/$currentVersion/appsettings.json"
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $installedPfx = Join-Path $installRoot "certs/bridge.pfx"
    if (-not (Test-Path -LiteralPath $installedPfx -PathType Leaf) -or
        [IO.Path]::GetFullPath($settings.Bridge.HttpsCertificate.Path) -ne
            [IO.Path]::GetFullPath($installedPfx) -or
        -not [string]::IsNullOrEmpty($settings.Bridge.HttpsCertificate.Password)) {
        throw "Bridge package smoke: HTTPS provisioning did not install the PFX with an empty JSON password."
    }
}

function Assert-UnsignedReleaseCannotFinalize {
    param([Parameter(Mandatory = $true)][string]$Runtime)

    $bridgeArchive = Join-Path $buildRootFullPath "WordOllama-Bridge-$version-$Runtime.zip"
    $bridgeArchiveHash = (Get-FileHash -LiteralPath $bridgeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    $bridgeArchiveSize = (Get-Item -LiteralPath $bridgeArchive).Length
    $descriptorPath = Join-Path $buildRootFullPath "unsigned-finalization-fixture.json"
    $outputPath = Join-Path $buildRootFullPath "must-not-be-release-ready.json"
    $fixtureInstallerPublisher = if ($Runtime -eq "win-x64") {
        "CN=Unsigned Smoke Must Fail"
    } else {
        "Developer ID Installer: Unsigned Smoke Must Fail (TEAMID)"
    }
    $descriptor = [ordered]@{
        schemaVersion = 1
        product = "WordOllama.JS"
        version = $version
        manifestVersion = "1.1.0.0"
        runtime = $Runtime
        addinOrigin = $smokeAddinOrigin
        bridgeOrigin = "https://127.0.0.1:37421"
        updateIndexUrl = $smokeUpdateIndexUrl
        expectedUpdatePublisherSubject = $fixtureInstallerPublisher
        generatedAt = [DateTimeOffset]::UtcNow.AddMinutes(-1).ToString("O")
        releaseReady = $false
        artifacts = @(
            [ordered]@{
                kind = "office-addin"
                path = $bridgeArchive
                sha256 = $bridgeArchiveHash
                sizeBytes = $bridgeArchiveSize
            },
            [ordered]@{
                kind = "desktop-bridge"
                path = $bridgeArchive
                sha256 = $bridgeArchiveHash
                sizeBytes = $bridgeArchiveSize
            }
        )
    }
    $descriptor | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $descriptorPath -Encoding utf8
    $rejected = $false
    try {
        & $finalizeReleaseScript -BuildDescriptorPath $descriptorPath `
            -HttpsEvidencePath (Join-Path $buildRootFullPath "missing-https.json") `
            -GoldenReportPath (Join-Path $buildRootFullPath "missing-golden.json") `
            -LongDocumentReportPath (Join-Path $buildRootFullPath "missing-long.json") `
            -RevisionReportPath (Join-Path $buildRootFullPath "missing-revisions.json") `
            -SupplementalHostReportPath (Join-Path $buildRootFullPath "missing-host.json") `
            -ExpectedPublisherSubject "CN=Unsigned Smoke Must Fail" `
            -ExpectedMacInstallerPublisherSubject $fixtureInstallerPublisher `
            -OutputPath $outputPath
    }
    catch {
        $rejected = $_.Exception.Message -like "*verification failed*" -or
            $_.Exception.Message -like "*Gatekeeper assessment failed*"
    }
    if (-not $rejected -or (Test-Path -LiteralPath $outputPath)) {
        throw "Bridge package smoke: unsigned artifacts reached releaseReady=true finalization."
    }

    $descriptor.artifacts[0].sha256 = ("0" * 64)
    $descriptor | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $descriptorPath -Encoding utf8
    $tamperedRejected = $false
    try {
        & $finalizeReleaseScript -BuildDescriptorPath $descriptorPath `
            -HttpsEvidencePath (Join-Path $buildRootFullPath "missing-https.json") `
            -GoldenReportPath (Join-Path $buildRootFullPath "missing-golden.json") `
            -LongDocumentReportPath (Join-Path $buildRootFullPath "missing-long.json") `
            -RevisionReportPath (Join-Path $buildRootFullPath "missing-revisions.json") `
            -SupplementalHostReportPath (Join-Path $buildRootFullPath "missing-host.json") `
            -ExpectedPublisherSubject "CN=Unsigned Smoke Must Fail" `
            -ExpectedMacInstallerPublisherSubject $fixtureInstallerPublisher `
            -OutputPath $outputPath
    }
    catch {
        $tamperedRejected = $_.Exception.Message -like "*Add-in artifact no longer matches the packaged build descriptor*"
    }
    if (-not $tamperedRejected -or (Test-Path -LiteralPath $outputPath)) {
        throw "Bridge package smoke: a post-package Add-in replacement reached release finalization."
    }
}

function Assert-MacSigningDryRun {
    $runtime = "osx-arm64"
    $fixtureVersion = "mac-signing-smoke"
    $fixtureDirectory = Join-Path $buildRootFullPath "$fixtureVersion-$runtime"
    New-Item -ItemType Directory -Force -Path $fixtureDirectory | Out-Null
    Set-Content -LiteralPath (Join-Path $fixtureDirectory "WordOllama.DesktopBridge") `
        -Value "single-file macOS signing fixture" -Encoding utf8NoBOM
    $fixtureArchive = Join-Path $buildRootFullPath `
        "WordOllama-Bridge-$fixtureVersion-$runtime.zip"
    Compress-Archive -Path (Join-Path $fixtureDirectory "*") `
        -DestinationPath $fixtureArchive -Force

    $output = (& $signScript -Runtime $runtime -ArtifactRoot $buildRootFullPath `
        -Version $fixtureVersion `
        -MacSigningIdentity "Developer ID Application: Dry Run (TEAMID)" `
        -MacNotaryProfile "wordollama-dry-run" `
        -MacNotaryKeychain "/tmp/wordollama.keychain-db" -DryRun *>&1) -join "`n"
    if ($output -notlike "*codesign*WordOllama.DesktopBridge*" -or
        $output -notlike "*notarytool submit*" -or
        $output -notlike "*--output-format json*" -or
        $output -notlike "*--keychain /tmp/wordollama.keychain-db*") {
        throw "Bridge package smoke: single-file macOS signing/notarization dry run is incomplete."
    }
}

function Assert-MacInstallerDryRun {
    $runtime = "osx-arm64"
    $fixtureVersion = "mac-installer-smoke"
    $fixtureDirectory = Join-Path $buildRootFullPath "$fixtureVersion-$runtime"
    if (Test-Path -LiteralPath $fixtureDirectory) {
        Remove-Item -LiteralPath $fixtureDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $fixtureDirectory | Out-Null
    Set-Content -LiteralPath (Join-Path $fixtureDirectory "WordOllama.DesktopBridge") `
        -Value "signed macOS Bridge fixture" -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $fixtureDirectory "appsettings.json") `
        -Value "{}" -Encoding utf8NoBOM
    Copy-Item -LiteralPath (Join-Path $smokeAddinStaticRoot "manifest.xml") `
        -Destination (Join-Path $fixtureDirectory "WordOllama.JS.xml")
    Copy-Item -LiteralPath $smokeAddinStaticRoot `
        -Destination (Join-Path $fixtureDirectory "wwwroot") -Recurse
    $fixtureArchive = Join-Path $buildRootFullPath `
        "WordOllama-Bridge-$fixtureVersion-$runtime.zip"
    Compress-Archive -Path (Join-Path $fixtureDirectory "*") `
        -DestinationPath $fixtureArchive -Force
    $archiveHash = (Get-FileHash -LiteralPath $fixtureArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    $bridgeEvidencePath = Join-Path $buildRootFullPath "mac-installer-bridge-notarization.json"
    [ordered]@{
        schemaVersion = 1
        kind = "apple-notarization"
        version = $fixtureVersion
        runtime = $runtime
        status = "Accepted"
        archiveSha256 = $archiveHash
        submissionId = "00000000-0000-0000-0000-000000000001"
    } | ConvertTo-Json | Set-Content -LiteralPath $bridgeEvidencePath -Encoding utf8

    $dryRunStagingPath = Join-Path $buildRootFullPath `
        ".$fixtureVersion-$runtime-installer-staging-fixture"
    $output = (& $macInstallerScript -Runtime $runtime `
        -ArtifactRoot $buildRootFullPath -Version $fixtureVersion `
        -MacInstallerIdentity "Developer ID Installer: Dry Run (TEAMID)" `
        -MacNotaryProfile "wordollama-dry-run" `
        -MacNotaryKeychain "/tmp/wordollama.keychain-db" `
        -BridgeNotarizationEvidencePath $bridgeEvidencePath `
        -DryRunStagingPath $dryRunStagingPath -DryRun *>&1) -join "`n"
    foreach ($requiredCommand in @(
        "pkgbuild",
        "productbuild",
        "Developer ID Installer: Dry Run (TEAMID)",
        "notarytool submit",
        "--keychain /tmp/wordollama.keychain-db",
        "stapler staple",
        "stapler validate",
        "spctl --assess --type install"
    )) {
        if ($output -notlike "*$requiredCommand*") {
            throw "Bridge package smoke: macOS installer dry run omitted '$requiredCommand'."
        }
    }
    $distribution = Get-Content -LiteralPath `
        (Join-Path $dryRunStagingPath "Distribution.xml") -Raw
    $launcher = Get-Content -LiteralPath `
        (Join-Path $dryRunStagingPath `
            "payload/Library/Application Support/WordOllama.JS/DesktopBridge/start-bridge") -Raw
    [xml]$launchAgent = Get-Content -LiteralPath `
        (Join-Path $dryRunStagingPath `
            "payload/Library/LaunchAgents/com.wordollama.desktopbridge.plist") -Raw
    $postinstall = Get-Content -LiteralPath `
        (Join-Path $dryRunStagingPath "scripts/postinstall") -Raw
    $uninstaller = Get-Content -LiteralPath `
        (Join-Path $dryRunStagingPath `
            "payload/Applications/WordOllama.JS/Uninstall WordOllama.JS Desktop Bridge.command") -Raw
    $setup = Get-Content -LiteralPath `
        (Join-Path $dryRunStagingPath `
            "payload/Applications/WordOllama.JS/Complete WordOllama.JS Setup.command") -Raw
    $uninstallerEnglish = Get-Content -LiteralPath `
        (Join-Path $dryRunStagingPath `
            "payload/Applications/WordOllama.JS/Uninstaller Resources/messages.en-US") -Raw
    $uninstallerChinese = Get-Content -LiteralPath `
        (Join-Path $dryRunStagingPath `
            "payload/Applications/WordOllama.JS/Uninstaller Resources/messages.zh-CN") -Raw
    if ($distribution -notlike '*enable_currentUserHome="true"*' -or
        $distribution -notlike '*enable_localSystem="false"*' -or
        $distribution -notlike '*hostArchitectures="arm64"*' -or
        $launcher -notlike '*certs/bridge.pfx*' -or
        $launcher -notlike '*current-version*' -or
        $launcher -notlike '*Bridge__HttpsCertificate__Path*' -or
        @($launchAgent.plist.dict.string)[0] -ne "com.wordollama.desktopbridge" -or
        $postinstall -notlike '*current.json*' -or
        $postinstall -notlike '*WordOllama.JS.xml*' -or
        $postinstall -notlike '*launchctl bootstrap*' -or
        $postinstall -notlike '*setup-required.txt*' -or
        $postinstall -notlike '*localhost:37421/health*' -or
        -not $setup.Contains('Continue? [y/N]') -or
        -not $setup.Contains('security add-trusted-cert -d -r trustAsRoot') -or
        -not $setup.Contains('subjectAltName=critical') -or
        -not $setup.Contains('https-certificate-secret set') -or
        -not $setup.Contains('localhost:37421/index.html') -or
        $uninstaller -notlike '*launchctl bootout*' -or
        $uninstaller -notlike '*WordOllama.JS.xml*' -or
        $uninstaller -notlike '*WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD*' -or
        $uninstaller -notlike '*security delete-certificate -Z*' -or
        $uninstaller -notlike '*pkgutil --forget com.wordollama.desktopbridge*' -or
        $uninstaller -notlike '*process_path*' -or
        $uninstaller -notlike '*rm -rf "$root"*' -or
        @($uninstallerEnglish -split "`n" |
            Where-Object { $_ -match '^[a-z_]+=' }).Count -ne 3 -or
        @($uninstallerChinese -split "`n" |
            Where-Object { $_ -match '^[a-z_]+=' }).Count -ne 3) {
        throw "Bridge package smoke: generated macOS current-user installer payload is invalid."
    }
    $resolvedDryRunStaging = (Resolve-Path -LiteralPath $dryRunStagingPath).Path
    $expectedDryRunStaging = [IO.Path]::GetFullPath($dryRunStagingPath)
    if ($resolvedDryRunStaging -ne $expectedDryRunStaging) {
        throw "Bridge package smoke: refusing to remove an unexpected installer fixture."
    }
    Remove-Item -LiteralPath $resolvedDryRunStaging -Recurse -Force
}

function Assert-WindowsInstallerLifecycle {
    if (-not $IsWindows) { return }

    [xml]$installerEnglish = Get-Content -LiteralPath `
        (Join-Path $repoRoot `
            "src/WordOllama.WindowsInstaller/Resources/InstallerMessages.resx") -Raw
    [xml]$installerChinese = Get-Content -LiteralPath `
        (Join-Path $repoRoot `
            "src/WordOllama.WindowsInstaller/Resources/InstallerMessages.zh-CN.resx") -Raw
    $englishKeys = @($installerEnglish.root.data.name | Sort-Object)
    $chineseKeys = @($installerChinese.root.data.name | Sort-Object)
    if (($englishKeys -join ",") -ne ($chineseKeys -join ",") -or
        $englishKeys.Count -ne 6) {
        throw "Bridge package smoke: Windows installer locales are incomplete or mismatched."
    }

    & $windowsInstallerScript -ArtifactRoot $buildRootFullPath `
        -Version $version -BuildUnsignedForTests
    $setupPath = Join-Path $buildRootFullPath `
        "WordOllama-Installer-$version-win-x64.exe"
    if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) {
        throw "Bridge package smoke: Windows setup executable was not built."
    }
    $installRoot = Join-Path $buildRootFullPath "windows-installer-lifecycle"
    $startupRoot = Join-Path $buildRootFullPath "windows-installer-startup"
    $arguments = @(
        "--quiet",
        "--no-start",
        "--skip-registration",
        "--install-root", $installRoot,
        "--startup-root", $startupRoot
    )
    foreach ($iteration in 1..2) {
        $process = Start-Process -FilePath $setupPath -ArgumentList $arguments `
            -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw "Bridge package smoke: Windows setup iteration $iteration failed."
        }
    }
    $state = Get-Content -LiteralPath (Join-Path $installRoot "current.json") `
        -Raw | ConvertFrom-Json
    $expectedArchiveHash = (Get-FileHash -LiteralPath `
        (Join-Path $buildRootFullPath "WordOllama-Bridge-$version-win-x64.zip") `
        -Algorithm SHA256).Hash.ToLowerInvariant()
    $startupScript = Join-Path $startupRoot `
        "WordOllama.JS Desktop Bridge.vbs"
    $launcher = Get-Content -LiteralPath `
        (Join-Path $installRoot "start-bridge.cmd") -Raw
    if ($state.currentVersion -ne $version -or
        $state.archiveSha256 -ne $expectedArchiveHash -or
        -not (Test-Path -LiteralPath `
            (Join-Path $installRoot "versions/$version/WordOllama.DesktopBridge.exe") `
            -PathType Leaf) -or
        -not (Test-Path -LiteralPath `
            (Join-Path $installRoot "versions/$version/WordOllama.JS.xml") `
            -PathType Leaf) -or
        -not (Test-Path -LiteralPath `
            (Join-Path $installRoot "versions/$version/wwwroot/index.html") `
            -PathType Leaf) -or
        -not (Test-Path -LiteralPath $startupScript -PathType Leaf) -or
        $launcher -notlike "*certs\bridge.pfx*" -or
        $launcher -notlike "*current-version*") {
        throw "Bridge package smoke: Windows setup payload or version state is invalid."
    }

    $uninstallArguments = @(
        "--quiet",
        "--uninstall",
        "--skip-registration",
        "--install-root", $installRoot,
        "--startup-root", $startupRoot
    )
    $uninstall = Start-Process -FilePath $setupPath `
        -ArgumentList $uninstallArguments -WindowStyle Hidden -Wait -PassThru
    if ($uninstall.ExitCode -ne 0 -or
        (Test-Path -LiteralPath $installRoot) -or
        (Test-Path -LiteralPath $startupScript)) {
        throw "Bridge package smoke: Windows setup uninstall did not remove owned artifacts."
    }
}

function Assert-NativeMacInstallerPackage {
    if (-not $IsMacOS) { return }

    & $macInstallerScript -Runtime $hostRuntime `
        -ArtifactRoot $buildRootFullPath -Version $version `
        -BuildUnsignedForTests
    $packagePath = Join-Path $buildRootFullPath `
        "WordOllama-Installer-$version-$hostRuntime.pkg"
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        throw "Bridge package smoke: native macOS PKG was not built."
    }
    $expanded = Join-Path $buildRootFullPath `
        "native-macos-installer-expanded"
    if (Test-Path -LiteralPath $expanded) {
        Remove-Item -LiteralPath $expanded -Recurse -Force
    }
    & /usr/sbin/pkgutil --expand-full $packagePath $expanded
    if ($LASTEXITCODE -ne 0) {
        throw "Bridge package smoke: pkgutil could not expand the native macOS PKG."
    }
    try {
        $distributionPath = Join-Path $expanded "Distribution"
        $distribution = Get-Content -LiteralPath $distributionPath -Raw
        $expectedArchitecture = if ($hostRuntime -eq "osx-arm64") {
            "arm64"
        } else { "x86_64" }
        $launchers = @(Get-ChildItem -LiteralPath $expanded -Recurse -File |
            Where-Object { $_.Name -eq "start-bridge" })
        $uninstallers = @(Get-ChildItem -LiteralPath $expanded -Recurse -File |
            Where-Object {
                $_.Name -eq "Uninstall WordOllama.JS Desktop Bridge.command"
            })
        $postinstalls = @(Get-ChildItem -LiteralPath $expanded -Recurse -File |
            Where-Object { $_.Name -eq "postinstall" })
        $launchAgents = @(Get-ChildItem -LiteralPath $expanded -Recurse -File |
            Where-Object { $_.Name -eq "com.wordollama.desktopbridge.plist" })
        $messageFiles = @(Get-ChildItem -LiteralPath $expanded -Recurse -File |
            Where-Object { $_.Name -in @("messages.en-US", "messages.zh-CN") })
        if ($distribution -notlike "*hostArchitectures=`"$expectedArchitecture`"*" -or
            $launchers.Count -ne 1 -or $uninstallers.Count -ne 1 -or
            $postinstalls.Count -ne 1 -or $launchAgents.Count -ne 1 -or
            $messageFiles.Count -ne 2) {
            throw "Bridge package smoke: expanded native macOS PKG payload is incomplete."
        }
        foreach ($scriptPath in @(
            $launchers[0].FullName,
            $uninstallers[0].FullName,
            $postinstalls[0].FullName
        )) {
            & /bin/sh -n $scriptPath
            if ($LASTEXITCODE -ne 0) {
                throw "Bridge package smoke: generated macOS script failed sh -n: $scriptPath"
            }
            & /usr/bin/test -x $scriptPath
            if ($LASTEXITCODE -ne 0) {
                throw "Bridge package smoke: generated macOS script is not executable: $scriptPath"
            }
        }
        & /usr/bin/plutil -lint $launchAgents[0].FullName
        if ($LASTEXITCODE -ne 0) {
            throw "Bridge package smoke: packaged LaunchAgent plist is invalid."
        }
    }
    finally {
        if (Test-Path -LiteralPath $expanded) {
            $resolvedExpanded = (Resolve-Path -LiteralPath $expanded).Path
            $expectedExpanded = [IO.Path]::GetFullPath($expanded)
            if ($resolvedExpanded -ne $expectedExpanded -or
                [IO.Path]::GetFileName($resolvedExpanded) -ne
                    "native-macos-installer-expanded") {
                throw "Refusing to remove an unexpected expanded macOS package path."
            }
            Remove-Item -LiteralPath $resolvedExpanded -Recurse -Force
        }
    }
}

$invalidAddinOriginRejected = $false
try {
    & $publishScript -Runtime $hostRuntime -Configuration $Configuration `
        -Version $version -OutputRoot $buildRootFullPath -AddinOrigin "http://example.com"
}
catch {
    $invalidAddinOriginRejected = $_.Exception.Message -like "*AddinOrigin must be*"
}
if (-not $invalidAddinOriginRejected) {
    throw "Bridge package smoke: insecure Add-in origin was accepted."
}

$invalidUpdateIndexRejected = $false
try {
    & $publishScript -Runtime $hostRuntime -Configuration $Configuration `
        -Version $version -OutputRoot $buildRootFullPath `
        -AddinOrigin $smokeAddinOrigin -UpdateIndexUrl "https://127.0.0.1/update.json"
}
catch {
    $invalidUpdateIndexRejected = $_.Exception.Message -like "*UpdateIndexUrl must be*"
}
if (-not $invalidUpdateIndexRejected) {
    throw "Bridge package smoke: loopback update index was accepted."
}

$missingUpdatePublisherRejected = $false
try {
    & $publishScript -Runtime $hostRuntime -Configuration $Configuration `
        -Version $version -OutputRoot $buildRootFullPath `
        -AddinOrigin $smokeAddinOrigin -UpdateIndexUrl $smokeUpdateIndexUrl
}
catch {
    $missingUpdatePublisherRejected =
        $_.Exception.Message -like "*ExpectedUpdatePublisherSubject is required*"
}
if (-not $missingUpdatePublisherRejected) {
    throw "Bridge package smoke: configured updates accepted an empty pinned publisher."
}

$guardRuntime = if ($hostRuntime -eq "win-x64") { "osx-arm64" } else { "win-x64" }
$targetGuardPassed = $false
try {
    & $publishScript -Runtime $guardRuntime -Configuration $Configuration `
        -Version $version -OutputRoot $buildRootFullPath `
        -AddinOrigin $smokeAddinOrigin -UpdateIndexUrl $smokeUpdateIndexUrl `
        -ExpectedUpdatePublisherSubject $smokeUpdatePublisherSubject
}
catch {
    $targetGuardPassed = $_.Exception.Message -like "*must run on its target OS*"
}
if (-not $targetGuardPassed) {
    throw "Bridge package smoke: target-OS archive guard failed."
}

& $publishScript -Runtime $hostRuntime -Configuration $Configuration `
    -Version $version -OutputRoot $buildRootFullPath `
    -AddinOrigin $smokeAddinOrigin -UpdateIndexUrl $smokeUpdateIndexUrl `
    -ExpectedUpdatePublisherSubject $smokeUpdatePublisherSubject `
    -AddinStaticRoot $smokeAddinStaticRoot
Assert-PublishDirectory -Runtime $hostRuntime -ExpectArchive $true
if ($hostRuntime -eq "win-x64") {
    $untimestampedSigningRejected = $false
    try {
        & $signScript -Runtime $hostRuntime -ArtifactRoot $buildRootFullPath `
            -Version $version -WindowsCertificateThumbprint ("0" * 40) -TimestampUrl ""
    }
    catch {
        $untimestampedSigningRejected = $_.Exception.Message -like "*requires an RFC 3161*"
    }
    if (-not $untimestampedSigningRejected) {
        throw "Bridge package smoke: Windows signing accepted an empty timestamp URL without its explicit test switch."
    }
    $installerSource = Get-Content -LiteralPath $installScript -Raw
    $finalizerSource = Get-Content -LiteralPath $finalizeReleaseScript -Raw
    $signerSource = Get-Content -LiteralPath $signScript -Raw
    $macInstallerSource = Get-Content -LiteralPath $macInstallerScript -Raw
    $windowsInstallerSource = Get-Content -LiteralPath $windowsInstallerScript -Raw
    $windowsInstallerProgram = Get-Content -LiteralPath `
        (Join-Path $repoRoot "src/WordOllama.WindowsInstaller/Program.cs") -Raw
    if ($windowsInstallerProgram -notmatch 'SubjectAlternativeNameBuilder' -or
        $windowsInstallerProgram -notmatch 'IPAddress\.IPv6Loopback' -or
        $windowsInstallerProgram -notmatch 'StoreName\.Root, StoreLocation\.CurrentUser' -or
        $windowsInstallerProgram -notmatch 'ownership\.json' -or
        $windowsInstallerProgram -notmatch 'https-certificate-secret') {
        throw "Bridge package smoke: Windows installer lacks owned current-user localhost certificate provisioning."
    }
    if ($installerSource -notmatch "TimeStamperCertificate" -or
        $finalizerSource -notmatch "TimeStamperCertificate") {
        throw "Bridge package smoke: production install/finalization does not require an Authenticode timestamp."
    }
    if ($finalizerSource -notmatch "sourceDescriptorSha256" -or
        $finalizerSource -notmatch "sourceArtifacts" -or
        $finalizerSource -notmatch "signingTransition" -or
        $finalizerSource -notmatch "actualBridgeHash") {
        throw "Bridge package smoke: release finalization does not preserve the unsigned-to-signed artifact chain."
    }
    if ($signerSource -notmatch '\.dylib' -or
        $signerSource -notmatch 'nativeLibraries' -or
        $signerSource -notmatch 'verify sealed macOS Bridge' -or
        $signerSource -notmatch 'MacNotaryKeychain' -or
        $signerSource -notmatch 'apple-notarization' -or
        $signerSource -notmatch 'notarization log' -or
        $finalizerSource -notmatch 'MacNotarizationEvidencePath' -or
        $finalizerSource -notmatch 'MacInstallerEvidencePath' -or
        $finalizerSource -notmatch 'WindowsInstallerEvidencePath' -or
        $finalizerSource -notmatch 'desktop-bridge-installer' -or
        $signerSource -notmatch '"--keychain"') {
        throw "Bridge package smoke: macOS signing does not seal native runtime libraries before the Bridge executable."
    }
    if ($macInstallerSource -notmatch 'Developer ID Installer:' -or
        $macInstallerSource -notmatch 'enable_currentUserHome="true"' -or
        $macInstallerSource -notmatch 'pkgbuild' -or
        $macInstallerSource -notmatch 'productbuild' -or
        $macInstallerSource -notmatch 'stapler", "staple' -or
        $macInstallerSource -notmatch '"--type", "install"' -or
        $macInstallerSource -notmatch 'apple-installer-package' -or
        $macInstallerSource -notmatch 'certs/bridge\.pfx' -or
        $macInstallerSource -notmatch 'WordOllama\.JS/WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD' -or
        $macInstallerSource -notmatch 'WordOllama\.JS\.xml' -or
        $macInstallerSource -notmatch '-a "\$\(id -un\)"' -or
        $macInstallerSource -match 'WordOllama/WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD' -or
        $macInstallerSource -notmatch 'BuildUnsignedForTests' -or
        $macInstallerSource -notmatch 'Uninstall WordOllama\.JS Desktop Bridge\.command') {
        throw "Bridge package smoke: macOS current-user PKG release workflow is incomplete."
    }
    if ($windowsInstallerSource -notmatch 'windows-installer-package' -or
        $windowsInstallerSource -notmatch 'signtool\.exe' -or
        $windowsInstallerSource -notmatch 'TimeStamperCertificate' -or
        $windowsInstallerSource -notmatch 'BuildUnsignedForTests') {
        throw "Bridge package smoke: Windows signed EXE installer workflow is incomplete."
    }
    if ($windowsInstallerProgram -notmatch 'Registry\.CurrentUser' -or
        $windowsInstallerProgram -notmatch 'OfficeAddinRegistryPath' -or
        $windowsInstallerProgram -notmatch 'WordOllama\.JS\.xml' -or
        $windowsInstallerProgram -notmatch 'UninstallString' -or
        $windowsInstallerProgram -notmatch 'IsTestBuild' -or
        $windowsInstallerProgram -notmatch 'MoveFileEx' -or
        $windowsInstallerProgram -notmatch 'WordOllama\.JS/WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD' -or
        $windowsInstallerProgram -match 'WordOllama/WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD' -or
        $windowsInstallerProgram -notmatch 'CredDelete' -or
        $windowsInstallerProgram -notmatch 'LocalApplicationData') {
        throw "Bridge package smoke: Windows per-user registration or restricted self-cleanup is incomplete."
    }
}
Assert-InstallAndRollback -Runtime $hostRuntime
Assert-HttpsProvisioning -Runtime $hostRuntime
Assert-AutostartArtifacts -Runtime $hostRuntime
Assert-UnsignedReleaseCannotFinalize -Runtime $hostRuntime
Assert-MacSigningDryRun
Assert-MacInstallerDryRun
Assert-WindowsInstallerLifecycle
Assert-NativeMacInstallerPackage

if ($IncludeCrossBuilds) {
    foreach ($runtime in @("win-x64", "osx-arm64", "osx-x64")) {
        if ($runtime -eq $hostRuntime) { continue }
        & $publishScript -Runtime $runtime -Configuration $Configuration `
            -Version $version -OutputRoot $buildRootFullPath -CrossBuildOnly `
            -AddinOrigin $smokeAddinOrigin -UpdateIndexUrl $smokeUpdateIndexUrl `
            -ExpectedUpdatePublisherSubject $smokeUpdatePublisherSubject `
            -AddinStaticRoot $smokeAddinStaticRoot
        Assert-PublishDirectory -Runtime $runtime -ExpectArchive $false
    }
}
Assert-PackagedBridgeFailsClosed -Runtime $hostRuntime

Write-Host "Bridge package smoke passed for host runtime $hostRuntime."
