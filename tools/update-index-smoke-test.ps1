param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$indexScript = Join-Path $repoRoot "packaging/create-update-index.ps1"
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "wordollama-update-index-$([Guid]::NewGuid().ToString('N'))"
$version = "9.8.7-test"
$runtimes = @("win-x64", "osx-arm64", "osx-x64")

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )
    try {
        & $Action
    }
    catch {
        return
    }
    throw $Message
}

try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    $descriptorPaths = @()
    foreach ($runtime in $runtimes) {
        $archive = Join-Path $testRoot "WordOllama-Bridge-$version-$runtime.zip"
        Set-Content -LiteralPath $archive -Value "signed fixture $runtime" -NoNewline
        $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        $size = (Get-Item -LiteralPath $archive).Length
        $descriptorPath = Join-Path $testRoot "unified-release-$version-$runtime.json"
        $descriptorArtifacts = @(
            [pscustomobject]@{
                kind = "desktop-bridge"
                path = $archive
                sha256 = $hash
                sizeBytes = $size
            }
        )
        $installerExtension = if ($runtime -eq "win-x64") { "exe" } else { "pkg" }
        $installer = Join-Path $testRoot `
            "WordOllama-Installer-$version-$runtime.$installerExtension"
        Set-Content -LiteralPath $installer -Value "signed installer fixture $runtime" -NoNewline
        $descriptorArtifacts += [pscustomobject]@{
            kind = "desktop-bridge-installer"
            path = $installer
            sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
            sizeBytes = (Get-Item -LiteralPath $installer).Length
        }
        [pscustomobject]@{
            schemaVersion = 1
            product = "WordOllama.JS"
            version = $version
            runtime = $runtime
            finalizedAt = [DateTimeOffset]::UtcNow.ToString("O")
            releaseReady = $true
            publisherSubject = "CN=WordOllama Test Publisher"
            installerPublisherSubject = if ($runtime -eq "win-x64") {
                "CN=WordOllama Test Publisher"
            } else {
                "Developer ID Installer: WordOllama Test (TEAMID)"
            }
            artifacts = $descriptorArtifacts
            evidence = @(
                [pscustomobject]@{ kind = "bridge-https" }
                [pscustomobject]@{ kind = "word-golden" }
                [pscustomobject]@{ kind = "word-long-document" }
                [pscustomobject]@{ kind = "word-revisions" }
                [pscustomobject]@{ kind = "word-supplemental" }
                if ($runtime -eq "win-x64") {
                    [pscustomobject]@{ kind = "windows-installer-package" }
                }
                else {
                    [pscustomobject]@{ kind = "apple-notarization" }
                    [pscustomobject]@{ kind = "apple-installer-package" }
                }
            )
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $descriptorPath -Encoding UTF8
        $descriptorPaths += $descriptorPath
    }

    $verifiedIndexPath = Join-Path $testRoot "verified-index.json"
    & $indexScript `
        -ArtifactRoot $testRoot `
        -Version $version `
        -DownloadBaseUrl "https://updates.example.test/wordollama" `
        -VerifiedReleaseDescriptorPaths $descriptorPaths `
        -OutputPath $verifiedIndexPath
    $verifiedIndex = Get-Content -LiteralPath $verifiedIndexPath -Raw | ConvertFrom-Json
    if (@($verifiedIndex.artifacts).Count -ne 3 -or
        @($verifiedIndex.installers).Count -ne 3) {
        throw "Verified update index did not contain all runtimes and user installers."
    }
    foreach ($installer in @($verifiedIndex.installers)) {
        $expectedPublisher = if ($installer.runtime -eq "win-x64") {
            "CN=WordOllama Test Publisher"
        } else {
            "Developer ID Installer: WordOllama Test (TEAMID)"
        }
        if ($installer.publisherSubject -ne $expectedPublisher) {
            throw "Verified update index did not preserve the pinned installer publisher."
        }
    }

    Assert-Throws -Message "Production update index accepted archives without verified descriptors." -Action {
        & $indexScript `
            -ArtifactRoot $testRoot `
            -Version $version `
            -DownloadBaseUrl "https://updates.example.test/wordollama" `
            -OutputPath (Join-Path $testRoot "missing-descriptor-index.json")
    }

    $tamperedInstaller = Join-Path $testRoot `
        "WordOllama-Installer-$version-osx-arm64.pkg"
    Add-Content -LiteralPath $tamperedInstaller -Value "tampered"
    Assert-Throws -Message "Production metadata accepted a replaced macOS installer." -Action {
        & $indexScript `
            -ArtifactRoot $testRoot `
            -Version $version `
            -DownloadBaseUrl "https://updates.example.test/wordollama" `
            -VerifiedReleaseDescriptorPaths $descriptorPaths `
            -OutputPath (Join-Path $testRoot "tampered-installer-index.json")
    }
    Set-Content -LiteralPath $tamperedInstaller `
        -Value "signed installer fixture osx-arm64" -NoNewline

    Add-Content -LiteralPath (Join-Path $testRoot "WordOllama-Bridge-$version-win-x64.zip") -Value "tampered"
    Assert-Throws -Message "Production update index accepted an archive that no longer matched its descriptor." -Action {
        & $indexScript `
            -ArtifactRoot $testRoot `
            -Version $version `
            -DownloadBaseUrl "https://updates.example.test/wordollama" `
            -VerifiedReleaseDescriptorPaths $descriptorPaths `
            -OutputPath (Join-Path $testRoot "tampered-index.json")
    }

    $unsignedIndexPath = Join-Path $testRoot "unsigned-test-index.json"
    & $indexScript `
        -ArtifactRoot $testRoot `
        -Version $version `
        -DownloadBaseUrl "https://updates.example.test/wordollama" `
        -AllowUnsignedForTests `
        -OutputPath $unsignedIndexPath
    if (-not (Test-Path -LiteralPath $unsignedIndexPath)) {
        throw "Explicit unsigned test mode did not create an index."
    }

    Write-Host "Update index verification smoke passed."
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
        $resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
        if (-not $resolvedTestRoot.StartsWith("$resolvedTempRoot\", [StringComparison]::OrdinalIgnoreCase) -or
            -not ([IO.Path]::GetFileName($resolvedTestRoot)).StartsWith("wordollama-update-index-", [StringComparison]::Ordinal)) {
            throw "Refusing to remove unexpected smoke-test path: $resolvedTestRoot"
        }
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
