param(
    [ValidateSet("Auto", "Windows", "MacOS")]
    [string]$Platform = "Auto",
    [string]$RegistrationRoot = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$expectedAddinId = "4d2a7c5e-2d2a-4a1a-8b72-6a1cf4f7b701"
$addinFileName = "WordOllama.JS.xml"

if ($Platform -eq "Auto") {
    if ($IsWindows) {
        $Platform = "Windows"
    }
    elseif ($IsMacOS) {
        $Platform = "MacOS"
    }
    else {
        throw "Developer sideloading is supported only on Windows or macOS."
    }
}

if ($Platform -eq "Windows") {
    if (-not [string]::IsNullOrWhiteSpace($RegistrationRoot)) {
        $testRoot = [System.IO.Path]::GetFullPath($RegistrationRoot)
        $recordPath = Join-Path $testRoot "windows-wef-registration.json"
        if (Test-Path -LiteralPath $recordPath -PathType Leaf) {
            Remove-Item -LiteralPath $recordPath -Force
        }
        Write-Host "Removed test WEF registration record: $recordPath"
        return
    }
    if (-not $IsWindows) {
        throw "A real Windows WEF registration can only be removed on Windows."
    }

    $developerKey = "HKCU:\SOFTWARE\Microsoft\Office\16.0\Wef\Developer"
    if (Test-Path -LiteralPath $developerKey) {
        Remove-ItemProperty -LiteralPath $developerKey -Name $expectedAddinId `
            -ErrorAction SilentlyContinue
    }
    Write-Host "Removed only the WordOllama.JS Windows developer registration."
    Write-Host "Restart Word. If a stale ribbon remains, clear the Office add-in cache manually."
    return
}

if (-not $IsMacOS -and [string]::IsNullOrWhiteSpace($RegistrationRoot)) {
    throw "A real macOS WEF registration can only be removed on macOS."
}
$wefRoot = if ([string]::IsNullOrWhiteSpace($RegistrationRoot)) {
    Join-Path $HOME "Library/Containers/com.microsoft.Word/Data/Documents/wef"
}
else {
    [System.IO.Path]::GetFullPath($RegistrationRoot)
}
$targetManifest = Join-Path $wefRoot $addinFileName
if (Test-Path -LiteralPath $targetManifest -PathType Leaf) {
    if (-not $Force) {
        [xml]$installedManifest = Get-Content -LiteralPath $targetManifest -Raw
        $namespace = [System.Xml.XmlNamespaceManager]::new($installedManifest.NameTable)
        $namespace.AddNamespace("o", "http://schemas.microsoft.com/office/appforoffice/1.1")
        $idNode = $installedManifest.SelectSingleNode("/o:OfficeApp/o:Id", $namespace)
        if ($null -eq $idNode -or $idNode.InnerText.Trim().ToLowerInvariant() -ne $expectedAddinId) {
            throw "Refusing to remove '$targetManifest' because its manifest ID is not WordOllama.JS. Use -Force only after inspecting the file."
        }
    }
    Remove-Item -LiteralPath $targetManifest -Force
}
Write-Host "Removed only the WordOllama.JS macOS developer manifest."
Write-Host "Restart Word. If a stale ribbon remains, clear the Office add-in cache manually."
