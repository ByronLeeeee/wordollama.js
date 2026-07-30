param(
    [string]$TestRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($TestRoot)) {
    $TestRoot = Join-Path $repoRoot ".build-office-addin-install-smoke"
}
$testRootFullPath = [System.IO.Path]::GetFullPath($TestRoot)
if (Test-Path -LiteralPath $testRootFullPath) {
    Remove-Item -LiteralPath $testRootFullPath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $testRootFullPath | Out-Null

$manifestPath = Join-Path $repoRoot "officejs/apps/addin/manifest.xml"
$installScript = Join-Path $repoRoot "packaging/install-office-addin-dev.ps1"
$uninstallScript = Join-Path $repoRoot "packaging/uninstall-office-addin-dev.ps1"

$windowsRoot = Join-Path $testRootFullPath "windows"
& $installScript -ManifestPath $manifestPath -Platform Windows -RegistrationRoot $windowsRoot
$windowsRecordPath = Join-Path $windowsRoot "windows-wef-registration.json"
$windowsRecord = Get-Content -LiteralPath $windowsRecordPath -Raw | ConvertFrom-Json
if ($windowsRecord.valueName -ne "4d2a7c5e-2d2a-4a1a-8b72-6a1cf4f7b701" -or
    $windowsRecord.displayName -ne "WordOllama.JS" -or
    [System.IO.Path]::GetFullPath($windowsRecord.manifestPath) -ne [System.IO.Path]::GetFullPath($manifestPath)) {
    throw "Windows WEF registration record did not preserve the manifest identity and path."
}
& $uninstallScript -Platform Windows -RegistrationRoot $windowsRoot
if (Test-Path -LiteralPath $windowsRecordPath) {
    throw "Windows WEF test registration was not removed."
}

$macRoot = Join-Path $testRootFullPath "macos"
& $installScript -ManifestPath $manifestPath -Platform MacOS -RegistrationRoot $macRoot
$macManifestPath = Join-Path $macRoot "WordOllama.JS.xml"
if (-not (Test-Path -LiteralPath $macManifestPath -PathType Leaf)) {
    throw "macOS WEF manifest was not copied."
}
if ((Get-FileHash -LiteralPath $macManifestPath -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash) {
    throw "macOS WEF manifest differs from the source manifest."
}
& $uninstallScript -Platform MacOS -RegistrationRoot $macRoot
if (Test-Path -LiteralPath $macManifestPath) {
    throw "macOS WEF test manifest was not removed."
}

Write-Host "Office Add-in developer install smoke passed."
