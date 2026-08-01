[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [Parameter(Mandatory = $true)]
    [string]$CertificatePath,
    [Security.SecureString]$CertificatePassword,
    [string[]]$ExpectedHosts = @("localhost", "127.0.0.1"),
    [string]$EvidencePath = "",
    [switch]$SkipTrustValidation,
    [switch]$SkipSecretStoreWrite
)

$ErrorActionPreference = "Stop"
if ($SkipSecretStoreWrite -and -not $SkipTrustValidation) {
    throw "-SkipSecretStoreWrite is restricted to untrusted repository smoke fixtures."
}
if (-not [string]::IsNullOrWhiteSpace($EvidencePath) -and
    ($SkipTrustValidation -or $SkipSecretStoreWrite)) {
    throw "Release HTTPS evidence cannot be written when trust or secret-store verification is skipped."
}
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar)
$sourceCertificate = (Resolve-Path -LiteralPath $CertificatePath).Path
$currentVersionPath = Join-Path $root "current-version"
if (-not (Test-Path -LiteralPath $currentVersionPath -PathType Leaf)) {
    throw "Bridge current-version pointer is missing under $root. Install a signed Bridge archive first."
}
$version = (Get-Content -LiteralPath $currentVersionPath -Raw).Trim()
if ($version -notmatch "^[0-9A-Za-z][0-9A-Za-z._-]*$") {
    throw "Bridge current-version pointer is invalid."
}
$versionRoot = [IO.Path]::GetFullPath((Join-Path $root "versions/$version"))
$expectedVersionPrefix = [IO.Path]::GetFullPath((Join-Path $root "versions")).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $versionRoot.StartsWith($expectedVersionPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Resolved Bridge version path escaped the install root."
}

$executableName = if ($IsWindows) {
    "WordOllama.DesktopBridge.exe"
} elseif ($IsMacOS) {
    "WordOllama.DesktopBridge"
} else {
    throw "HTTPS provisioning supports Windows or macOS."
}
$executable = Join-Path $versionRoot $executableName
$settingsPath = Join-Path $versionRoot "appsettings.json"
if (-not (Test-Path -LiteralPath $executable -PathType Leaf) -or
    -not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
    throw "Installed Bridge executable or appsettings.json is missing under $versionRoot."
}

if ($null -eq $CertificatePassword) {
    $CertificatePassword = Read-Host "PFX password" -AsSecureString
}
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($CertificatePassword)
$plainPassword = $null
$certificate = $null
try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $keyStorageFlags = if ($IsWindows) {
        [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
    } else {
        # macOS does not implement EphemeralKeySet for PKCS#12 imports. The
        # default importer creates a temporary key that is released with the
        # certificate object; the PFX itself remains permission-restricted.
        [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::DefaultKeySet
    }
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
        $sourceCertificate,
        $plainPassword,
        $keyStorageFlags)
    if (-not $certificate.HasPrivateKey) {
        throw "The HTTPS PFX does not contain a private key."
    }
    $now = [DateTimeOffset]::UtcNow
    if ($certificate.NotBefore.ToUniversalTime() -gt $now.UtcDateTime -or
        $certificate.NotAfter.ToUniversalTime() -le $now.UtcDateTime) {
        throw "The HTTPS certificate is not currently valid."
    }
    foreach ($expectedHost in $ExpectedHosts) {
        if ([string]::IsNullOrWhiteSpace($expectedHost) -or
            -not $certificate.MatchesHostname($expectedHost, $false, $false)) {
            throw "The HTTPS certificate SAN does not match required loopback host '$expectedHost'."
        }
    }
    if (-not $SkipTrustValidation -and -not $certificate.Verify()) {
        throw "The HTTPS certificate chain is not trusted for the current user."
    }

    $certificatesRoot = Join-Path $root "certs"
    New-Item -ItemType Directory -Force -Path $certificatesRoot | Out-Null
    $targetCertificate = Join-Path $certificatesRoot "bridge.pfx"
    $certificateTemp = "$targetCertificate.$([Guid]::NewGuid().ToString('N')).tmp"
    Copy-Item -LiteralPath $sourceCertificate -Destination $certificateTemp -Force
    Move-Item -LiteralPath $certificateTemp -Destination $targetCertificate -Force
    if ($IsMacOS) {
        & chmod 600 $targetCertificate
        if ($LASTEXITCODE -ne 0) { throw "Failed to restrict the installed PFX permissions." }
    }

    if (-not $SkipSecretStoreWrite) {
        $startInfo = [Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $executable
        $startInfo.WorkingDirectory = $versionRoot
        $startInfo.UseShellExecute = $false
        $startInfo.RedirectStandardInput = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.CreateNoWindow = $true
        $startInfo.ArgumentList.Add("https-certificate-secret")
        $startInfo.ArgumentList.Add("set")
        $process = [Diagnostics.Process]::Start($startInfo)
        $process.StandardInput.WriteLine($plainPassword)
        $process.StandardInput.Close()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) {
            $process.Kill($true)
            $process.WaitForExit()
            throw "Bridge secret provisioning timed out."
        }
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            throw "Bridge secret provisioning failed: $($stderrTask.Result.Trim())"
        }

        $verifyStartInfo = [Diagnostics.ProcessStartInfo]::new()
        $verifyStartInfo.FileName = $executable
        $verifyStartInfo.WorkingDirectory = $versionRoot
        $verifyStartInfo.UseShellExecute = $false
        $verifyStartInfo.RedirectStandardOutput = $true
        $verifyStartInfo.RedirectStandardError = $true
        $verifyStartInfo.CreateNoWindow = $true
        $verifyStartInfo.ArgumentList.Add("https-certificate-secret")
        $verifyStartInfo.ArgumentList.Add("verify")
        $verifyProcess = [Diagnostics.Process]::Start($verifyStartInfo)
        $verifyStdoutTask = $verifyProcess.StandardOutput.ReadToEndAsync()
        $verifyStderrTask = $verifyProcess.StandardError.ReadToEndAsync()
        if (-not $verifyProcess.WaitForExit(30000)) {
            $verifyProcess.Kill($true)
            $verifyProcess.WaitForExit()
            throw "Bridge secret-store verification timed out."
        }
        $verifyProcess.WaitForExit()
        if ($verifyProcess.ExitCode -ne 0) {
            throw "Bridge secret-store verification failed: $($verifyStderrTask.Result.Trim())"
        }
    }

    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    if ($null -eq $settings.Bridge -or $null -eq $settings.Bridge.HttpsCertificate) {
        throw "Installed Bridge settings are missing Bridge.HttpsCertificate."
    }
    $settings.Bridge.HttpsCertificate.Path = $targetCertificate.Replace('\', '/')
    $settings.Bridge.HttpsCertificate.Password = ""
    $settingsTemp = "$settingsPath.$([Guid]::NewGuid().ToString('N')).tmp"
    $settings | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $settingsTemp -Encoding utf8
    Move-Item -LiteralPath $settingsTemp -Destination $settingsPath -Force
    $savedSettings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    if (-not [string]::IsNullOrEmpty($savedSettings.Bridge.HttpsCertificate.Password) -or
        $savedSettings.Bridge.HttpsCertificate.Path -ne $targetCertificate.Replace('\', '/')) {
        throw "Installed Bridge HTTPS settings did not preserve the empty-password invariant."
    }

    if (-not [string]::IsNullOrWhiteSpace($EvidencePath)) {
        $evidenceFullPath = [IO.Path]::GetFullPath($EvidencePath)
        $evidenceDirectory = Split-Path -Parent $evidenceFullPath
        if (-not [string]::IsNullOrWhiteSpace($evidenceDirectory)) {
            New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
        }
        $evidence = [ordered]@{
            schemaVersion = 1
            kind = "bridge-https"
            platform = if ($IsWindows) { "windows" } else { "macos" }
            version = $version
            generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
            certificateThumbprint = $certificate.Thumbprint
            certificateNotBefore = $certificate.NotBefore.ToUniversalTime().ToString("O")
            certificateNotAfter = $certificate.NotAfter.ToUniversalTime().ToString("O")
            expectedHosts = @($ExpectedHosts)
            trustValidated = $true
            secretStoreVerified = $true
            configurationPasswordEmpty = $true
        }
        $evidenceTemp = "$evidenceFullPath.$([Guid]::NewGuid().ToString('N')).tmp"
        $evidence | ConvertTo-Json -Depth 6 |
            Set-Content -LiteralPath $evidenceTemp -Encoding utf8
        Move-Item -LiteralPath $evidenceTemp -Destination $evidenceFullPath -Force
        Write-Host "Wrote trusted Bridge HTTPS evidence to $evidenceFullPath"
    }

    Write-Host "Provisioned Bridge HTTPS certificate $($certificate.Thumbprint) through $($certificate.NotAfter.ToString('u'))."
    if ($SkipSecretStoreWrite) {
        Write-Host "Repository smoke skipped the platform secret-store write."
    } else {
        Write-Host "The PFX password is stored in the current user's platform secret store."
        if ($IsWindows) {
            $launcherPath = Join-Path $root "start-bridge.cmd"
            if (Test-Path -LiteralPath $launcherPath -PathType Leaf) {
                Start-Process -FilePath $launcherPath -WorkingDirectory $root `
                    -WindowStyle Hidden
                Write-Host "Started the provisioned Windows Bridge."
            }
        }
        elseif ($IsMacOS) {
            $launchAgentPath = Join-Path `
                ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) `
                "Library/LaunchAgents/com.wordollama.desktopbridge.plist"
            if (Test-Path -LiteralPath $launchAgentPath -PathType Leaf) {
                $uid = (& id -u).Trim()
                if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($uid)) {
                    throw "Unable to resolve the macOS user id for Bridge activation."
                }
                & launchctl bootout "gui/$uid" $launchAgentPath 2>$null
                & launchctl bootstrap "gui/$uid" $launchAgentPath
                if ($LASTEXITCODE -ne 0) {
                    throw "Bridge HTTPS was provisioned, but LaunchAgent bootstrap failed."
                }
                & launchctl kickstart -k "gui/$uid/com.wordollama.desktopbridge"
                if ($LASTEXITCODE -ne 0) {
                    throw "Bridge HTTPS was provisioned, but LaunchAgent startup failed."
                }
                Write-Host "Activated the provisioned macOS Bridge LaunchAgent."
            }
        }
    }
}
finally {
    if ($null -ne $certificate) { $certificate.Dispose() }
    if ($null -ne $passwordPointer -and $passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $plainPassword = $null
}
