param(
    [ValidateSet("win-x64", "osx-arm64", "linux-x64")]
    [string]$Runtime = "win-x64",
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [ValidatePattern("^[0-9A-Za-z][0-9A-Za-z._-]*$")]
    [string]$Version = "0.1.0",
    [string]$AddinOrigin = "https://localhost:37421",
    [string]$AddinStaticRoot = "",
    [string]$UpdateIndexUrl = "",
    [string]$ExpectedUpdatePublisherSubject = "",
    [string]$OutputRoot = "",
    [switch]$CrossBuildOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
$project = Join-Path $repoRoot "src\WordOllama.DesktopBridge\WordOllama.DesktopBridge.csproj"
$targetIsMac = $Runtime.StartsWith("osx-", [StringComparison]::Ordinal)
$targetIsLinux = $Runtime.StartsWith("linux-", [StringComparison]::Ordinal)

[Uri]$addinUri = $null
if (-not [Uri]::TryCreate($AddinOrigin, [UriKind]::Absolute, [ref]$addinUri) -or
    ($addinUri.Scheme -ne [Uri]::UriSchemeHttps -and
     -not ($targetIsLinux -and
           $addinUri.Scheme -eq [Uri]::UriSchemeHttp -and
           $addinUri.IsLoopback)) -or
    -not [string]::IsNullOrEmpty($addinUri.UserInfo) -or
    -not [string]::IsNullOrEmpty($addinUri.Query) -or
    -not [string]::IsNullOrEmpty($addinUri.Fragment) -or
    $addinUri.AbsolutePath -ne "/") {
    throw "AddinOrigin must be HTTPS, except for loopback HTTP in the Linux WPS runtime."
}
$productionAddinOrigin = $addinUri.GetLeftPart([UriPartial]::Authority)
if ($addinUri.IsLoopback -and [string]::IsNullOrWhiteSpace($AddinStaticRoot)) {
    throw "A loopback AddinOrigin requires AddinStaticRoot so the Bridge can host the Office.js frontend."
}

$productionUpdateIndexUrl = ""
if (-not [string]::IsNullOrWhiteSpace($UpdateIndexUrl)) {
    [Uri]$updateUri = $null
    if (-not [Uri]::TryCreate($UpdateIndexUrl, [UriKind]::Absolute, [ref]$updateUri) -or
        $updateUri.Scheme -ne [Uri]::UriSchemeHttps -or
        $updateUri.IsLoopback -or
        -not [string]::IsNullOrEmpty($updateUri.UserInfo) -or
        -not [string]::IsNullOrEmpty($updateUri.Fragment)) {
        throw "UpdateIndexUrl must be a non-loopback HTTPS URL without credentials or a fragment."
    }
    $productionUpdateIndexUrl = $updateUri.AbsoluteUri
}
$productionUpdatePublisherSubject = $ExpectedUpdatePublisherSubject.Trim()
if (-not [string]::IsNullOrWhiteSpace($productionUpdateIndexUrl) -and
    [string]::IsNullOrWhiteSpace($productionUpdatePublisherSubject)) {
    throw "ExpectedUpdatePublisherSubject is required when UpdateIndexUrl is configured."
}
if ($productionUpdatePublisherSubject.Length -gt 512 -or
    $productionUpdatePublisherSubject.IndexOfAny([char[]]"`r`n") -ge 0) {
    throw "ExpectedUpdatePublisherSubject is invalid."
}

$runtimeHostMatches = ($Runtime -eq "win-x64" -and $IsWindows) -or
    ($targetIsMac -and $IsMacOS) -or
    ($targetIsLinux -and $IsLinux)
if (-not $runtimeHostMatches -and -not $CrossBuildOnly) {
    throw "Final $Runtime packaging must run on its target OS. Use -CrossBuildOnly to verify compilation without creating a release archive."
}

$configurationTemplateName = if ($targetIsMac) {
    "production.appsettings.macos.template.json"
} elseif ($targetIsLinux) {
    "production.appsettings.linux.template.json"
} else {
    "production.appsettings.windows.template.json"
}
$configurationTemplate = Join-Path $PSScriptRoot $configurationTemplateName
if (-not (Test-Path -LiteralPath $configurationTemplate -PathType Leaf)) {
    throw "Production configuration template is missing: $configurationTemplate"
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot "artifacts\bridge"
}
$outputRootFullPath = [System.IO.Path]::GetFullPath($OutputRoot)
$output = [System.IO.Path]::GetFullPath((Join-Path $outputRootFullPath "$Version-$Runtime"))
$expectedPrefix = $outputRootFullPath.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $output.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Version output must stay under OutputRoot."
}
$archiveExtension = if ($targetIsLinux) { ".tar.gz" } else { ".zip" }
$archive = Join-Path $outputRootFullPath "WordOllama-Bridge-$Version-$Runtime$archiveExtension"

if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
}
if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
}
New-Item -ItemType Directory -Force -Path $output | Out-Null

& dotnet publish $project -c $Configuration -r $Runtime --self-contained true `
    -p:InformationalVersion=$Version -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $output
if ($LASTEXITCODE -ne 0) {
    throw "Desktop Bridge publish failed with exit code $LASTEXITCODE."
}

$executableName = if ($Runtime -eq "win-x64") {
    "WordOllama.DesktopBridge.exe"
} else {
    "WordOllama.DesktopBridge"
}
$executablePath = Join-Path $output $executableName
if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw "Published Bridge executable is missing: $executablePath"
}

$legalOutput = Join-Path $output "legal"
New-Item -ItemType Directory -Force -Path $legalOutput | Out-Null
foreach ($legalFile in @(
    @{ Source = "LICENSE"; Destination = "LICENSE.txt" },
    @{ Source = "NOTICE"; Destination = "NOTICE.txt" },
    @{ Source = "SOURCE.md"; Destination = "SOURCE.md" },
    @{ Source = "PRIVACY.md"; Destination = "PRIVACY.md" },
    @{ Source = "docs\THIRD-PARTY-NOTICES.md"; Destination = "THIRD-PARTY-NOTICES.md" }
)) {
    $sourcePath = Join-Path $repoRoot $legalFile.Source
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required legal document is missing: $sourcePath"
    }
    Copy-Item -LiteralPath $sourcePath `
        -Destination (Join-Path $legalOutput $legalFile.Destination) -Force
}

$sdkLines = @(& dotnet --list-sdks)
if ($LASTEXITCODE -ne 0 -or $sdkLines.Count -eq 0) {
    throw "Could not locate the .NET SDK legal notices."
}
$selectedSdkVersion = (& dotnet --version).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($selectedSdkVersion)) {
    throw "Could not identify the selected .NET SDK version."
}
$sdkLine = $sdkLines |
    Where-Object { $_.StartsWith("$selectedSdkVersion ", [StringComparison]::Ordinal) } |
    Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($sdkLine)) {
    throw "Could not find selected .NET SDK $selectedSdkVersion in dotnet --list-sdks."
}
if ($sdkLine -notmatch '\[(.+)\]\s*$') {
    throw "Could not parse the .NET SDK location from: $sdkLine"
}
$dotnetRoot = Split-Path -Parent $Matches[1]
$dotnetLegalOutput = Join-Path $legalOutput "dotnet"
New-Item -ItemType Directory -Force -Path $dotnetLegalOutput | Out-Null
foreach ($dotnetLegalFile in @("LICENSE.txt", "ThirdPartyNotices.txt")) {
    $sourcePath = Join-Path $dotnetRoot $dotnetLegalFile
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "The .NET redistribution notice is missing: $sourcePath"
    }
    Copy-Item -LiteralPath $sourcePath -Destination $dotnetLegalOutput -Force
}

$activeSettingsPath = Join-Path $output "appsettings.json"
Copy-Item -LiteralPath $configurationTemplate -Destination $activeSettingsPath -Force
$productionSettings = Get-Content -LiteralPath $activeSettingsPath -Raw | ConvertFrom-Json
$productionSettings.Bridge.AllowedOrigins = @($productionAddinOrigin)
$productionSettings.Bridge.Updates.IndexUrl = $productionUpdateIndexUrl
$productionSettings.Bridge.Updates.ExpectedPublisherSubject = $productionUpdatePublisherSubject
$settingsTemp = "$activeSettingsPath.$([Guid]::NewGuid().ToString('N')).tmp"
$productionSettings | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath $settingsTemp -Encoding utf8
Move-Item -LiteralPath $settingsTemp -Destination $activeSettingsPath -Force
if ((-not $targetIsLinux -and
     ($productionSettings.Bridge.Urls -notlike "https://*" -or
      [string]::IsNullOrWhiteSpace($productionSettings.Bridge.HttpsCertificate.Path))) -or
    ($targetIsLinux -and
     ($productionSettings.Bridge.Urls -ne "http://127.0.0.1:37421" -or
      -not [string]::IsNullOrWhiteSpace($productionSettings.Bridge.HttpsCertificate.Path) -or
      $productionAddinOrigin -ne "http://127.0.0.1:37421")) -or
    $productionSettings.Bridge.LocalTools.AllowHttpRequests -ne $false -or
    @($productionSettings.Bridge.AllowedOrigins).Count -ne 1 -or
    $productionSettings.Bridge.AllowedOrigins[0] -ne $productionAddinOrigin -or
    $productionSettings.Bridge.Updates.IndexUrl -ne $productionUpdateIndexUrl -or
    $productionSettings.Bridge.Updates.ExpectedPublisherSubject -ne
        $productionUpdatePublisherSubject) {
    throw "Published Bridge production settings failed the platform transport/security invariant."
}

if (-not [string]::IsNullOrWhiteSpace($AddinStaticRoot)) {
    $addinStaticRootFullPath = (Resolve-Path -LiteralPath $AddinStaticRoot).Path
    foreach ($requiredFile in @(
        "index.html",
        "settings.html",
        "commands.html",
        "manifest.xml",
        "wps.html",
        "wps-addin/index.html",
        "wps-addin/main.js",
        "wps-addin/ribbon.xml",
        "legal/LICENSE.txt",
        "legal/NOTICE.txt",
        "legal/SOURCE.md",
        "legal/PRIVACY.md",
        "legal/THIRD-PARTY-NOTICES.md",
        "legal/THIRD-PARTY-LICENSES.txt"
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $addinStaticRootFullPath $requiredFile) -PathType Leaf)) {
            throw "Packaged Add-in static root is missing $requiredFile."
        }
    }
    $addinAssets = Join-Path $addinStaticRootFullPath "assets"
    if (-not (Test-Path -LiteralPath $addinAssets -PathType Container)) {
        throw "Packaged Add-in static root is missing its assets directory."
    }

    $webRoot = Join-Path $output "wwwroot"
    New-Item -ItemType Directory -Force -Path $webRoot | Out-Null
    foreach ($entry in Get-ChildItem -LiteralPath $addinStaticRootFullPath -Force) {
        if ($entry.Name -eq "manifest.xml") {
            continue
        }
        Copy-Item -LiteralPath $entry.FullName -Destination $webRoot -Recurse -Force
    }
    Copy-Item -LiteralPath (Join-Path $addinStaticRootFullPath "manifest.xml") `
        -Destination (Join-Path $output "WordOllama.JS.xml") -Force
    Copy-Item -LiteralPath `
        (Join-Path $addinStaticRootFullPath "legal\THIRD-PARTY-LICENSES.txt") `
        -Destination (Join-Path $legalOutput "frontend-THIRD-PARTY-LICENSES.txt") -Force
}

if ($CrossBuildOnly) {
    Write-Host "Cross-build verified without release archive: $output"
    return
}

if ($targetIsMac) {
    $ditto = Get-Command "ditto" -ErrorAction SilentlyContinue
    if ($null -eq $ditto) {
        throw "Final macOS packaging requires 'ditto' to preserve executable permissions and resource metadata."
    }
    & $ditto.Source -c -k --sequesterRsrc $output $archive
    if ($LASTEXITCODE -ne 0) {
        throw "ditto failed with exit code $LASTEXITCODE."
    }
} elseif ($targetIsLinux) {
    $tar = Get-Command "tar" -ErrorAction SilentlyContinue
    if ($null -eq $tar) {
        throw "Final Linux packaging requires 'tar' on PATH."
    }
    & $tar.Source -czf $archive -C $output .
    if ($LASTEXITCODE -ne 0) {
        throw "tar failed with exit code $LASTEXITCODE."
    }
} else {
    Compress-Archive -Path (Join-Path $output "*") -DestinationPath $archive -Force
}
Write-Host "Published $archive"
