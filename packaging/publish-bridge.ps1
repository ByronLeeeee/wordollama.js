param(
    [ValidateSet("win-x64", "osx-arm64", "osx-x64")]
    [string]$Runtime = "win-x64",
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [ValidatePattern("^[0-9A-Za-z][0-9A-Za-z._-]*$")]
    [string]$Version = "0.1.0",
    [string]$AddinOrigin = "https://addin.wordollama.com",
    [string]$UpdateIndexUrl = "",
    [string]$ExpectedUpdatePublisherSubject = "",
    [string]$OutputRoot = "",
    [switch]$CrossBuildOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
$project = Join-Path $repoRoot "src\WordOllama.DesktopBridge\WordOllama.DesktopBridge.csproj"

[Uri]$addinUri = $null
if (-not [Uri]::TryCreate($AddinOrigin, [UriKind]::Absolute, [ref]$addinUri) -or
    $addinUri.Scheme -ne [Uri]::UriSchemeHttps -or
    $addinUri.IsLoopback -or
    -not [string]::IsNullOrEmpty($addinUri.UserInfo) -or
    -not [string]::IsNullOrEmpty($addinUri.Query) -or
    -not [string]::IsNullOrEmpty($addinUri.Fragment) -or
    $addinUri.AbsolutePath -ne "/") {
    throw "AddinOrigin must be a non-loopback HTTPS origin without credentials, path, query, or fragment."
}
$productionAddinOrigin = $addinUri.GetLeftPart([UriPartial]::Authority)

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

$targetIsMac = $Runtime.StartsWith("osx-", [StringComparison]::Ordinal)
$runtimeHostMatches = ($Runtime -eq "win-x64" -and $IsWindows) -or ($targetIsMac -and $IsMacOS)
if (-not $runtimeHostMatches -and -not $CrossBuildOnly) {
    throw "Final $Runtime packaging must run on its target OS. Use -CrossBuildOnly to verify compilation without creating a release archive."
}

$configurationTemplateName = if ($targetIsMac) {
    "production.appsettings.macos.template.json"
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
$archive = Join-Path $outputRootFullPath "WordOllama-Bridge-$Version-$Runtime.zip"

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
if ($productionSettings.Bridge.Urls -notlike "https://*" -or
    [string]::IsNullOrWhiteSpace($productionSettings.Bridge.HttpsCertificate.Path) -or
    $productionSettings.Bridge.LocalTools.AllowHttpRequests -ne $false -or
    @($productionSettings.Bridge.AllowedOrigins).Count -ne 1 -or
    $productionSettings.Bridge.AllowedOrigins[0] -ne $productionAddinOrigin -or
    $productionSettings.Bridge.Updates.IndexUrl -ne $productionUpdateIndexUrl -or
    $productionSettings.Bridge.Updates.ExpectedPublisherSubject -ne
        $productionUpdatePublisherSubject) {
    throw "Published Bridge production settings failed the HTTPS/security invariant."
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
}
else {
    Compress-Archive -Path (Join-Path $output "*") -DestinationPath $archive -Force
}
Write-Host "Published $archive"
