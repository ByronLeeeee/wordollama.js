[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Start", "Complete")]
    [string]$Mode,
    [string]$BuildDescriptorPath = "",
    [string]$WordVersion = "",
    [string]$DisplayLanguage = "",
    [string]$OriginalDocumentPath = "",
    [string]$RevisedDocumentPath = "",
    [string]$SharedDocumentId = "",
    [ValidateSet("", "PC", "Mac", "Web")]
    [string]$SecondClientPlatform = "",
    [string]$SecondClientVersion = "",
    [string]$OutputPath = "",
    [string]$ReportPath = "",
    [ValidateRange(0, 2147483647)]
    [int]$AppliedRevisionCount = 0,
    [switch]$ConfirmComplexContractComparison,
    [switch]$ConfirmSelectedDifferencesAppliedAsRevisions,
    [switch]$ConfirmConcurrentEditRelocation,
    [switch]$ConfirmStaleWriteRejected,
    [switch]$ConfirmIndependentTaskPanes,
    [switch]$ConfirmSettingsOfficeDialog,
    [switch]$ConfirmAppearanceMatrix
)

$ErrorActionPreference = "Stop"
$validator = Join-Path (Split-Path -Parent $PSScriptRoot) `
    "packaging/validate-word-host-supplemental.ps1"
$requiredTaskpaneIds = @(
    "WordOllama.JS.AgentPane",
    "WordOllama.JS.WritingPane",
    "WordOllama.JS.ModifyPane",
    "WordOllama.JS.ImagePane",
    "WordOllama.JS.TablePane",
    "WordOllama.JS.HtmlPane",
    "WordOllama.JS.MarkdownPane",
    "WordOllama.JS.EditPane",
    "WordOllama.JS.TranslatePane",
    "WordOllama.JS.ComparePane",
    "WordOllama.JS.ReviewPane",
    "WordOllama.JS.LegalPane",
    "WordOllama.JS.MootCourtPane",
    "WordOllama.JS.LawSearchPane",
    "WordOllama.JS.CustomPromptPane",
    "WordOllama.JS.DiagnosticsPane"
)
$appearanceCases = @(
    foreach ($theme in @("light", "dark")) {
        foreach ($language in @("zh-CN", "en-US")) {
            foreach ($width in @("narrow", "wide")) {
                "$theme-$language-$width"
            }
        }
    }
)

function Require-Value {
    param([string]$Value, [string]$Label)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Label is required in $Mode mode."
    }
}

function Write-JsonAtomically {
    param([Parameter(Mandatory = $true)]$Value, [Parameter(Mandatory = $true)][string]$Path)
    $fullPath = [IO.Path]::GetFullPath($Path)
    $directory = Split-Path -Parent $fullPath
    if (-not [string]::IsNullOrWhiteSpace($directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $temporaryPath = "$fullPath.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $Value | ConvertTo-Json -Depth 10 |
            Set-Content -LiteralPath $temporaryPath -Encoding utf8
        Move-Item -LiteralPath $temporaryPath -Destination $fullPath -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
    return $fullPath
}

if ($Mode -eq "Start") {
    foreach ($required in @(
        @{ Value = $BuildDescriptorPath; Label = "BuildDescriptorPath" }
        @{ Value = $WordVersion; Label = "WordVersion" }
        @{ Value = $DisplayLanguage; Label = "DisplayLanguage" }
        @{ Value = $OriginalDocumentPath; Label = "OriginalDocumentPath" }
        @{ Value = $RevisedDocumentPath; Label = "RevisedDocumentPath" }
        @{ Value = $SharedDocumentId; Label = "SharedDocumentId" }
        @{ Value = $SecondClientPlatform; Label = "SecondClientPlatform" }
        @{ Value = $SecondClientVersion; Label = "SecondClientVersion" }
        @{ Value = $OutputPath; Label = "OutputPath" }
    )) {
        Require-Value -Value $required.Value -Label $required.Label
    }

    $descriptorPath = (Resolve-Path -LiteralPath $BuildDescriptorPath).Path
    $descriptor = Get-Content -LiteralPath $descriptorPath -Raw | ConvertFrom-Json
    if ($descriptor.schemaVersion -ne 1 -or
        $descriptor.product -ne "WordOllama.JS" -or
        $descriptor.releaseReady -ne $false -or
        $descriptor.runtime -notin @("win-x64", "osx-arm64") -or
        [string]::IsNullOrWhiteSpace([string]$descriptor.version)) {
        throw "BuildDescriptorPath is not an unsigned WordOllama.JS release descriptor."
    }
    [DateTimeOffset]$buildTime = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
            [string]$descriptor.generatedAt,
            [ref]$buildTime)) {
        throw "Build descriptor generatedAt is invalid."
    }
    $originalPath = (Resolve-Path -LiteralPath $OriginalDocumentPath).Path
    $revisedPath = (Resolve-Path -LiteralPath $RevisedDocumentPath).Path
    if (-not (Test-Path -LiteralPath $originalPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $revisedPath -PathType Leaf)) {
        throw "OriginalDocumentPath and RevisedDocumentPath must be files."
    }
    $originalHash = (Get-FileHash -LiteralPath $originalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $revisedHash = (Get-FileHash -LiteralPath $revisedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($originalHash -eq $revisedHash) {
        throw "Original and revised contract documents must be distinct."
    }
    $hostPlatform = if ($descriptor.runtime -eq "win-x64") { "PC" } else { "Mac" }
    $startedAt = [DateTimeOffset]::UtcNow
    if ($startedAt -lt $buildTime) {
        throw "The acceptance session cannot predate its packaged build."
    }
    $requestedOutputPath = [IO.Path]::GetFullPath($OutputPath)
    if (Test-Path -LiteralPath $requestedOutputPath) {
        throw "OutputPath already exists; refusing to overwrite an acceptance report."
    }
    $pendingCases = {
        param([string[]]$Names)
        @($Names | ForEach-Object {
            [ordered]@{ name = $_; status = "pending" }
        })
    }
    $report = [ordered]@{
        schemaVersion = 1
        kind = "word-host-supplemental"
        startedAt = $startedAt.ToString("O")
        finishedAt = $null
        release = [ordered]@{
            addinVersion = [string]$descriptor.version
            bridgeVersion = [string]$descriptor.version
            protocolVersion = "1.0"
        }
        host = [ordered]@{
            host = "Word"
            platform = $hostPlatform
            version = $WordVersion
            language = $DisplayLanguage
        }
        sourceBuild = [ordered]@{
            descriptorPath = $descriptorPath
            runtime = [string]$descriptor.runtime
            generatedAt = $buildTime.ToString("O")
            descriptorSha256 = (Get-FileHash -LiteralPath $descriptorPath -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        sourceDocuments = [ordered]@{
            originalPath = $originalPath
            revisedPath = $revisedPath
        }
        compare = [ordered]@{
            status = "pending"
            documents = [ordered]@{
                originalSha256 = $originalHash
                revisedSha256 = $revisedHash
            }
            appliedRevisionCount = 0
            cases = & $pendingCases @(
                "complex-contract-structure-and-style",
                "selected-differences-applied-as-word-revisions"
            )
            errors = @()
        }
        coauthoring = [ordered]@{
            status = "pending"
            clientCount = 2
            documentId = $SharedDocumentId
            clients = @(
                [ordered]@{
                    clientId = "client-1"
                    host = "Word"
                    platform = $hostPlatform
                    version = $WordVersion
                },
                [ordered]@{
                    clientId = "client-2"
                    host = "Word"
                    platform = $SecondClientPlatform
                    version = $SecondClientVersion
                }
            )
            cases = & $pendingCases @(
                "concurrent-edit-stable-anchor-relocation",
                "stale-write-is-rejected-before-application"
            )
            errors = @()
        }
        multiPane = [ordered]@{
            status = "pending"
            taskpaneIds = $requiredTaskpaneIds
            cases = & $pendingCases @(
                "independent-panes-open-without-replacing-each-other"
            )
            errors = @()
        }
        dialogs = [ordered]@{
            status = "pending"
            dialogIds = @("WordOllama.JS.SettingsDialog")
            cases = & $pendingCases @("settings-opens-as-office-dialog")
            errors = @()
        }
        appearance = [ordered]@{
            status = "pending"
            themes = @("light", "dark")
            languages = @("zh-CN", "en-US")
            widths = @("narrow", "wide")
            cases = & $pendingCases $appearanceCases
            errors = @()
        }
    }
    $writtenPath = Write-JsonAtomically -Value $report -Path $requestedOutputPath
    Write-Host "Started supplemental Word host acceptance: $writtenPath"
    Write-Host "Run every pending case, then use this script in Complete mode with all confirmation switches."
    return
}

Require-Value -Value $ReportPath -Label "ReportPath"
if ($AppliedRevisionCount -lt 1) {
    throw "Complete mode requires -AppliedRevisionCount with the observed positive revision count."
}
$confirmations = [ordered]@{
    ConfirmComplexContractComparison = $ConfirmComplexContractComparison
    ConfirmSelectedDifferencesAppliedAsRevisions = $ConfirmSelectedDifferencesAppliedAsRevisions
    ConfirmConcurrentEditRelocation = $ConfirmConcurrentEditRelocation
    ConfirmStaleWriteRejected = $ConfirmStaleWriteRejected
    ConfirmIndependentTaskPanes = $ConfirmIndependentTaskPanes
    ConfirmSettingsOfficeDialog = $ConfirmSettingsOfficeDialog
    ConfirmAppearanceMatrix = $ConfirmAppearanceMatrix
}
$missingConfirmations = @($confirmations.GetEnumerator() |
    Where-Object { -not $_.Value } |
    ForEach-Object { "-$($_.Key)" })
if ($missingConfirmations.Count -ne 0) {
    throw "Complete mode requires explicit confirmation of every check: $($missingConfirmations -join ', ')."
}

$resolvedReportPath = (Resolve-Path -LiteralPath $ReportPath).Path
$report = Get-Content -LiteralPath $resolvedReportPath -Raw | ConvertFrom-Json
if ($report.schemaVersion -ne 1 -or
    $report.kind -ne "word-host-supplemental" -or
    $null -eq $report.sourceBuild -or
    $null -eq $report.sourceDocuments -or
    [string]$report.sourceBuild.descriptorSha256 -notmatch "^[0-9a-f]{64}$") {
    throw "ReportPath is not an in-progress supplemental report created by this script."
}
$sourceDescriptorPath = (Resolve-Path -LiteralPath $report.sourceBuild.descriptorPath).Path
if ((Get-FileHash -LiteralPath $sourceDescriptorPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne
        $report.sourceBuild.descriptorSha256) {
    throw "The packaged build descriptor changed after the acceptance session started."
}
$sourceDescriptor = Get-Content -LiteralPath $sourceDescriptorPath -Raw | ConvertFrom-Json
$expectedHostPlatform = if ($sourceDescriptor.runtime -eq "win-x64") { "PC" } else { "Mac" }
[DateTimeOffset]$sourceBuildTime = [DateTimeOffset]::MinValue
[DateTimeOffset]$recordedBuildTime = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse(
        [string]$sourceDescriptor.generatedAt,
        [ref]$sourceBuildTime) -or
    -not [DateTimeOffset]::TryParse(
        [string]$report.sourceBuild.generatedAt,
        [ref]$recordedBuildTime)) {
    throw "The acceptance report contains an invalid packaged-build timestamp."
}
if ([string]$sourceDescriptor.version -ne [string]$report.release.addinVersion -or
    [string]$sourceDescriptor.version -ne [string]$report.release.bridgeVersion -or
    [string]$sourceDescriptor.runtime -ne [string]$report.sourceBuild.runtime -or
    $sourceBuildTime -ne $recordedBuildTime -or
    $report.host.platform -ne $expectedHostPlatform) {
    throw "The acceptance report identity no longer matches its packaged build."
}
$currentOriginalHash = (Get-FileHash -LiteralPath `
    (Resolve-Path -LiteralPath $report.sourceDocuments.originalPath).Path `
    -Algorithm SHA256).Hash.ToLowerInvariant()
$currentRevisedHash = (Get-FileHash -LiteralPath `
    (Resolve-Path -LiteralPath $report.sourceDocuments.revisedPath).Path `
    -Algorithm SHA256).Hash.ToLowerInvariant()
if ($currentOriginalHash -ne $report.compare.documents.originalSha256 -or
    $currentRevisedHash -ne $report.compare.documents.revisedSha256) {
    throw "The contract comparison documents changed during the acceptance session."
}
foreach ($sectionName in @("compare", "coauthoring", "multiPane", "dialogs", "appearance")) {
    $section = $report.$sectionName
    if ($section.status -ne "pending" -or
        @($section.errors).Count -ne 0 -or
        @($section.cases | Where-Object { $_.status -ne "pending" }).Count -ne 0) {
        throw "Section '$sectionName' is not an untouched pending acceptance section."
    }
    $section.status = "passed"
    foreach ($case in @($section.cases)) {
        $case.status = "passed"
    }
}
$report.compare.appliedRevisionCount = $AppliedRevisionCount
$report.finishedAt = [DateTimeOffset]::UtcNow.ToString("O")
$candidatePath = "$resolvedReportPath.$([Guid]::NewGuid().ToString('N')).candidate.json"
try {
    $writtenCandidatePath = Write-JsonAtomically -Value $report -Path $candidatePath
    & $validator -ReportPath $writtenCandidatePath `
        -ExpectedVersion ([string]$report.release.addinVersion) `
        -ExpectedPlatform ([string]$report.host.platform) `
        -BuildTime $recordedBuildTime
    Move-Item -LiteralPath $writtenCandidatePath `
        -Destination $resolvedReportPath -Force
}
finally {
    if (Test-Path -LiteralPath $candidatePath) {
        Remove-Item -LiteralPath $candidatePath -Force
    }
}
Write-Host "Completed supplemental Word host acceptance: $resolvedReportPath"
