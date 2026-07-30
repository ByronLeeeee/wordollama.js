[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("win-x64", "osx-arm64", "osx-x64")]
    [string]$Runtime,
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$WindowsCertificateThumbprint = "",
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [string]$MacSigningIdentity = "",
    [string]$MacNotaryProfile = "",
    [string]$MacNotaryKeychain = "",
    [string]$MacNotarizationEvidencePath = "",
    [switch]$AllowUntimestampedTestSignature,
    [switch]$AllowSelfSignedTestCertificate,
    [switch]$AllowUnnotarizedMacTestSignature,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path $ArtifactRoot).Path
$publishDirectory = Join-Path $root "$Version-$Runtime"
$archive = Join-Path $root "WordOllama-Bridge-$Version-$Runtime.zip"
if (-not (Test-Path -LiteralPath $publishDirectory -PathType Container)) {
    throw "Published runtime directory not found: $publishDirectory"
}
if (-not $DryRun) {
    if ($Runtime -eq "win-x64" -and -not $IsWindows) {
        throw "Windows Authenticode signing must run on Windows."
    }
    if ($Runtime.StartsWith("osx-", [StringComparison]::Ordinal) -and -not $IsMacOS) {
        throw "macOS signing and notarization must run on macOS."
    }
}

function Invoke-Tool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FileName,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if ($DryRun) {
        Write-Host "DRY RUN: $FileName $($Arguments -join ' ')"
        return
    }
    $toolPath = ""
    $command = Get-Command $FileName -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        $toolPath = $command.Source
    }
    elseif ($FileName -eq "signtool.exe" -and $IsWindows) {
        $windowsKitsRoot = if ([string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
            ""
        } else {
            Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
        }
        if (-not [string]::IsNullOrWhiteSpace($windowsKitsRoot) -and
            (Test-Path -LiteralPath $windowsKitsRoot -PathType Container)) {
            $signToolCandidates = @(Get-ChildItem -LiteralPath $windowsKitsRoot -Directory -ErrorAction SilentlyContinue |
                ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
                Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
                Sort-Object -Descending)
            if ($signToolCandidates.Count -gt 0) {
                $toolPath = [string]$signToolCandidates[0]
            }
        }
    }
    if ([string]::IsNullOrWhiteSpace([string]$toolPath)) {
        throw "$Label requires '$FileName' on PATH."
    }
    & $toolPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

if ($Runtime -eq "win-x64") {
    if ([string]::IsNullOrWhiteSpace($WindowsCertificateThumbprint) -and -not $DryRun) {
        throw "Windows signing requires -WindowsCertificateThumbprint."
    }
    $allowUntimestamped = $AllowUntimestampedTestSignature -and
        $Version -match "(?i)(smoke|test)"
    $allowSelfSigned = $AllowSelfSignedTestCertificate -and
        $Version -match "(?i)(smoke|test)"
    if ([string]::IsNullOrWhiteSpace($TimestampUrl) -and -not $DryRun -and
        -not $allowUntimestamped) {
        throw "Windows release signing requires an RFC 3161 -TimestampUrl. Untimestamped signatures are allowed only for smoke/test versions with -AllowUntimestampedTestSignature."
    }

    $binaries = @(Get-ChildItem -LiteralPath $publishDirectory -Recurse -File |
        Where-Object { $_.Extension -in @(".exe", ".dll") })
    if ($binaries.Count -eq 0) {
        throw "No Windows PE binaries found under $publishDirectory."
    }
    foreach ($binary in $binaries) {
        $arguments = @("sign", "/fd", "SHA256", "/sha1", $WindowsCertificateThumbprint)
        if (-not [string]::IsNullOrWhiteSpace($TimestampUrl)) {
            $arguments += @("/tr", $TimestampUrl, "/td", "SHA256")
        }
        $arguments += $binary.FullName
        if ($PSCmdlet.ShouldProcess($binary.FullName, "Authenticode sign")) {
            Invoke-Tool -FileName "signtool.exe" -Arguments $arguments -Label "Windows Authenticode signing"
            Invoke-Tool -FileName "signtool.exe" `
                -Arguments @("verify", "/pa", "/all", "/v", $binary.FullName) `
                -Label "Windows Authenticode verification"
            if (-not $DryRun) {
                $signature = Get-AuthenticodeSignature -LiteralPath $binary.FullName
                if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
                    $null -eq $signature.SignerCertificate -or
                    (-not $allowUntimestamped -and $null -eq $signature.TimeStamperCertificate)) {
                    throw "Windows Authenticode verification did not produce a valid signer and RFC 3161 timestamp for $($binary.Name)."
                }
                if (-not $allowSelfSigned -and
                    $signature.SignerCertificate.Subject -eq $signature.SignerCertificate.Issuer) {
                    throw "Windows production signing requires a CA-issued code-signing leaf certificate; self-signed certificates are allowed only for smoke/test versions with -AllowSelfSignedTestCertificate."
                }
            }
        }
    }
}
else {
    if ([string]::IsNullOrWhiteSpace($MacSigningIdentity) -and -not $DryRun) {
        throw "macOS signing requires -MacSigningIdentity."
    }
    $allowUnnotarizedMac = $AllowUnnotarizedMacTestSignature -and
        $Version -match "(?i)(smoke|test)"
    if (-not $DryRun -and -not $allowUnnotarizedMac -and
        -not $MacSigningIdentity.StartsWith("Developer ID Application:", [StringComparison]::Ordinal)) {
        throw "macOS production signing requires a 'Developer ID Application:' identity."
    }
    if (-not $DryRun -and -not $allowUnnotarizedMac -and
        [string]::IsNullOrWhiteSpace($MacNotaryProfile)) {
        throw "macOS production signing requires -MacNotaryProfile for notarization."
    }
    $bridgeBinary = Join-Path $publishDirectory "WordOllama.DesktopBridge"
    if (-not (Test-Path -LiteralPath $bridgeBinary -PathType Leaf)) {
        throw "macOS Bridge executable not found: $bridgeBinary"
    }

    # A self-contained .NET macOS publish contains native runtime libraries.
    # Sign nested Mach-O libraries before the entry executable so the outer
    # signature seals their final signed bytes.
    $nativeLibraries = @(Get-ChildItem -LiteralPath $publishDirectory -Recurse -File |
        Where-Object { $_.Extension -eq ".dylib" } |
        Sort-Object { $_.FullName.Length } -Descending)
    $signTargets = @($nativeLibraries | ForEach-Object { $_.FullName }) + @($bridgeBinary)
    foreach ($signTarget in $signTargets) {
        $signArguments = @(
            "--force", "--options", "runtime", "--timestamp",
            "--sign", $MacSigningIdentity, $signTarget
        )
        if ($PSCmdlet.ShouldProcess($signTarget, "codesign")) {
            Invoke-Tool -FileName "codesign" -Arguments $signArguments -Label "macOS code signing"
            Invoke-Tool -FileName "codesign" `
                -Arguments @("--verify", "--strict", "--verbose=2", $signTarget) `
                -Label "macOS signature verification"
        }
    }
    if ($PSCmdlet.ShouldProcess($bridgeBinary, "verify sealed macOS Bridge")) {
        Invoke-Tool -FileName "codesign" `
            -Arguments @("--verify", "--deep", "--strict", "--verbose=2", $bridgeBinary) `
            -Label "macOS sealed Bridge verification"
    }
}

if (-not $DryRun -and (Test-Path -LiteralPath $archive) -and
    $PSCmdlet.ShouldProcess($archive, "rebuild signed archive")) {
    $tempArchive = "$archive.$([Guid]::NewGuid().ToString('N')).tmp.zip"
    try {
        $ditto = Get-Command "ditto" -ErrorAction SilentlyContinue
        if ($Runtime.StartsWith("osx-") -and $null -ne $ditto) {
            & $ditto.Source -c -k --sequesterRsrc $publishDirectory $tempArchive
            if ($LASTEXITCODE -ne 0) { throw "ditto failed with exit code $LASTEXITCODE." }
        }
        else {
            Compress-Archive -Path (Join-Path $publishDirectory "*") -DestinationPath $tempArchive -Force
        }
        Move-Item -LiteralPath $tempArchive -Destination $archive -Force
    }
    finally {
        if (Test-Path -LiteralPath $tempArchive) {
            Remove-Item -LiteralPath $tempArchive -Force
        }
    }
}

if (-not [string]::IsNullOrWhiteSpace($MacNotaryProfile)) {
    if (-not $Runtime.StartsWith("osx-")) {
        throw "-MacNotaryProfile is valid only for macOS runtimes."
    }
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
        throw "Cannot notarize missing archive: $archive"
    }
    $notaryArguments = @(
        "notarytool", "submit", $archive,
        "--keychain-profile", $MacNotaryProfile,
        "--output-format", "json"
    )
    if (-not [string]::IsNullOrWhiteSpace($MacNotaryKeychain)) {
        $notaryArguments += @("--keychain", $MacNotaryKeychain)
    }
    $notaryArguments += "--wait"
    if ($DryRun) {
        Invoke-Tool -FileName "xcrun" -Arguments $notaryArguments -Label "macOS notarization"
    }
    else {
        $notaryOutput = @(& /usr/bin/xcrun @notaryArguments 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw "macOS notarization failed with exit code $LASTEXITCODE`: $($notaryOutput -join ' ')"
        }
        try {
            $notaryResult = ($notaryOutput -join "`n") | ConvertFrom-Json
        }
        catch {
            throw "macOS notarization did not return valid JSON."
        }
        if ($notaryResult.status -ne "Accepted" -or
            [string]::IsNullOrWhiteSpace([string]$notaryResult.id)) {
            throw "macOS notarization was not accepted. Status: $($notaryResult.status)"
        }

        if ([string]::IsNullOrWhiteSpace($MacNotarizationEvidencePath)) {
            $MacNotarizationEvidencePath = Join-Path $root `
                "WordOllama-Bridge-$Version-$Runtime.notarization.json"
        }
        $evidenceFullPath = [IO.Path]::GetFullPath($MacNotarizationEvidencePath)
        $evidenceDirectory = Split-Path -Parent $evidenceFullPath
        if (-not [string]::IsNullOrWhiteSpace($evidenceDirectory)) {
            New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
        }
        $notaryLogPath = [IO.Path]::ChangeExtension($evidenceFullPath, ".log.json")
        $logArguments = @(
            "notarytool", "log", [string]$notaryResult.id,
            "--keychain-profile", $MacNotaryProfile
        )
        if (-not [string]::IsNullOrWhiteSpace($MacNotaryKeychain)) {
            $logArguments += @("--keychain", $MacNotaryKeychain)
        }
        $logArguments += $notaryLogPath
        Invoke-Tool -FileName "xcrun" -Arguments $logArguments -Label "macOS notarization log"
        try {
            $notaryLog = Get-Content -LiteralPath $notaryLogPath -Raw | ConvertFrom-Json
        }
        catch {
            throw "macOS notarization log is not valid JSON: $notaryLogPath"
        }
        if ($notaryLog.status -ne "Accepted" -or
            @($notaryLog.issues | Where-Object { $_.severity -eq "error" }).Count -ne 0) {
            throw "macOS notarization log contains a rejected status or errors."
        }

        $signatureDetails = @(& /usr/bin/codesign -dv --verbose=4 $bridgeBinary 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to read the signed macOS Bridge identity."
        }
        $authority = @($signatureDetails |
            Where-Object { $_ -like "Authority=*" } |
            Select-Object -First 1)
        $teamIdentifier = @($signatureDetails |
            Where-Object { $_ -like "TeamIdentifier=*" } |
            Select-Object -First 1)
        $evidence = [ordered]@{
            schemaVersion = 1
            kind = "apple-notarization"
            product = "WordOllama.JS Desktop Bridge"
            version = $Version
            runtime = $Runtime
            generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
            archivePath = [IO.Path]::GetFileName($archive)
            archiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
            submissionId = [string]$notaryResult.id
            status = [string]$notaryResult.status
            statusMessage = [string]$notaryResult.message
            authority = if ($authority.Count -eq 1) {
                ([string]$authority[0]).Substring("Authority=".Length)
            } else { "" }
            teamIdentifier = if ($teamIdentifier.Count -eq 1) {
                ([string]$teamIdentifier[0]).Substring("TeamIdentifier=".Length)
            } else { "" }
            hardenedRuntime = @($signatureDetails | Where-Object { $_ -like "Runtime Version=*" }).Count -gt 0
            secureTimestamp = @($signatureDetails | Where-Object { $_ -like "Timestamp=*" }).Count -gt 0
            logPath = [IO.Path]::GetFileName($notaryLogPath)
            logSha256 = (Get-FileHash -LiteralPath $notaryLogPath -Algorithm SHA256).Hash.ToLowerInvariant()
            issueCount = @($notaryLog.issues).Count
            errorCount = @($notaryLog.issues | Where-Object { $_.severity -eq "error" }).Count
        }
        $evidenceTemp = "$evidenceFullPath.$([Guid]::NewGuid().ToString('N')).tmp"
        $evidence | ConvertTo-Json -Depth 8 |
            Set-Content -LiteralPath $evidenceTemp -Encoding utf8
        Move-Item -LiteralPath $evidenceTemp -Destination $evidenceFullPath -Force
        Write-Host "Created macOS notarization evidence $evidenceFullPath"
    }
}
elseif (-not [string]::IsNullOrWhiteSpace($MacNotaryKeychain)) {
    throw "-MacNotaryKeychain requires -MacNotaryProfile."
}

Write-Host "Signing workflow completed for ${Runtime}: $publishDirectory"
