[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",
    [string]$BridgeAssemblyPath = "",
    [string]$BuildRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$bridgeProject = Join-Path $repoRoot "src\WordOllama.DesktopBridge\WordOllama.DesktopBridge.csproj"
$providerFixture = Join-Path $repoRoot "officejs\test-fixtures\fake-provider-server.mjs"
$mcpFixture = Join-Path $repoRoot "officejs\test-fixtures\fake-mcp-server.mjs"
$smokeRoot = if ([string]::IsNullOrWhiteSpace($BuildRoot)) {
    Join-Path $repoRoot ".build-bridge-live-api-smoke"
} else {
    [IO.Path]::GetFullPath($BuildRoot)
}
$origin = "https://localhost:3000"
$nodeCommand = if ($IsWindows) { "node.exe" } else { "node" }
$node = (Get-Command $nodeCommand -ErrorAction Stop).Source
$dotnet = (Get-Command dotnet -ErrorAction Stop).Source
$bridgeProcess = $null
$providerProcess = $null

function Get-FreeLoopbackPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port }
    finally { $listener.Stop() }
}

function Stop-SmokeProcess {
    param($Process)
    if ($null -eq $Process) { return }
    try {
        if (-not $Process.HasExited) {
            $Process.Kill($true)
            $Process.WaitForExit(10000) | Out-Null
        }
    }
    catch {
        Write-Warning "Unable to stop smoke process $($Process.Id): $($_.Exception.Message)"
    }
    finally {
        $Process.Dispose()
    }
}

function Start-RedirectedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory = $true)][hashtable]$Environment,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FileName
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $startInfo.ArgumentList.Add($argument) }
    foreach ($entry in $Environment.GetEnumerator()) {
        $startInfo.Environment[[string]$entry.Key] = [string]$entry.Value
    }
    return [Diagnostics.Process]::Start($startInfo)
}

function Wait-BridgeReady {
    param([Parameter(Mandatory = $true)][string]$BaseUrl)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        if ($null -ne $script:bridgeProcess -and $script:bridgeProcess.HasExited) {
            $stdout = $script:bridgeProcess.StandardOutput.ReadToEnd()
            $stderr = $script:bridgeProcess.StandardError.ReadToEnd()
            throw "Live Bridge exited before readiness. stdout: $stdout stderr: $stderr"
        }
        try {
            $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" -TimeoutSec 2
            if ($health.ready -eq $true -and $health.protocolVersion -eq "1.0") { return $health }
        }
        catch { Start-Sleep -Milliseconds 150 }
    }
    throw "Live Bridge did not become ready at $BaseUrl."
}

function New-BridgeSession {
    param([Parameter(Mandatory = $true)][string]$BaseUrl)
    $response = Invoke-RestMethod -Method Post -Uri "$BaseUrl/pair/automatic" `
        -Headers @{ Origin = $origin } -ContentType "application/json" `
        -Body (@{ origin = $origin } | ConvertTo-Json)
    if ($response.protocolVersion -ne "1.0" -or
        [string]::IsNullOrWhiteSpace([string]$response.sessionToken) -or
        [string]::IsNullOrWhiteSpace([string]$response.csrfToken)) {
        throw "Live Bridge pairing did not return a protocol 1.0 session."
    }
    $script:csrfToken = [string]$response.csrfToken
    return [string]$response.sessionToken
}

function Invoke-Bridge {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][string]$Token,
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        $Body = $null
    )
    $parameters = @{
        Method = $Method
        Uri = "$BaseUrl$Path"
        Headers = @{
            Origin = $origin
            "X-WordOllama-Session" = $Token
            "X-WordOllama-CSRF" = $script:csrfToken
        }
        TimeoutSec = 15
    }
    if ($null -ne $Body) {
        $parameters.ContentType = "application/json"
        $parameters.Body = $Body | ConvertTo-Json -Depth 12
    }
    Write-Verbose "Bridge request: $Method $Path"
    return Invoke-RestMethod @parameters
}

function Start-IsolatedBridge {
    param(
        [Parameter(Mandatory = $true)][string]$AssemblyPath,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][int]$ProviderPort
    )
    $environment = @{
        "ASPNETCORE_ENVIRONMENT" = "Development"
        "Bridge__Urls" = "http://127.0.0.1:$Port"
        "Bridge__AllowedOrigins__0" = $origin
        "Bridge__ProviderSettingsPath" = (Join-Path $smokeRoot "provider-settings.json")
        "Bridge__McpSettingsPath" = (Join-Path $smokeRoot "mcp-settings.json")
        "Bridge__ReviewSettingsPath" = (Join-Path $smokeRoot "review-settings.json")
        "Bridge__AgentRecoveryPath" = (Join-Path $smokeRoot "agent-recovery.bin")
        "Bridge__OllamaServerSettingsPath" = (Join-Path $smokeRoot "ollama-server-settings.json")
        "Bridge__MigrateLegacyUserData" = "false"
        # A packaged fixture carries a fake signed-update configuration. This
        # live API test specifically exercises the fail-closed unconfigured
        # installer path, so isolate it from package metadata.
        "Bridge__Updates__IndexUrl" = ""
        "Bridge__Updates__ExpectedPublisherSubject" = ""
        "Bridge__ModelProvider__Type" = "OpenAI"
        "Bridge__ModelProvider__Endpoint" = "http://127.0.0.1:$ProviderPort/v1"
        "Bridge__ModelProvider__Model" = "fake-openai"
        "Bridge__LocalTools__AllowedExecutables__0" = "node.exe"
        "Bridge__LocalTools__AllowedExecutables__1" = "node"
        "Bridge__LocalTools__AuthorizedRoots__0" = $repoRoot
        "Bridge__LocalTools__SkillsRoot" = (Join-Path $repoRoot "src\WordOllama.DesktopBridge\Skills")
    }
    $isFrameworkDependentAssembly = [IO.Path]::GetExtension($AssemblyPath) -eq ".dll"
    $fileName = if ($isFrameworkDependentAssembly) { $dotnet } else { $AssemblyPath }
    $arguments = if ($isFrameworkDependentAssembly) { @($AssemblyPath) } else { @() }
    return Start-RedirectedProcess -FileName $fileName -Arguments $arguments `
        -Environment $environment -WorkingDirectory $repoRoot
}

New-Item -ItemType Directory -Force -Path $smokeRoot | Out-Null
if ([string]::IsNullOrWhiteSpace($BridgeAssemblyPath)) {
    & $dotnet build $bridgeProject -c $Configuration
    if ($LASTEXITCODE -ne 0) { throw "Live Bridge smoke build failed with exit code $LASTEXITCODE." }
    $BridgeAssemblyPath = Join-Path $repoRoot `
        "src\WordOllama.DesktopBridge\bin\$Configuration\net8.0\WordOllama.DesktopBridge.dll"
}
$bridgeAssembly = (Resolve-Path -LiteralPath $BridgeAssemblyPath).Path
$providerPort = Get-FreeLoopbackPort
$bridgePort = Get-FreeLoopbackPort
$baseUrl = "http://127.0.0.1:$bridgePort"

try {
    $providerProcess = Start-RedirectedProcess -FileName $node `
        -Arguments @($providerFixture) `
        -Environment @{ PORT = $providerPort; TOOL_NAME = "get_selection"; TOOL_ARGS = "{}" } `
        -WorkingDirectory $repoRoot
    $bridgeProcess = Start-IsolatedBridge -AssemblyPath $bridgeAssembly `
        -Port $bridgePort -ProviderPort $providerPort
    $health = Wait-BridgeReady -BaseUrl $baseUrl
    if (@($health.capabilities) -notcontains "encrypted-agent-recovery") {
        throw "Live Bridge did not enable encrypted Agent recovery."
    }
    $token = New-BridgeSession -BaseUrl $baseUrl

    $missingCsrfRejected = $false
    try {
        Invoke-RestMethod -Method Post -Uri "$baseUrl/updates/install" -Headers @{
            Origin = $origin
            "X-WordOllama-Session" = $token
        } -TimeoutSec 5 | Out-Null
    }
    catch { $missingCsrfRejected = $_.Exception.Response.StatusCode.value__ -eq 403 }
    if (-not $missingCsrfRejected) { throw "Live Bridge accepted a state-changing request without CSRF." }

    $wrongContentTypeRejected = $false
    try {
        Invoke-RestMethod -Method Post -Uri "$baseUrl/providers/chat" -Headers @{
            Origin = $origin
            "X-WordOllama-Session" = $token
            "X-WordOllama-CSRF" = $script:csrfToken
        } -ContentType "text/plain" -Body "{}" -TimeoutSec 5 | Out-Null
    }
    catch { $wrongContentTypeRejected = $_.Exception.Response.StatusCode.value__ -eq 415 }
    if (-not $wrongContentTypeRejected) { throw "Live Bridge accepted a JSON API request with text/plain." }

    $unauthorizedRejected = $false
    try { Invoke-RestMethod -Method Get -Uri "$baseUrl/settings/providers" -TimeoutSec 5 | Out-Null }
    catch { $unauthorizedRejected = $_.Exception.Response.StatusCode.value__ -eq 401 }
    if (-not $unauthorizedRejected) { throw "Live Bridge accepted a settings request without pairing." }
    $unauthorizedUpdateInstallRejected = $false
    try { Invoke-RestMethod -Method Post -Uri "$baseUrl/updates/install" -TimeoutSec 5 | Out-Null }
    catch { $unauthorizedUpdateInstallRejected = $_.Exception.Response.StatusCode.value__ -eq 401 }
    if (-not $unauthorizedUpdateInstallRejected) {
        throw "Live Bridge accepted an update installer request without pairing."
    }
    $unconfiguredUpdateInstallRejected = $false
    try {
        Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Post `
            -Path "/updates/install" | Out-Null
    }
    catch {
        $unconfiguredUpdateInstallRejected =
            $_.Exception.Response.StatusCode.value__ -eq 400
    }
    if (-not $unconfiguredUpdateInstallRejected) {
        throw "Live Bridge did not reject installer launch without a configured signed update."
    }

    $profile = @{
        id = "live-openai"
        name = "Live OpenAI fixture"
        type = "OpenAI"
        endpoint = "http://127.0.0.1:$providerPort/v1"
        model = "fake-openai"
        toolCallingMode = "Auto"
        supportsStreaming = $true
        contextWindow = 8192
        temperature = 0.2
        maxTokens = 1024
        keepAlive = "5m"
    }
    $providers = Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Put `
        -Path "/settings/providers/live-openai" -Body $profile
    $providers = Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Post `
        -Path "/settings/providers/live-openai/activate"
    if ($providers.activeProviderId -ne "live-openai") {
        throw "Live Provider profile was not activated."
    }
    $providerTest = Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Post `
        -Path "/settings/providers/models" -Body $profile
    if ($providerTest.provider -ne "OpenAI" -or @($providerTest.models) -notcontains "fake-openai") {
        throw "Live Provider test did not reach the controlled OpenAI-compatible server."
    }

    $mcp = Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Post `
        -Path "/mcp/servers" -Body @{
            name = "live-mcp"
            transport = "stdio"
            command = $node
            arguments = @($mcpFixture)
            workingDirectory = $repoRoot
            environment = @{}
            headers = @{}
            enabled = $true
            trusted = $false
        }
    if ($mcp.toolCount -ne 1 -or @($mcp.tools).name -notcontains "echo") {
        throw "Live MCP stdio connection did not expose the echo tool."
    }
    Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Put `
        -Path "/mcp/servers/live-mcp/permissions" -Body @{ echo = $true } | Out-Null
    $mcpCall = Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Post `
        -Path "/mcp/tools/call" -Body @{
            serverName = "live-mcp"
            toolName = "echo"
            arguments = @{ message = "persisted" }
        }
    if (($mcpCall.result | ConvertTo-Json -Compress) -notlike "*echo:persisted*") {
        throw "Live MCP tool call returned an unexpected result."
    }

    Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Post -Path "/capabilities" -Body @{
        tools = @(@{
            name = "get_selection"
            description = "Return selected Word text."
            isWriteOperation = $false
            parameterSchema = @{ type = "object"; properties = @{} }
        })
    } | Out-Null
    $agent = Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Post `
        -Path "/agent/sessions" -Body @{
            userRequirement = "Prove encrypted recovery across a Bridge restart."
            model = "fake-openai"
            requirePlanConfirmation = $false
            maxIterations = 4
            executionMode = "TrackedChanges"
            allowExternalTools = $false
        }
    $sessionId = [string]$agent.sessionId
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 100
        $checkpoint = Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Get `
            -Path "/agent/sessions/$sessionId/checkpoint"
    } while ($checkpoint.iteration -lt 1 -and [DateTimeOffset]::UtcNow -lt $deadline)
    if ($checkpoint.iteration -lt 1 -or
        -not (Test-Path -LiteralPath (Join-Path $smokeRoot "agent-recovery.bin"))) {
        throw "Live Agent did not persist its encrypted checkpoint."
    }

    Stop-SmokeProcess -Process $bridgeProcess
    $bridgeProcess = $null
    $bridgeProcess = Start-IsolatedBridge -AssemblyPath $bridgeAssembly `
        -Port $bridgePort -ProviderPort $providerPort
    Wait-BridgeReady -BaseUrl $baseUrl | Out-Null
    $token = New-BridgeSession -BaseUrl $baseUrl

    $providers = Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Get `
        -Path "/settings/providers"
    if ($providers.activeProviderId -ne "live-openai" -or
        @($providers.profiles).id -notcontains "live-openai") {
        throw "Provider settings did not survive a real Bridge restart."
    }
    $servers = @(Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Get `
        -Path "/mcp/servers")
    if ($servers.name -notcontains "live-mcp" -or
        $servers[0].toolPermissions.echo -ne $true) {
        throw "MCP settings or permissions did not survive a real Bridge restart."
    }
    $recoveries = @(Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Get `
        -Path "/agent/recoveries")
    if ($recoveries.sessionId -notcontains $sessionId) {
        throw "Encrypted Agent recovery was not available after a real Bridge restart."
    }

    $resumed = $false
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
    do {
        try {
            Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Post `
                -Path "/agent/sessions/$sessionId/tool-results" -Body @{
                    callId = "call_openai"
                    result = "Recovered Word selection"
                    isError = $false
                } | Out-Null
            $resumed = $true
        }
        catch { Start-Sleep -Milliseconds 100 }
    } while (-not $resumed -and [DateTimeOffset]::UtcNow -lt $deadline)
    if (-not $resumed) { throw "Recovered Agent session did not resume its pending Word tool call." }

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 100
        $checkpoint = Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Get `
            -Path "/agent/sessions/$sessionId/checkpoint"
    } while ($checkpoint.iteration -lt 2 -and [DateTimeOffset]::UtcNow -lt $deadline)
    if ($checkpoint.iteration -lt 2) {
        throw "Recovered Agent session did not advance after accepting the Word tool result."
    }
    Invoke-Bridge -BaseUrl $baseUrl -Token $token -Method Post `
        -Path "/agent/sessions/$sessionId/cancel" | Out-Null

    Write-Host "Live Bridge API smoke passed: pairing, Provider, MCP, encrypted Agent recovery, and restart persistence."
}
finally {
    Stop-SmokeProcess -Process $bridgeProcess
    Stop-SmokeProcess -Process $providerProcess
    if (Test-Path -LiteralPath $smokeRoot) {
        $resolvedSmokeRoot = (Resolve-Path -LiteralPath $smokeRoot).Path
        $resolvedRepoRoot = [IO.Path]::GetFullPath($repoRoot).TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar)
        if (-not $resolvedSmokeRoot.StartsWith(
                $resolvedRepoRoot + [IO.Path]::DirectorySeparatorChar,
                [StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($resolvedSmokeRoot) -ne ".build-bridge-live-api-smoke") {
            throw "Refusing to remove unexpected live Bridge smoke path: $resolvedSmokeRoot"
        }
        Remove-Item -LiteralPath $resolvedSmokeRoot -Recurse -Force
    }
}
