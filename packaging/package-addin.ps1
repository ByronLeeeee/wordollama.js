param(
    [string]$BaseUrl = "https://localhost:37421",
    [string]$BridgeUrl = "https://localhost:37421",
    [ValidatePattern("^[0-9A-Za-z][0-9A-Za-z._-]*$")]
    [string]$Version = "0.1.0",
    [ValidatePattern("^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$")]
    [string]$ManifestVersion = "1.2.0.0",
    [string]$OutputRoot = "",
    [switch]$SkipManifestValidation
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
$addinRoot = Join-Path $repoRoot "officejs\apps\addin"

[Uri]$baseUri = $null
if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$baseUri) -or
    $baseUri.Scheme -ne [Uri]::UriSchemeHttps -or
    -not [string]::IsNullOrEmpty($baseUri.UserInfo) -or
    -not [string]::IsNullOrEmpty($baseUri.Query) -or
    -not [string]::IsNullOrEmpty($baseUri.Fragment) -or
    $baseUri.AbsolutePath -ne "/") {
    throw "BaseUrl must be an HTTPS origin without credentials, path, query, or fragment."
}

[Uri]$bridgeUri = $null
if (-not [Uri]::TryCreate($BridgeUrl, [UriKind]::Absolute, [ref]$bridgeUri) -or
    $bridgeUri.Scheme -ne [Uri]::UriSchemeHttps -or
    -not $bridgeUri.IsLoopback -or
    -not [string]::IsNullOrEmpty($bridgeUri.UserInfo) -or
    -not [string]::IsNullOrEmpty($bridgeUri.Query) -or
    -not [string]::IsNullOrEmpty($bridgeUri.Fragment) -or
    $bridgeUri.AbsolutePath -ne "/") {
    throw "BridgeUrl must be a loopback HTTPS origin without credentials, path, query, or fragment."
}
$productionBridgeUrl = $bridgeUri.GetLeftPart([UriPartial]::Authority)
$productionAddinUrl = $baseUri.GetLeftPart([UriPartial]::Authority)
if ($baseUri.IsLoopback -and
    -not $productionAddinUrl.Equals($productionBridgeUrl, [StringComparison]::OrdinalIgnoreCase)) {
    throw "A loopback Add-in BaseUrl must use the same origin as BridgeUrl."
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot "artifacts\addin"
}
$outputRootFullPath = [System.IO.Path]::GetFullPath($OutputRoot)
$output = [System.IO.Path]::GetFullPath((Join-Path $outputRootFullPath $Version))
$expectedPrefix = $outputRootFullPath.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $output.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Version output must stay under OutputRoot."
}
if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $output | Out-Null

$npmInfo = Get-Command npm.cmd -ErrorAction SilentlyContinue
$npmCommand = if ($null -ne $npmInfo) { $npmInfo.Source } else { "npm" }

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

$previousBridgeUrl = $env:WORDOLLAMA_BRIDGE_URL
$previousAddinVersion = $env:WORDOLLAMA_ADDIN_VERSION
$env:WORDOLLAMA_BRIDGE_URL = $productionBridgeUrl
$env:WORDOLLAMA_ADDIN_VERSION = $ManifestVersion
Push-Location $addinRoot
try {
    Invoke-Checked -Command $npmCommand -Arguments @("run", "build") -Label "Office.js TypeScript build"
    Invoke-Checked -Command $npmCommand -Arguments @("run", "bundle") -Label "Office.js Vite bundle"
}
finally {
    Pop-Location
    if ($null -eq $previousBridgeUrl) {
        Remove-Item Env:WORDOLLAMA_BRIDGE_URL -ErrorAction SilentlyContinue
    } else {
        $env:WORDOLLAMA_BRIDGE_URL = $previousBridgeUrl
    }
    if ($null -eq $previousAddinVersion) {
        Remove-Item Env:WORDOLLAMA_ADDIN_VERSION -ErrorAction SilentlyContinue
    } else {
        $env:WORDOLLAMA_ADDIN_VERSION = $previousAddinVersion
    }
}

Copy-Item -Path (Join-Path $addinRoot "dist\*") -Destination $output -Recurse -Force
Copy-Item -LiteralPath (Join-Path $addinRoot "assets") -Destination $output -Recurse -Force

# commands.html is a Vite entry point. Keep the bundled file copied from dist;
# copying the source entry here would restore its /src/commands.ts reference,
# which the packaged Bridge does not (and must not) serve.
$packagedCommandsPath = Join-Path $output "commands.html"
if (-not (Test-Path -LiteralPath $packagedCommandsPath -PathType Leaf)) {
    throw "Production Add-in bundle does not contain commands.html."
}
$packagedCommandsText = Get-Content -LiteralPath $packagedCommandsPath -Raw
if ($packagedCommandsText -match '(?i)(?:src|href)=["'']/?src/' -or
    $packagedCommandsText -notmatch '(?i)src=["'']/assets/commands-[^"'']+\.js') {
    throw "Production commands.html still references source code instead of its Vite bundle."
}

$javascriptFiles = @(Get-ChildItem -LiteralPath (Join-Path $output "assets") -Filter "*.js" -File)
if ($javascriptFiles.Count -eq 0) {
    throw "Production Add-in bundle does not contain a JavaScript asset."
}
$javascriptText = ($javascriptFiles | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
if ($javascriptText.Contains("http://127.0.0.1:37421", [StringComparison]::OrdinalIgnoreCase) -or
    -not $javascriptText.Contains($productionBridgeUrl, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Production Add-in bundle did not replace the development Bridge URL with $productionBridgeUrl."
}

[xml]$manifest = Get-Content (Join-Path $addinRoot "manifest.xml") -Raw
$manifestVersionNode = $manifest.SelectSingleNode("/*[local-name()='OfficeApp']/*[local-name()='Version']")
if ($null -eq $manifestVersionNode) {
    throw "Manifest Version element is missing."
}
$manifestVersionNode.InnerText = $ManifestVersion
$oldBase = "https://localhost:3000"
$newBase = $baseUri.AbsoluteUri.TrimEnd('/')
foreach ($node in $manifest.SelectNodes("//*[@DefaultValue]")) {
    if ($node.DefaultValue -like "$oldBase*") {
        $node.DefaultValue = $node.DefaultValue.Replace($oldBase, $newBase)
    }
}
$commandsUrlNode = $manifest.SelectSingleNode("//*[@id='Commands.Url']")
if ($null -eq $commandsUrlNode) {
    throw "Manifest Commands.Url resource is missing."
}
$commandsUrlNode.DefaultValue = "$newBase/commands.html?v=$ManifestVersion"
foreach ($node in $manifest.SelectNodes("//*[local-name()='AppDomain']")) {
    if ($node.InnerText -eq $oldBase) {
        $node.InnerText = $newBase
    }
}
$productionManifestPath = Join-Path $output "manifest.xml"
$manifest.Save($productionManifestPath)
$productionManifestText = Get-Content -LiteralPath $productionManifestPath -Raw
if ($productionManifestText.Contains($oldBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Production manifest still contains the localhost development origin."
}
if ($productionManifestText -notmatch "<Version>$([Regex]::Escape($ManifestVersion))</Version>") {
    throw "Production manifest version was not set to $ManifestVersion."
}
if ($productionManifestText -notmatch "commands\.html\?v=$([Regex]::Escape($ManifestVersion))") {
    throw "Production Commands.Url was not cache-busted with manifest version $ManifestVersion."
}
$productionManifest = [xml]$productionManifestText
$defaultLocaleNode = $productionManifest.SelectSingleNode(
    "/*[local-name()='OfficeApp']/*[local-name()='DefaultLocale']")
$localizedDefaults = @($productionManifest.SelectNodes("//*[@DefaultValue]"))
$hardCodedChineseDefaults = @($localizedDefaults | Where-Object {
    $_.DefaultValue -match "[\u3400-\u9fff]"
})
$localizedResources = @($productionManifest.SelectNodes(
    "//*[local-name()='ShortStrings' or local-name()='LongStrings']/*[local-name()='String']"))
$chineseOverrides = @($productionManifest.SelectNodes(
    "//*[local-name()='Override' and @Locale='zh-CN']"))
$intentionallyInvariantResourceIds = @("Tab.Label", "Agent.Label")
$missingChineseOverrides = @($localizedResources | Where-Object {
    $_.id -notin $intentionallyInvariantResourceIds -and
    $null -eq $_.SelectSingleNode("*[local-name()='Override' and @Locale='zh-CN']")
})
$duplicateChineseOverrides = @($localizedResources | Where-Object {
    @($_.SelectNodes("*[local-name()='Override' and @Locale='zh-CN']")).Count -gt 1
})
$invalidChineseOverrides = @($chineseOverrides | Where-Object {
    [string]::IsNullOrWhiteSpace($_.Value)
})
if ($null -eq $defaultLocaleNode -or
    $defaultLocaleNode.InnerText -ne "en-US" -or
    $hardCodedChineseDefaults.Count -ne 0 -or
    $localizedResources.Count -eq 0 -or
    $missingChineseOverrides.Count -ne 0 -or
    $duplicateChineseOverrides.Count -ne 0 -or
    $invalidChineseOverrides.Count -ne 0) {
    throw "Production manifest localization must use en-US defaults and valid zh-CN overrides for every translatable string resource."
}

if (-not $SkipManifestValidation) {
    $manifestCommandName = if ($IsWindows) { "office-addin-manifest.cmd" } else { "office-addin-manifest" }
    $manifestCommand = Join-Path $addinRoot "node_modules\.bin\$manifestCommandName"
    if (-not (Test-Path -LiteralPath $manifestCommand -PathType Leaf)) {
        throw "Manifest validator is missing. Run npm install in $addinRoot."
    }
    Invoke-Checked -Command $manifestCommand `
        -Arguments @("validate", $productionManifestPath) `
        -Label "Production manifest validation"
}

$archive = Join-Path $outputRootFullPath "WordOllama.JS-Addin-$Version.zip"
if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
}
Compress-Archive -Path (Join-Path $output "*") -DestinationPath $archive -Force
Write-Host "Published $archive"
