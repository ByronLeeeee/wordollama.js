[CmdletBinding()]
param(
    [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
    [Parameter(Mandatory = $true)]
    [string]$DestinationRoot
)

$ErrorActionPreference = "Stop"
$source = [IO.Path]::GetFullPath($SourceRoot).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar)
$destination = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar)
if ($destination.StartsWith(
        $source + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase) -or
    $destination -eq $source) {
    throw "The JS-only repository destination must be outside the mixed source repository."
}
if (Test-Path -LiteralPath $destination) {
    if (@(Get-ChildItem -LiteralPath $destination -Force).Count -gt 0) {
        throw "The JS-only repository destination must be empty: $destination"
    }
} else {
    New-Item -ItemType Directory -Path $destination | Out-Null
}

$trackedPaths = @(
    ".github/workflows/officejs-unified-ci.yml",
    ".github/workflows/officejs-signed-candidate.yml",
    "LICENSE",
    "docs/OFFICE_JS_MIGRATION_PLAN.zh-CN.md",
    "docs/OFFICE_JS_UI_PARITY_MATRIX.zh-CN.md",
    "docs/OFFICE_JS_UNIFIED_DESKTOP_PLAN.zh-CN.md",
    "docs/SECURITY.md",
    "docs/THIRD-PARTY-NOTICES.md",
    "docs/evidence",
    "officejs",
    "packaging",
    "src",
    "tools/bridge-live-api-smoke-test.ps1",
    "tools/bridge-package-smoke-test.ps1",
    "tools/create-compare-host-fixtures.ps1",
    "tools/export-js-repository.ps1",
    "tools/legal-api-smoke-test.ps1",
    "tools/office-addin-install-smoke-test.ps1",
    "tools/offline-nuget.config",
    "tools/platform-secret-store-smoke",
    "tools/record-word-host-supplemental.ps1",
    "tools/unified-bridge-settings-smoke",
    "tools/unified-core-smoke",
    "tools/unified-smoke-test.ps1",
    "tools/update-index-smoke-test.ps1",
    "tools/word-host-supplemental-smoke-test.ps1",
    "tools/js-repository-templates"
)
$temporaryArchive = Join-Path ([IO.Path]::GetTempPath()) (
    "wordollama-js-export-" + [Guid]::NewGuid().ToString("N") + ".zip")
try {
    & git -C $source archive --format=zip --output=$temporaryArchive HEAD -- $trackedPaths
    if ($LASTEXITCODE -ne 0) {
        throw "git archive failed with exit code $LASTEXITCODE."
    }
    Expand-Archive -LiteralPath $temporaryArchive -DestinationPath $destination

    $templates = Join-Path $destination "tools/js-repository-templates"
    foreach ($template in @("README.md", "CONTRIBUTING.md", "SECURITY.md", ".gitignore")) {
        Copy-Item -LiteralPath (Join-Path $templates $template) `
            -Destination (Join-Path $destination $template) -Force
    }
} finally {
    if (Test-Path -LiteralPath $temporaryArchive) {
        Remove-Item -LiteralPath $temporaryArchive -Force
    }
}

if ((Test-Path -LiteralPath (Join-Path $destination "WordOllama")) -or
    (Test-Path -LiteralPath (Join-Path $destination "WordOllama.sln"))) {
    throw "The JS-only export unexpectedly contains COM/VSTO sources."
}
Write-Host "Exported the tracked WordOllama.JS repository to $destination"
