param(
    [string]$ManifestPath = "",
    [ValidateSet("Auto", "Windows", "MacOS")]
    [string]$Platform = "Auto",
    [string]$RegistrationRoot = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$expectedAddinId = "4d2a7c5e-2d2a-4a1a-8b72-6a1cf4f7b701"
$addinFileName = "WordOllama.JS.xml"

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $PSScriptRoot "..\officejs\apps\addin\manifest.xml"
}
$manifestFullPath = [System.IO.Path]::GetFullPath($ManifestPath)
if (-not (Test-Path -LiteralPath $manifestFullPath -PathType Leaf)) {
    throw "Office Add-in manifest was not found: $manifestFullPath"
}

[xml]$manifest = Get-Content -LiteralPath $manifestFullPath -Raw
$namespace = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
$namespace.AddNamespace("o", "http://schemas.microsoft.com/office/appforoffice/1.1")
$idNode = $manifest.SelectSingleNode("/o:OfficeApp/o:Id", $namespace)
$displayNameNode = $manifest.SelectSingleNode("/o:OfficeApp/o:DisplayName", $namespace)
if ($null -eq $idNode -or $idNode.InnerText.Trim().ToLowerInvariant() -ne $expectedAddinId) {
    throw "Refusing to register an unexpected manifest ID. Expected $expectedAddinId."
}
if ($null -eq $displayNameNode -or $displayNameNode.GetAttribute("DefaultValue") -ne "WordOllama.JS") {
    throw "Refusing to register a manifest whose display name is not WordOllama.JS."
}

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
    if (-not $IsWindows -and [string]::IsNullOrWhiteSpace($RegistrationRoot)) {
        throw "A real Windows WEF registration can only be created on Windows."
    }

    if (-not [string]::IsNullOrWhiteSpace($RegistrationRoot)) {
        $testRoot = [System.IO.Path]::GetFullPath($RegistrationRoot)
        New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
        $recordPath = Join-Path $testRoot "windows-wef-registration.json"
        [ordered]@{
            registryPath = "HKCU:\SOFTWARE\Microsoft\Office\16.0\Wef\Developer"
            valueName = $expectedAddinId
            manifestPath = $manifestFullPath
            displayName = "WordOllama.JS"
        } | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
        Write-Host "Created test WEF registration record: $recordPath"
        return
    }

    $developerKey = "HKCU:\SOFTWARE\Microsoft\Office\16.0\Wef\Developer"
    New-Item -Path $developerKey -Force | Out-Null
    $existing = $null
    $developerProperties = Get-ItemProperty -LiteralPath $developerKey
    if ($developerProperties.PSObject.Properties.Name -contains $expectedAddinId) {
        $existing = $developerProperties.$expectedAddinId
    }
    if ($null -ne $existing) {
        $existingFullPath = [System.IO.Path]::GetFullPath([string]$existing)
        if ($existingFullPath -ne $manifestFullPath -and -not $Force) {
            throw "WordOllama.JS is already registered to '$existingFullPath'. Use -Force to replace only this add-in's registration."
        }
    }
    New-ItemProperty -LiteralPath $developerKey -Name $expectedAddinId `
        -Value $manifestFullPath -PropertyType String -Force | Out-Null
    Write-Host "Registered WordOllama.JS for Windows developer sideloading."
    Write-Host "Close every Word window, start the add-in HTTPS host, and reopen Word."
    return
}

if (-not $IsMacOS -and [string]::IsNullOrWhiteSpace($RegistrationRoot)) {
    throw "A real macOS WEF registration can only be created on macOS."
}
$wefRoot = if ([string]::IsNullOrWhiteSpace($RegistrationRoot)) {
    Join-Path $HOME "Library/Containers/com.microsoft.Word/Data/Documents/wef"
}
else {
    [System.IO.Path]::GetFullPath($RegistrationRoot)
}
New-Item -ItemType Directory -Force -Path $wefRoot | Out-Null
$targetManifest = Join-Path $wefRoot $addinFileName
if (Test-Path -LiteralPath $targetManifest -PathType Leaf) {
    $sourceHash = (Get-FileHash -LiteralPath $manifestFullPath -Algorithm SHA256).Hash
    $targetHash = (Get-FileHash -LiteralPath $targetManifest -Algorithm SHA256).Hash
    if ($sourceHash -ne $targetHash -and -not $Force) {
        throw "A different WordOllama.JS manifest already exists at '$targetManifest'. Use -Force to replace only this file."
    }
}
Copy-Item -LiteralPath $manifestFullPath -Destination $targetManifest -Force
Write-Host "Installed WordOllama.JS manifest for macOS developer sideloading: $targetManifest"
Write-Host "Close every Word window, start the add-in HTTPS host, and reopen Word."
