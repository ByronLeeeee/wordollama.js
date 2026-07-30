param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($InstallRoot)
$statePath = Join-Path $root "current.json"
if (-not (Test-Path -LiteralPath $statePath)) {
    throw "No Bridge update state found under $root."
}
$state = Get-Content $statePath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($state.previousVersion)) {
    throw "No previous Bridge version is available for rollback."
}
$previousPath = Join-Path (Join-Path $root "versions") $state.previousVersion
if (-not (Test-Path -LiteralPath $previousPath)) {
    throw "Previous Bridge version is missing: $($state.previousVersion)"
}
$newState = [pscustomobject]@{
    currentVersion = $state.previousVersion
    previousVersion = $state.currentVersion
    installedAt = [DateTimeOffset]::UtcNow.ToString("O")
    sha256 = $null
}
$temp = "$statePath.$([Guid]::NewGuid().ToString('N')).tmp"
$newState | ConvertTo-Json | Set-Content -LiteralPath $temp -Encoding UTF8
Move-Item -LiteralPath $temp -Destination $statePath -Force
$currentVersionPath = Join-Path $root "current-version"
$currentVersionTemp = "$currentVersionPath.$([Guid]::NewGuid().ToString('N')).tmp"
Set-Content -LiteralPath $currentVersionTemp -Value $newState.currentVersion -Encoding utf8NoBOM -NoNewline
Move-Item -LiteralPath $currentVersionTemp -Destination $currentVersionPath -Force
Write-Host "Rolled Bridge pointer back to $($state.previousVersion)."
