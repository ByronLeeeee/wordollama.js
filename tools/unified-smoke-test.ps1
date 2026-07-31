param(
    [switch]$SkipManifestValidation,
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",
    [string]$BuildRoot = "",
    [switch]$NoRestore
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
$addinRoot = Join-Path $repoRoot "officejs\apps\addin"
$unifiedCoreSmokeProject = Join-Path $repoRoot "tools\unified-core-smoke\WordOllama.UnifiedCoreSmoke.csproj"
$unifiedBridgeSettingsSmokeProject = Join-Path $repoRoot "tools\unified-bridge-settings-smoke\WordOllama.UnifiedBridgeSettingsSmoke.csproj"
$bridgeLiveApiSmoke = Join-Path $repoRoot "tools\bridge-live-api-smoke-test.ps1"
$offlineNugetConfig = Join-Path $repoRoot "tools\offline-nuget.config"
$bridgeProject = Join-Path $repoRoot "src\WordOllama.DesktopBridge\WordOllama.DesktopBridge.csproj"
$buildRoot = if ([string]::IsNullOrWhiteSpace($BuildRoot)) {
    Join-Path $repoRoot ".build-unified-smoke"
} else {
    [System.IO.Path]::GetFullPath($BuildRoot)
}
$nodeInfo = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCli = if ($null -ne $nodeInfo) {
    Join-Path (Split-Path -Parent $nodeInfo.Source) "node_modules\npm\bin\npm-cli.js"
} else {
    ""
}
if (-not [string]::IsNullOrWhiteSpace($npmCli) -and (Test-Path -LiteralPath $npmCli)) {
    $npmCommand = $nodeInfo.Source
    $npmCommandPrefix = @($npmCli)
} else {
    $npmInfo = Get-Command npm.cmd -ErrorAction SilentlyContinue
    $npmCommand = if ($null -ne $npmInfo) { $npmInfo.Source } else { "npm" }
    $npmCommandPrefix = @()
}

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

function Invoke-NpmChecked {
    param(
        [Parameter(Mandatory = $true)][string[]]$NpmArguments,
        [Parameter(Mandatory = $true)][string]$Label
    )
    Invoke-Checked -Command $npmCommand -Arguments @($npmCommandPrefix + $NpmArguments) -Label $Label
}

Push-Location $addinRoot
try {
    Invoke-NpmChecked -NpmArguments @("run", "build") -Label "Office.js TypeScript build"
    Invoke-NpmChecked -NpmArguments @("run", "test:mock") -Label "Office.js mock registry test"
    Invoke-NpmChecked -NpmArguments @("run", "test:matrix") -Label "Office.js host capability matrix"
    Invoke-NpmChecked -NpmArguments @("run", "test:golden") -Label "Office.js golden runner test"
    Invoke-NpmChecked -NpmArguments @("run", "test:compare") -Label "Office.js document compare UI test"
    Invoke-NpmChecked -NpmArguments @("run", "test:compare-apply") -Label "Office.js compare apply test"
    Invoke-NpmChecked -NpmArguments @("run", "test:ui") -Label "Office.js WordOllama UI parity contract"
    Invoke-NpmChecked -NpmArguments @("run", "test:settings-i18n") -Label "Office.js settings localization contract"
    Invoke-NpmChecked -NpmArguments @("run", "test:review") -Label "Office.js structured review workflow"
    Invoke-NpmChecked -NpmArguments @("run", "test:ribbon") -Label "Office.js Ribbon parity routes"
    Invoke-NpmChecked -NpmArguments @("run", "test:workflow") -Label "Office.js dedicated text workflows"
    Invoke-NpmChecked -NpmArguments @("run", "test:streaming") -Label "Office.js direct-text streaming contract"
    Invoke-NpmChecked -NpmArguments @("run", "test:formats") -Label "Office.js table and Markdown workflows"
    Invoke-NpmChecked -NpmArguments @("run", "test:image") -Label "Office.js image understanding workflow"
    Invoke-NpmChecked -NpmArguments @("run", "test:legal") -Label "Office.js legal workflows"
    Invoke-NpmChecked -NpmArguments @("run", "test:prompts") -Label "Office.js custom prompts"
    Invoke-NpmChecked -NpmArguments @("run", "test:linter") -Label "Office.js silent linter"
    Invoke-NpmChecked -NpmArguments @("run", "test:anchors") -Label "Office.js stable review anchors"
    Invoke-NpmChecked -NpmArguments @("run", "test:long") -Label "Office.js long-document performance runner"
    Invoke-NpmChecked -NpmArguments @("run", "test:revisions") -Label "Office.js revision host runner"
    Invoke-NpmChecked -NpmArguments @("run", "test:updates") -Label "Office.js update status"
    Invoke-NpmChecked -NpmArguments @("run", "test:pairing-session") -Label "Office.js shared pairing session"
    Invoke-NpmChecked -NpmArguments @("run", "test:permission-scope") -Label "Office.js Agent permission scope"
    Invoke-NpmChecked -NpmArguments @("run", "bundle") -Label "Office.js production bundle"
    if (-not $SkipManifestValidation) {
        Invoke-NpmChecked -NpmArguments @("run", "validate") -Label "Office.js manifest validation"
    }
}
finally {
    Pop-Location
}

$packageScript = Join-Path $repoRoot "packaging\package-addin.ps1"
$packageOutputRoot = Join-Path $buildRoot "addin-package"
$insecureBaseUrlRejected = $false
try {
    & $packageScript `
        -BaseUrl "http://localhost:3000" `
        -Version "insecure-smoke" `
        -OutputRoot $packageOutputRoot `
        -SkipManifestValidation
}
catch {
    $insecureBaseUrlRejected = $_.Exception.Message -like "*must be an HTTPS origin*"
}
if (-not $insecureBaseUrlRejected) {
    throw "Add-in packaging security regression: insecure BaseUrl was accepted."
}

$nonOriginBaseUrlRejected = $false
try {
    & $packageScript `
        -BaseUrl "https://user@example.com/addin" `
        -OutputRoot (Join-Path $buildRoot "invalid-base-origin") `
        -SkipManifestValidation
}
catch {
    $nonOriginBaseUrlRejected = $_.Exception.Message -like "*without credentials, path*"
}
if (-not $nonOriginBaseUrlRejected) {
    throw "Add-in packaging security regression: credentialed/path BaseUrl was accepted as an origin."
}

$insecureBridgeUrlRejected = $false
try {
    & $packageScript `
        -BaseUrl "https://addin.wordollama.invalid" `
        -BridgeUrl "http://127.0.0.1:37421" `
        -Version "insecure-bridge-smoke" `
        -OutputRoot $packageOutputRoot `
        -SkipManifestValidation
}
catch {
    $insecureBridgeUrlRejected = $_.Exception.Message -like "*loopback HTTPS origin*"
}
if (-not $insecureBridgeUrlRejected) {
    throw "Add-in packaging security regression: insecure BridgeUrl was accepted."
}

$mismatchedLoopbackOriginRejected = $false
try {
    & $packageScript `
        -BaseUrl "https://localhost:37421" `
        -BridgeUrl "https://127.0.0.1:37421" `
        -Version "mismatched-loopback-smoke" `
        -OutputRoot $packageOutputRoot `
        -SkipManifestValidation
}
catch {
    $mismatchedLoopbackOriginRejected =
        $_.Exception.Message -like "*must use the same origin*"
}
if (-not $mismatchedLoopbackOriginRejected) {
    throw "Add-in packaging security regression: mismatched local UI/API origins were accepted."
}

& $packageScript `
    -Version "smoke" `
    -OutputRoot $packageOutputRoot `
    -SkipManifestValidation

$addinArchive = Join-Path $packageOutputRoot "WordOllama.JS-Addin-smoke.zip"
if (-not (Test-Path -LiteralPath $addinArchive -PathType Leaf)) {
    throw "Add-in packaging regression: expected archive was not created."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($addinArchive)
try {
    $requiredEntries = @("manifest.xml", "index.html", "settings.html", "commands.html")
    foreach ($requiredEntry in $requiredEntries) {
        if (-not ($zip.Entries | Where-Object { $_.FullName -eq $requiredEntry })) {
            throw "Add-in packaging regression: $requiredEntry is missing from the archive."
        }
    }

    $manifestEntry = $zip.Entries | Where-Object { $_.FullName -eq "manifest.xml" }
    $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
    try {
        $packagedManifest = $reader.ReadToEnd()
    }
    finally {
        $reader.Dispose()
    }
    if ($packagedManifest -match "https://localhost:3000" -or
        $packagedManifest -notmatch "https://localhost:37421" -or
        $packagedManifest -notmatch 'DisplayName DefaultValue="WordOllama.JS"') {
        throw "Add-in packaging regression: desktop manifest identity/origin replacement failed."
    }
    [xml]$packagedManifestXml = $packagedManifest
    $packagedDefaultLocale = $packagedManifestXml.SelectSingleNode(
        "/*[local-name()='OfficeApp']/*[local-name()='DefaultLocale']")
    $packagedChineseDefaults = @($packagedManifestXml.SelectNodes("//*[@DefaultValue]") |
        Where-Object { $_.DefaultValue -match "[\u3400-\u9fff]" })
    $packagedChineseOverrides = @($packagedManifestXml.SelectNodes(
        "//*[local-name()='Override' and @Locale='zh-CN']"))
    [xml]$sourceManifestXml = Get-Content -LiteralPath (Join-Path $addinRoot "manifest.xml") -Raw
    $sourceChineseOverrides = @($sourceManifestXml.SelectNodes(
        "//*[local-name()='Override' and @Locale='zh-CN']"))
    $invalidPackagedChineseOverrides = @($packagedChineseOverrides | Where-Object {
        [string]::IsNullOrWhiteSpace($_.Value)
    })
    if ($packagedDefaultLocale.InnerText -ne "en-US" -or
        $packagedChineseDefaults.Count -ne 0 -or
        $packagedChineseOverrides.Count -ne $sourceChineseOverrides.Count -or
        $invalidPackagedChineseOverrides.Count -ne 0) {
        throw "Add-in packaging regression: manifest en-US fallback or zh-CN overrides are incomplete."
    }

    $javascriptEntries = @($zip.Entries | Where-Object { $_.FullName -like "assets/*.js" })
    if ($javascriptEntries.Count -eq 0) {
        throw "Add-in packaging regression: JavaScript bundle is missing from archive."
    }
    $packagedJavascript = ""
    foreach ($javascriptEntry in $javascriptEntries) {
        $javascriptReader = [System.IO.StreamReader]::new($javascriptEntry.Open())
        try {
            $packagedJavascript += $javascriptReader.ReadToEnd()
        }
        finally {
            $javascriptReader.Dispose()
        }
    }
    if ($packagedJavascript -match "http://127.0.0.1:37421" -or
        $packagedJavascript -notmatch "https://localhost:37421") {
        throw "Add-in packaging regression: production Bridge HTTPS URL injection failed."
    }
}
finally {
    $zip.Dispose()
}

$updateIndexSmoke = Join-Path $repoRoot "tools\update-index-smoke-test.ps1"
& $updateIndexSmoke
$supplementalHostSmoke = Join-Path $repoRoot "tools\word-host-supplemental-smoke-test.ps1"
& $supplementalHostSmoke

$baseOutputPath = $buildRoot + [System.IO.Path]::DirectorySeparatorChar
$dotnetArguments = @(
    "build",
    $bridgeProject,
    "-c", $Configuration,
    ("-p:BaseOutputPath=" + $baseOutputPath)
)
if ($NoRestore) {
    $dotnetArguments = @("build", $bridgeProject, "--no-restore", "-c", $Configuration,
        ("-p:BaseOutputPath=" + $baseOutputPath))
}
Invoke-Checked -Command "dotnet" -Arguments $dotnetArguments -Label "DesktopBridge build"

$settings = Get-Content (Join-Path $repoRoot "src\WordOllama.DesktopBridge\appsettings.json") -Raw | ConvertFrom-Json
if ($settings.Bridge.LocalTools.AllowHttpRequests -ne $false) {
    throw "安全回归失败：AllowHttpRequests 必须默认关闭。"
}
$unifiedWorkflow = Get-Content `
    (Join-Path $repoRoot ".github\workflows\officejs-unified-ci.yml") -Raw
if ($unifiedWorkflow -notmatch "platform-secret-store-smoke" -or
    $unifiedWorkflow -notmatch "--allow-user-vault-test" -or
    $unifiedWorkflow -notmatch "macos-15-intel" -or
    $unifiedWorkflow -notmatch "osx-arm64" -or
    $unifiedWorkflow -notmatch "osx-x64") {
    throw "平台回归失败：三目标原生 CI 缺少 Credential Manager/Keychain 门禁。"
}

$skillFile = Join-Path $buildRoot ($Configuration + "\net8.0\Skills\contract-review\SKILL.md")
$coreSmokeArguments = @("run", "--project", $unifiedCoreSmokeProject, "-c", $Configuration)
if ($NoRestore) {
    $coreSmokeArguments += "--no-restore"
}
Invoke-Checked -Command "dotnet" -Arguments $coreSmokeArguments -Label "Unified structural document comparer smoke"

$bridgeSettingsSmokeArguments = @("run", "--project", $unifiedBridgeSettingsSmokeProject, "-c", $Configuration, "--no-restore")
if (-not $NoRestore) {
    Invoke-Checked -Command "dotnet" -Arguments @(
        "restore", $unifiedBridgeSettingsSmokeProject, "--configfile", $offlineNugetConfig
    ) -Label "Unified Bridge settings smoke restore"
}
Invoke-Checked -Command "dotnet" -Arguments $bridgeSettingsSmokeArguments -Label "Unified Bridge settings smoke"

$bridgeAssembly = Join-Path $buildRoot `
    ($Configuration + "\net8.0\WordOllama.DesktopBridge.dll")
& $bridgeLiveApiSmoke -Configuration $Configuration -BridgeAssemblyPath $bridgeAssembly
if ($LASTEXITCODE -ne 0) {
    throw "Live Bridge API smoke failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $skillFile)) {
    throw "打包回归失败：内置 contract-reviewer Skill 未复制到 Bridge 输出。"
}

Write-Host "Unified Office.js/Bridge smoke test passed."
