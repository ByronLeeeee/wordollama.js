[CmdletBinding()]
param(
    [string]$BuildRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$validator = Join-Path $repoRoot "packaging\validate-word-host-supplemental.ps1"
$recorder = Join-Path $repoRoot "tools\record-word-host-supplemental.ps1"
$smokeRoot = if ([string]::IsNullOrWhiteSpace($BuildRoot)) {
    Join-Path $repoRoot ".build-word-host-supplemental-smoke"
} else {
    [IO.Path]::GetFullPath($BuildRoot)
}
$reportPath = Join-Path $smokeRoot "supplemental.json"
$version = "1.2.3-smoke"
$buildTime = [DateTimeOffset]::UtcNow.AddMinutes(-2)

$taskpaneIds = @(
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
    "light-zh-CN-narrow",
    "light-zh-CN-wide",
    "light-en-US-narrow",
    "light-en-US-wide",
    "dark-zh-CN-narrow",
    "dark-zh-CN-wide",
    "dark-en-US-narrow",
    "dark-en-US-wide"
)

function New-PassedCases {
    param([string[]]$Names)
    return @($Names | ForEach-Object { [ordered]@{ name = $_; status = "passed" } })
}

function Write-SmokeReport {
    param([Parameter(Mandatory = $true)]$Report)
    New-Item -ItemType Directory -Force -Path $smokeRoot | Out-Null
    $Report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding utf8
}

function Assert-Rejected {
    param([Parameter(Mandatory = $true)]$Report,[Parameter(Mandatory = $true)][string]$Label)
    Write-SmokeReport -Report $Report
    $rejected = $false
    try {
        & $validator -ReportPath $reportPath -ExpectedVersion $version `
            -ExpectedPlatform "PC" -BuildTime $buildTime
    }
    catch {
        $rejected = $true
    }
    if (-not $rejected) { throw "Supplemental report validator accepted $Label." }
}

$report = [ordered]@{
    schemaVersion = 1
    kind = "word-host-supplemental"
    startedAt = [DateTimeOffset]::UtcNow.AddMinutes(-1).ToString("O")
    finishedAt = [DateTimeOffset]::UtcNow.ToString("O")
    release = [ordered]@{
        addinVersion = $version
        bridgeVersion = $version
        protocolVersion = "1.0"
    }
    host = [ordered]@{
        host = "Word"
        platform = "PC"
        version = "16.0.99999.10000"
        language = "zh-CN"
    }
    compare = [ordered]@{
        status = "passed"
        documents = [ordered]@{
            originalSha256 = ("a" * 64)
            revisedSha256 = ("b" * 64)
        }
        appliedRevisionCount = 3
        cases = New-PassedCases -Names @(
            "complex-contract-structure-and-style",
            "selected-differences-applied-as-word-revisions"
        )
        errors = @()
    }
    coauthoring = [ordered]@{
        status = "passed"
        clientCount = 2
        documentId = "shared-document-smoke"
        clients = @(
            [ordered]@{ clientId = "desktop"; host = "Word"; platform = "PC"; version = "16.0.99999.10000" },
            [ordered]@{ clientId = "web"; host = "Word"; platform = "Web"; version = "2026.07" }
        )
        cases = New-PassedCases -Names @(
            "concurrent-edit-stable-anchor-relocation",
            "stale-write-is-rejected-before-application"
        )
        errors = @()
    }
    multiPane = [ordered]@{
        status = "passed"
        taskpaneIds = $taskpaneIds
        cases = New-PassedCases -Names @("independent-panes-open-without-replacing-each-other")
        errors = @()
    }
    dialogs = [ordered]@{
        status = "passed"
        dialogIds = @("WordOllama.JS.SettingsDialog")
        cases = New-PassedCases -Names @(
            "settings-opens-as-office-dialog",
            "office-frame-policy-allows-dialog-and-taskpane"
        )
        errors = @()
    }
    appearance = [ordered]@{
        status = "passed"
        themes = @("light", "dark")
        languages = @("zh-CN", "en-US")
        widths = @("narrow", "wide")
        cases = New-PassedCases -Names $appearanceCases
        errors = @()
    }
}

try {
    New-Item -ItemType Directory -Force -Path $smokeRoot | Out-Null
    $descriptorPath = Join-Path $smokeRoot "unified-build.json"
    $originalPath = Join-Path $smokeRoot "original.docx"
    $revisedPath = Join-Path $smokeRoot "revised.docx"
    $recordedReportPath = Join-Path $smokeRoot "recorded-supplemental.json"
    [ordered]@{
        schemaVersion = 1
        product = "WordOllama.JS"
        releaseReady = $false
        runtime = "win-x64"
        version = $version
        generatedAt = $buildTime.ToString("O")
    } | ConvertTo-Json | Set-Content -LiteralPath $descriptorPath -Encoding utf8
    Set-Content -LiteralPath $originalPath -Value "original contract fixture" -NoNewline
    Set-Content -LiteralPath $revisedPath -Value "revised contract fixture" -NoNewline
    $recordStartArguments = @{
        Mode = "Start"
        BuildDescriptorPath = $descriptorPath
        WordVersion = "16.0.99999.10000"
        DisplayLanguage = "zh-CN"
        OriginalDocumentPath = $originalPath
        RevisedDocumentPath = $revisedPath
        SharedDocumentId = "shared-document-recorder-smoke"
        SecondClientPlatform = "Web"
        SecondClientVersion = "2026.07"
        OutputPath = $recordedReportPath
    }
    & $recorder @recordStartArguments
    $overwriteRejected = $false
    try {
        & $recorder @recordStartArguments
    }
    catch {
        $overwriteRejected = $true
    }
    if (-not $overwriteRejected) {
        throw "Supplemental recorder overwrote an existing acceptance session."
    }
    $recordedDraft = Get-Content -LiteralPath $recordedReportPath -Raw | ConvertFrom-Json
    if ($recordedDraft.compare.status -ne "pending" -or
        @($recordedDraft.appearance.cases).Count -ne 8 -or
        @($recordedDraft.multiPane.taskpaneIds).Count -ne 16 -or
        $recordedDraft.sourceBuild.runtime -ne "win-x64") {
        throw "Supplemental recorder did not create a complete pending acceptance session."
    }
    $incompleteConfirmationRejected = $false
    try {
        & $recorder -Mode Complete -ReportPath $recordedReportPath `
            -AppliedRevisionCount 2 `
            -ConfirmComplexContractComparison `
            -ConfirmSelectedDifferencesAppliedAsRevisions `
            -ConfirmConcurrentEditRelocation `
            -ConfirmStaleWriteRejected `
            -ConfirmIndependentTaskPanes `
            -ConfirmSettingsOfficeDialog
    }
    catch {
        $incompleteConfirmationRejected = $true
    }
    if (-not $incompleteConfirmationRejected) {
        throw "Supplemental recorder completed without the full appearance confirmation."
    }
    Add-Content -LiteralPath $revisedPath -Value "tampered"
    $changedDocumentRejected = $false
    try {
        & $recorder -Mode Complete -ReportPath $recordedReportPath `
            -AppliedRevisionCount 2 `
            -ConfirmComplexContractComparison `
            -ConfirmSelectedDifferencesAppliedAsRevisions `
            -ConfirmConcurrentEditRelocation `
            -ConfirmStaleWriteRejected `
            -ConfirmIndependentTaskPanes `
            -ConfirmSettingsOfficeDialog `
            -ConfirmOfficeFramePolicy `
            -ConfirmAppearanceMatrix
    }
    catch {
        $changedDocumentRejected = $true
    }
    if (-not $changedDocumentRejected) {
        throw "Supplemental recorder accepted a contract changed during acceptance."
    }
    Set-Content -LiteralPath $revisedPath -Value "revised contract fixture" -NoNewline
    & $recorder -Mode Complete -ReportPath $recordedReportPath `
        -AppliedRevisionCount 2 `
        -ConfirmComplexContractComparison `
        -ConfirmSelectedDifferencesAppliedAsRevisions `
        -ConfirmConcurrentEditRelocation `
        -ConfirmStaleWriteRejected `
        -ConfirmIndependentTaskPanes `
        -ConfirmSettingsOfficeDialog `
        -ConfirmOfficeFramePolicy `
        -ConfirmAppearanceMatrix
    $recordedCompleted = Get-Content -LiteralPath $recordedReportPath -Raw | ConvertFrom-Json
    if ($recordedCompleted.compare.appliedRevisionCount -ne 2 -or
        $recordedCompleted.appearance.status -ne "passed" -or
        [string]::IsNullOrWhiteSpace([string]$recordedCompleted.finishedAt)) {
        throw "Supplemental recorder did not complete the confirmed acceptance session."
    }

    Write-SmokeReport -Report $report
    & $validator -ReportPath $reportPath -ExpectedVersion $version `
        -ExpectedPlatform "PC" -BuildTime $buildTime

    $missingAppearance = $report | ConvertTo-Json -Depth 10 | ConvertFrom-Json -AsHashtable
    $missingAppearance.appearance.cases = @($missingAppearance.appearance.cases | Select-Object -First 7)
    Assert-Rejected -Report $missingAppearance -Label "missing appearance coverage"

    $duplicatePane = $report | ConvertTo-Json -Depth 10 | ConvertFrom-Json -AsHashtable
    $duplicatePane.multiPane.taskpaneIds[15] = $duplicatePane.multiPane.taskpaneIds[0]
    Assert-Rejected -Report $duplicatePane -Label "duplicate task pane evidence"

    $missingSettingsDialog = $report | ConvertTo-Json -Depth 10 | ConvertFrom-Json -AsHashtable
    $missingSettingsDialog.dialogs.dialogIds = @()
    Assert-Rejected -Report $missingSettingsDialog -Label "missing settings dialog evidence"

    $anonymousClient = $report | ConvertTo-Json -Depth 10 | ConvertFrom-Json -AsHashtable
    $anonymousClient.coauthoring.clients[1].clientId = ""
    Assert-Rejected -Report $anonymousClient -Label "anonymous coauthoring client"

    $sameDocuments = $report | ConvertTo-Json -Depth 10 | ConvertFrom-Json -AsHashtable
    $sameDocuments.compare.documents.revisedSha256 = $sameDocuments.compare.documents.originalSha256
    Assert-Rejected -Report $sameDocuments -Label "identical comparison documents"
}
finally {
    if (Test-Path -LiteralPath $smokeRoot) {
        $resolvedSmokeRoot = (Resolve-Path -LiteralPath $smokeRoot).Path
        $resolvedRepoRoot = [IO.Path]::GetFullPath($repoRoot).TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar)
        if (-not $resolvedSmokeRoot.StartsWith(
                $resolvedRepoRoot + [IO.Path]::DirectorySeparatorChar,
                [StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($resolvedSmokeRoot) -ne ".build-word-host-supplemental-smoke") {
            throw "Refusing to remove unexpected supplemental smoke path: $resolvedSmokeRoot"
        }
        Remove-Item -LiteralPath $resolvedSmokeRoot -Recurse -Force
    }
}

Write-Host "Strict supplemental Word host release evidence smoke passed."
