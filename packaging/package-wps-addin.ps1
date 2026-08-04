param(
    [string]$OutputDirectory = "",
    [string]$BaseUrl = "https://localhost:37421/wps-addin/",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$addinRoot = Join-Path $repoRoot "officejs\apps\addin"
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "artifacts\wps" }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$staging = Join-Path $OutputDirectory "WordOllama.JS-WPS"
$archive = Join-Path $OutputDirectory "WordOllama.JS-WPS.zip"
$publishPage = Join-Path $OutputDirectory "WordOllama.JS-WPS-publish.html"
$staging = [System.IO.Path]::GetFullPath($staging)
$outputPrefix = $OutputDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $staging.StartsWith($outputPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to stage outside the requested WPS output directory."
}

$parsedBaseUrl = $null
if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$parsedBaseUrl) -or
    $parsedBaseUrl.Scheme -ne [Uri]::UriSchemeHttps -or
    -not $parsedBaseUrl.IsLoopback -or
    -not [string]::IsNullOrEmpty($parsedBaseUrl.UserInfo) -or
    -not [string]::IsNullOrEmpty($parsedBaseUrl.Query) -or
    -not [string]::IsNullOrEmpty($parsedBaseUrl.Fragment)) {
    throw "WPS BaseUrl must be a loopback HTTPS URL without credentials, query, or fragment."
}
$BaseUrl = $parsedBaseUrl.AbsoluteUri.TrimEnd("/") + "/"

if (-not $SkipBuild) {
    Push-Location $addinRoot
    try {
        $npmCommand = if ($IsWindows) { Get-Command npm.cmd -ErrorAction Stop } else { Get-Command npm -ErrorAction Stop }
        & $npmCommand.Source run bundle
        if ($LASTEXITCODE -ne 0) { throw "WPS frontend bundle failed." }
    }
    finally { Pop-Location }
}

$dist = Join-Path $addinRoot "dist"
foreach ($required in @("wps-addin\index.html", "wps-addin\main.js", "wps-addin\ribbon.xml", "wps.html", "settings.html", "assets")) {
    if (-not (Test-Path -LiteralPath (Join-Path $dist $required))) {
        throw "Missing WPS bundle entry: $required"
    }
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $dist "wps-addin\index.html") -Destination $staging
Copy-Item -LiteralPath (Join-Path $dist "wps-addin\main.js") -Destination $staging
Copy-Item -LiteralPath (Join-Path $dist "wps-addin\ribbon.xml") -Destination $staging
Copy-Item -LiteralPath (Join-Path $dist "wps.html") -Destination $staging
Copy-Item -LiteralPath (Join-Path $dist "settings.html") -Destination $staging
Copy-Item -LiteralPath (Join-Path $dist "assets") -Destination $staging -Recurse
Copy-Item -LiteralPath (Join-Path $addinRoot "assets\ribbon") `
    -Destination (Join-Path $staging "assets") -Recurse -Force

$publishTemplate = Join-Path $addinRoot "node_modules\wpsjs\src\lib\res\publish.html"
if (-not (Test-Path -LiteralPath $publishTemplate)) {
    throw "Missing the pinned wpsjs publish template. Run npm install first."
}
$publishConfig = @(
    [ordered]@{
        name = "WordOllama.JS"
        addonType = "wps"
        online = "true"
        multiUser = "false"
        url = $BaseUrl
        customDomain = ""
    }
) | ConvertTo-Json -Compress
$publishHtml = [System.IO.File]::ReadAllText($publishTemplate)
$publishHtml = $publishHtml.Replace("PUBLISH_REPLACE_STRING", $publishConfig)
$publishHtml = $publishHtml.Replace("SERVERID_REPLEASE_STRING", "undefined")
[System.IO.File]::WriteAllText($publishPage, $publishHtml, [System.Text.UTF8Encoding]::new($false))

if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $archive -Force
Write-Output $archive
Write-Output $publishPage
