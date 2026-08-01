[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ReportPath,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][ValidateSet("PC", "Mac")][string]$ExpectedPlatform,
    [Parameter(Mandatory = $true)][DateTimeOffset]$BuildTime
)

$ErrorActionPreference = "Stop"

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
$requiredCompareCases = @(
    "complex-contract-structure-and-style",
    "selected-differences-applied-as-word-revisions"
)
$requiredCoauthoringCases = @(
    "concurrent-edit-stable-anchor-relocation",
    "stale-write-is-rejected-before-application"
)
$requiredMultiPaneCases = @("independent-panes-open-without-replacing-each-other")
$requiredDialogCases = @(
    "settings-opens-as-office-dialog",
    "office-frame-policy-allows-dialog-and-taskpane"
)
$requiredThemes = @("light", "dark")
$requiredLanguages = @("zh-CN", "en-US")
$requiredWidths = @("narrow", "wide")
$requiredAppearanceCases = @(
    foreach ($theme in $requiredThemes) {
        foreach ($language in $requiredLanguages) {
            foreach ($width in $requiredWidths) {
                "$theme-$language-$width"
            }
        }
    }
)

function Assert-ExactStringSet {
    param(
        [Parameter(Mandatory = $true)][object[]]$Actual,
        [Parameter(Mandatory = $true)][string[]]$Expected,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $actualStrings = @($Actual | ForEach-Object { [string]$_ })
    if ($actualStrings.Count -ne $Expected.Count -or
        @($actualStrings | Select-Object -Unique).Count -ne $Expected.Count -or
        @($Expected | Where-Object { $_ -notin $actualStrings }).Count -ne 0) {
        throw "$Label must contain exactly: $($Expected -join ', ')."
    }
}

function Assert-PassedCases {
    param(
        [Parameter(Mandatory = $true)]$Section,
        [Parameter(Mandatory = $true)][string[]]$ExpectedNames,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $cases = @($Section.cases)
    if ($Section.status -ne "passed" -or @($Section.errors).Count -ne 0) {
        throw "$Label must be passed without errors."
    }
    Assert-ExactStringSet -Actual @($cases.name) -Expected $ExpectedNames -Label "$Label cases"
    if (@($cases | Where-Object { $_.status -ne "passed" }).Count -ne 0) {
        throw "$Label contains a case that did not pass."
    }
}

$resolvedReportPath = (Resolve-Path -LiteralPath $ReportPath).Path
try {
    $report = Get-Content -LiteralPath $resolvedReportPath -Raw | ConvertFrom-Json
}
catch {
    throw "Supplemental host report is not valid JSON: $resolvedReportPath"
}

if ($report.schemaVersion -ne 1 -or $report.kind -ne "word-host-supplemental") {
    throw "Supplemental host report schema or kind is invalid."
}
if ($null -eq $report.release -or
    $report.release.addinVersion -ne $ExpectedVersion -or
    $report.release.bridgeVersion -ne $ExpectedVersion -or
    $report.release.protocolVersion -ne "1.0") {
    throw "Supplemental host report does not prove Add-in/Bridge version $ExpectedVersion and protocol 1.0."
}
if ($null -eq $report.host -or
    $report.host.host -ne "Word" -or
    $report.host.platform -ne $ExpectedPlatform -or
    [string]::IsNullOrWhiteSpace([string]$report.host.version) -or
    $report.host.version -eq "unknown" -or
    [string]::IsNullOrWhiteSpace([string]$report.host.language)) {
    throw "Supplemental host report does not identify a real Word $ExpectedPlatform host."
}

[DateTimeOffset]$startedAt = [DateTimeOffset]::MinValue
[DateTimeOffset]$finishedAt = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse([string]$report.startedAt, [ref]$startedAt) -or
    -not [DateTimeOffset]::TryParse([string]$report.finishedAt, [ref]$finishedAt) -or
    $startedAt -lt $BuildTime -or $finishedAt -lt $startedAt -or
    $finishedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) {
    throw "Supplemental host report timestamps are invalid or do not follow the packaged build."
}

Assert-PassedCases -Section $report.compare -ExpectedNames $requiredCompareCases `
    -Label "Complex contract comparison"
if ($null -eq $report.compare.documents -or
    [string]$report.compare.documents.originalSha256 -notmatch "^[0-9a-fA-F]{64}$" -or
    [string]$report.compare.documents.revisedSha256 -notmatch "^[0-9a-fA-F]{64}$" -or
    $report.compare.documents.originalSha256 -eq $report.compare.documents.revisedSha256 -or
    [int]$report.compare.appliedRevisionCount -lt 1) {
    throw "Complex contract comparison must identify two distinct SHA-256 documents and applied revisions."
}

Assert-PassedCases -Section $report.coauthoring -ExpectedNames $requiredCoauthoringCases `
    -Label "Two-client coauthoring"
$clients = @($report.coauthoring.clients)
if ([int]$report.coauthoring.clientCount -lt 2 -or
    $clients.Count -ne [int]$report.coauthoring.clientCount -or
    @($clients.clientId | Select-Object -Unique).Count -ne $clients.Count -or
    [string]::IsNullOrWhiteSpace([string]$report.coauthoring.documentId) -or
    @($clients | Where-Object {
        [string]::IsNullOrWhiteSpace([string]$_.clientId) -or
        $_.host -ne "Word" -or
        $_.platform -notin @("PC", "Mac", "Web") -or
        [string]::IsNullOrWhiteSpace([string]$_.version) -or
        $_.version -eq "unknown"
    }).Count -ne 0) {
    throw "Two-client coauthoring must identify each distinct Word client and the shared document."
}

Assert-PassedCases -Section $report.multiPane -ExpectedNames $requiredMultiPaneCases `
    -Label "Independent task panes"
Assert-ExactStringSet -Actual @($report.multiPane.taskpaneIds) -Expected $requiredTaskpaneIds `
    -Label "Independent task pane IDs"

Assert-PassedCases -Section $report.dialogs -ExpectedNames $requiredDialogCases `
    -Label "Office dialogs"
Assert-ExactStringSet -Actual @($report.dialogs.dialogIds) -Expected @("WordOllama.JS.SettingsDialog") `
    -Label "Office dialog IDs"

Assert-PassedCases -Section $report.appearance -ExpectedNames $requiredAppearanceCases `
    -Label "Theme/language/width UI"
Assert-ExactStringSet -Actual @($report.appearance.themes) -Expected $requiredThemes `
    -Label "Appearance themes"
Assert-ExactStringSet -Actual @($report.appearance.languages) -Expected $requiredLanguages `
    -Label "Appearance languages"
Assert-ExactStringSet -Actual @($report.appearance.widths) -Expected $requiredWidths `
    -Label "Appearance widths"

Write-Host "Supplemental Word host report passed strict release validation: $resolvedReportPath"
