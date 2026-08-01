param(
    [ValidateSet("win-x64", "osx-arm64")]
    [string]$Runtime = "win-x64",
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [ValidatePattern("^[0-9A-Za-z][0-9A-Za-z._-]*$")]
    [string]$Version = "0.1.0",
    [ValidatePattern("^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$")]
    [string]$ManifestVersion = "1.2.0.0",
    [string]$BaseUrl = "https://localhost:37421",
    [string]$BridgeUrl = "https://localhost:37421",
    [string]$UpdateIndexUrl = "",
    [string]$ExpectedUpdatePublisherSubject = "",
    [string]$OutputRoot = "",
    [switch]$CrossBuildOnly,
    [switch]$SkipManifestValidation
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot "artifacts\unified"
}
$outputRootFullPath = [IO.Path]::GetFullPath($OutputRoot)
$addinOutput = Join-Path $outputRootFullPath "addin"
$bridgeOutput = Join-Path $outputRootFullPath "bridge"
$packageAddin = Join-Path $PSScriptRoot "package-addin.ps1"
$publishBridge = Join-Path $PSScriptRoot "publish-bridge.ps1"

[Uri]$baseUri = $null
if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$baseUri)) {
    throw "BaseUrl is not a valid absolute URL."
}
$addinOrigin = $baseUri.GetLeftPart([UriPartial]::Authority)
$normalizedUpdateIndexUrl = if ([string]::IsNullOrWhiteSpace($UpdateIndexUrl)) {
    ""
} else {
    ([Uri]$UpdateIndexUrl).AbsoluteUri
}

& $packageAddin -BaseUrl $BaseUrl -BridgeUrl $BridgeUrl `
    -Version $Version -ManifestVersion $ManifestVersion `
    -OutputRoot $addinOutput -SkipManifestValidation:$SkipManifestValidation
$addinStaticRoot = Join-Path $addinOutput $Version
& $publishBridge -Runtime $Runtime -Configuration $Configuration `
    -Version $Version -AddinOrigin $addinOrigin -UpdateIndexUrl $UpdateIndexUrl `
    -ExpectedUpdatePublisherSubject $ExpectedUpdatePublisherSubject `
    -OutputRoot $bridgeOutput -AddinStaticRoot $addinStaticRoot `
    -CrossBuildOnly:$CrossBuildOnly

$addinArchive = Join-Path $addinOutput "WordOllama.JS-Addin-$Version.zip"
$bridgeDirectory = Join-Path $bridgeOutput "$Version-$Runtime"
$bridgeArchive = Join-Path $bridgeOutput "WordOllama-Bridge-$Version-$Runtime.zip"
if (-not (Test-Path -LiteralPath $addinArchive -PathType Leaf) -or
    -not (Test-Path -LiteralPath $bridgeDirectory -PathType Container)) {
    throw "Unified packaging did not produce the Add-in archive and Bridge runtime directory."
}
if ($CrossBuildOnly) {
    if (Test-Path -LiteralPath $bridgeArchive) {
        throw "CrossBuildOnly unexpectedly produced a Bridge release archive."
    }
    Write-Host "Unified cross-build verified for $Runtime; no release descriptor was created."
    return
}
if (-not (Test-Path -LiteralPath $bridgeArchive -PathType Leaf)) {
    throw "Unified packaging did not produce the Bridge release archive."
}

$bridgeSettings = Get-Content -LiteralPath (Join-Path $bridgeDirectory "appsettings.json") -Raw |
    ConvertFrom-Json
if (@($bridgeSettings.Bridge.AllowedOrigins).Count -ne 1 -or
    $bridgeSettings.Bridge.AllowedOrigins[0] -ne $addinOrigin -or
    $bridgeSettings.Bridge.Updates.IndexUrl -ne $normalizedUpdateIndexUrl -or
    $bridgeSettings.Bridge.Updates.ExpectedPublisherSubject -ne
        $ExpectedUpdatePublisherSubject.Trim()) {
    throw "Unified packaging detected an Add-in origin or update-index mismatch in Bridge settings."
}

$descriptor = [ordered]@{
    schemaVersion = 1
    product = "WordOllama.JS"
    version = $Version
    manifestVersion = $ManifestVersion
    runtime = $Runtime
    addinOrigin = $addinOrigin
    bridgeOrigin = ([Uri]$BridgeUrl).GetLeftPart([UriPartial]::Authority)
    updateIndexUrl = $normalizedUpdateIndexUrl
    expectedUpdatePublisherSubject = $ExpectedUpdatePublisherSubject.Trim()
    generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
    releaseReady = $false
    requiredNextSteps = @(
        "Sign and verify the Bridge binary/archive and build the signed per-user installer on the target operating system.",
        "Provision a trusted localhost HTTPS PFX through provision-bridge-https.ps1.",
        "Run the real Word host release checklist on this runtime."
    )
    artifacts = @(
        [ordered]@{
            kind = "office-addin"
            path = $addinArchive
            sha256 = (Get-FileHash -LiteralPath $addinArchive -Algorithm SHA256).Hash.ToLowerInvariant()
            sizeBytes = (Get-Item -LiteralPath $addinArchive).Length
        },
        [ordered]@{
            kind = "desktop-bridge"
            path = $bridgeArchive
            sha256 = (Get-FileHash -LiteralPath $bridgeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
            sizeBytes = (Get-Item -LiteralPath $bridgeArchive).Length
        }
    )
}
$descriptorPath = Join-Path $outputRootFullPath "unified-build-$Version-$Runtime.json"
New-Item -ItemType Directory -Force -Path $outputRootFullPath | Out-Null
$descriptorTemp = "$descriptorPath.$([Guid]::NewGuid().ToString('N')).tmp"
$descriptor | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $descriptorTemp -Encoding utf8
Move-Item -LiteralPath $descriptorTemp -Destination $descriptorPath -Force
Write-Host "Created unsigned unified build descriptor $descriptorPath"
