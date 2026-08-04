param(
    [string]$OutputDirectory = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$addinRoot = Join-Path $repoRoot "officejs\apps\addin"
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "artifacts\wps" }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$staging = Join-Path $OutputDirectory "WordOllama.JS-WPS"
$archive = Join-Path $OutputDirectory "WordOllama.JS-WPS.zip"
$staging = [System.IO.Path]::GetFullPath($staging)
$outputPrefix = $OutputDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $staging.StartsWith($outputPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to stage outside the requested WPS output directory."
}

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
foreach ($required in @("main.js", "ribbon.xml", "wps.html", "settings.html", "assets")) {
    if (-not (Test-Path -LiteralPath (Join-Path $dist $required))) {
        throw "Missing WPS bundle entry: $required"
    }
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $dist "main.js") -Destination $staging
Copy-Item -LiteralPath (Join-Path $dist "ribbon.xml") -Destination $staging
Copy-Item -LiteralPath (Join-Path $dist "wps.html") -Destination $staging
Copy-Item -LiteralPath (Join-Path $dist "settings.html") -Destination $staging
Copy-Item -LiteralPath (Join-Path $dist "assets") -Destination $staging -Recurse

if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $archive -Force
Write-Output $archive
