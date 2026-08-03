using WordOllama.Core;
using WordOllama.Contracts;
using WordOllama.DesktopBridge;
using WordOllama.Mcp;
using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Microsoft.Extensions.Configuration;

var root = Path.Combine(Path.GetTempPath(), "wordollama-mcp-settings-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    var sessionConfiguration = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Bridge:PairingCode"] = "session-smoke-code",
            ["Bridge:AllowedOrigins:0"] = "https://localhost:37421",
        })
        .Build();
    var sessionClock = new ManualTimeProvider(DateTimeOffset.Parse("2026-08-02T00:00:00Z"));
    var sessionStore = new BridgeSessionStore(sessionConfiguration, isDevelopment: false, sessionClock);
    Assert(!sessionStore.TryGet(null, "https://localhost:37421", out _),
        "first install starts without an implicit authenticated session");
    var sharedSession = sessionStore.Create("https://localhost:37421");
    sessionStore.RegisterOfficeTools(sharedSession.Token, [new OfficeToolDescriptor(
        "get_selection", "read", false, System.Text.Json.JsonSerializer.SerializeToElement(new { type = "object" }))]);
    Assert(sessionStore.TryGet(sharedSession.Token, "https://localhost:37421", out var secondPaneSession) &&
           secondPaneSession.CsrfToken == sharedSession.CsrfToken &&
           sessionStore.GetOfficeTools(sharedSession.Token).Count == 1,
        "multiple task panes share one authenticated session and Office tool catalog");
    sessionClock.Advance(TimeSpan.FromHours(9));
    Assert(!sessionStore.TryGet(sharedSession.Token, "https://localhost:37421", out _) &&
           sessionStore.GetOfficeTools(sharedSession.Token).Count == 1,
        "expired sessions are rejected before the next cleanup pass");
    _ = sessionStore.Create("https://localhost:37421");
    Assert(sessionStore.GetOfficeTools(sharedSession.Token).Count == 0,
        "creating a fresh session cleans expired session capabilities");

    Assert(
        Path.GetFileName(PlatformPaths.GetSettingsRoot()) ==
            PlatformPaths.ProductDirectoryName &&
        Path.GetFullPath(PlatformPaths.GetSkillsRoot()).StartsWith(
            Path.GetFullPath(PlatformPaths.GetSettingsRoot()) +
                Path.DirectorySeparatorChar,
            OperatingSystem.IsWindows()
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal),
        "WordOllama.JS settings and Skills use an isolated product profile");

    var legacySettingsRoot = Path.Combine(root, "legacy-settings");
    var isolatedSettingsRoot = Path.Combine(root, "WordOllama.JS");
    var legacySkillsRoot = Path.Combine(root, "legacy-skills");
    var isolatedSkillsRoot = Path.Combine(isolatedSettingsRoot, "Skills");
    Directory.CreateDirectory(legacySettingsRoot);
    Directory.CreateDirectory(legacySkillsRoot);
    Directory.CreateDirectory(isolatedSettingsRoot);
    File.WriteAllText(
        Path.Combine(legacySettingsRoot, "provider-settings.json"),
        """{"source":"legacy"}""");
    File.WriteAllText(
        Path.Combine(legacySettingsRoot, "unrelated-com-state.json"),
        """{"must":"remain isolated"}""");
    File.WriteAllText(
        Path.Combine(isolatedSettingsRoot, "mcp-settings.json"),
        """{"source":"current"}""");
    Directory.CreateDirectory(Path.Combine(legacySkillsRoot, "legal"));
    File.WriteAllText(
        Path.Combine(legacySkillsRoot, "legal", "SKILL.md"),
        "# Legacy legal Skill");
    Directory.CreateDirectory(Path.Combine(isolatedSkillsRoot, "legal"));
    File.WriteAllText(
        Path.Combine(isolatedSkillsRoot, "legal", "local.txt"),
        "keep current");

    var migration = LegacyUserDataMigrator.Migrate(
        legacySettingsRoot,
        isolatedSettingsRoot,
        legacySkillsRoot,
        isolatedSkillsRoot);
    Assert(
        migration.SettingsFilesCopied == 1 &&
        migration.SkillFilesCopied == 1 &&
        !migration.AlreadyCompleted &&
        File.Exists(Path.Combine(isolatedSettingsRoot, "provider-settings.json")) &&
        !File.Exists(Path.Combine(isolatedSettingsRoot, "unrelated-com-state.json")) &&
        File.Exists(Path.Combine(isolatedSkillsRoot, "legal", "SKILL.md")) &&
        File.ReadAllText(Path.Combine(isolatedSkillsRoot, "legal", "local.txt")) ==
            "keep current",
        "legacy Bridge settings and Skills are copied once without importing unrelated COM state");
    File.WriteAllText(
        Path.Combine(legacySettingsRoot, "provider-settings.json"),
        """{"source":"changed-after-migration"}""");
    var repeatedMigration = LegacyUserDataMigrator.Migrate(
        legacySettingsRoot,
        isolatedSettingsRoot,
        legacySkillsRoot,
        isolatedSkillsRoot);
    Assert(
        repeatedMigration.AlreadyCompleted &&
        File.ReadAllText(Path.Combine(isolatedSettingsRoot, "provider-settings.json"))
            .Contains("legacy", StringComparison.Ordinal) &&
        File.Exists(Path.Combine(legacySettingsRoot, "provider-settings.json")) &&
        File.Exists(Path.Combine(legacySkillsRoot, "legal", "SKILL.md")),
        "legacy data migration is idempotent and never removes COM-era sources");

    var secrets = new MemorySecretStore();
    var providerSettingsPath = Path.Combine(root, "model-profiles.json");
    var providerSettings = new ProviderSettingsStore(
        providerSettingsPath,
        new ModelProviderOptions(
            "Ollama",
            "http://127.0.0.1:11434",
            string.Empty,
            "llama3.2"),
        secrets);
    Assert(
        providerSettings.GetView() is { ActiveProviderId: "", Profiles.Count: 0 } &&
        providerSettings.GetActiveOptions() is null,
        "a fresh install has no implicit Ollama model or active model");
    providerSettings.Upsert(new ProviderProfileUpdate(
        "deepseek-v4-flash",
        "DeepSeek",
        "OpenAI",
        "https://api.deepseek.com",
        "deepseek-v4-flash"));
    providerSettings.Upsert(new ProviderProfileUpdate(
        "deepseek-reasoner",
        "DeepSeek",
        "OpenAI",
        "https://api.deepseek.com",
        "deepseek-reasoner"));
    Assert(
        providerSettings.GetView() is { ActiveProviderId: "", Profiles.Count: 2 },
        "multiple models from one provider can be saved without implicit activation");
    providerSettings.Activate("deepseek-v4-flash");
    var afterActiveDelete = providerSettings.Delete("deepseek-v4-flash");
    Assert(
        afterActiveDelete is { ActiveProviderId: "", Profiles.Count: 1 } &&
        providerSettings.GetActiveOptions() is null,
        "deleting the active model does not silently activate another model");
    var afterLastDelete = providerSettings.Delete("deepseek-reasoner");
    Assert(
        afterLastDelete is { ActiveProviderId: "", Profiles.Count: 0 },
        "the saved model list can be emptied completely");

    var secretOutput = new StringWriter();
    var secretError = new StringWriter();
    Assert(HttpsCertificateSecretCommand.IsRequested(["https-certificate-secret", "invalid"]) &&
           HttpsCertificateSecretCommand.Execute(
               ["https-certificate-secret", "invalid"],
               secrets,
               TextReader.Null,
               secretOutput,
               secretError,
               inputIsRedirected: true) == 2,
        "invalid HTTPS secret subcommands fail instead of starting the server");
    var secretSetExit = HttpsCertificateSecretCommand.Execute(
        ["https-certificate-secret", "set"],
        secrets,
        new StringReader("pfx-password\r\n"),
        secretOutput,
        secretError,
        inputIsRedirected: true);
    Assert(secretSetExit == 0 &&
           secrets.Get(HttpsCertificateSecretCommand.SecretName) == "pfx-password" &&
           !secretOutput.ToString().Contains("pfx-password", StringComparison.Ordinal),
        "HTTPS PFX password is provisioned without echoing it");
    var secretVerifyOutput = new StringWriter();
    var secretVerifyExit = HttpsCertificateSecretCommand.Execute(
        ["https-certificate-secret", "verify"],
        secrets,
        TextReader.Null,
        secretVerifyOutput,
        secretError,
        inputIsRedirected: false);
    Assert(secretVerifyExit == 0 &&
           secretVerifyOutput.ToString().Contains("exists", StringComparison.OrdinalIgnoreCase) &&
           !secretVerifyOutput.ToString().Contains("pfx-password", StringComparison.Ordinal),
        "HTTPS PFX password presence is verified without revealing it");
    using (var key = RSA.Create(2048))
    {
        var certificateRequest = new CertificateRequest(
            "CN=李伯阳/Boyang Li",
            key,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        using var certificate = certificateRequest.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddMinutes(-1),
            DateTimeOffset.UtcNow.AddDays(1));
        var pfxPath = Path.Combine(root, "bridge.pfx");
        File.WriteAllBytes(
            pfxPath,
            certificate.Export(X509ContentType.Pfx, "pfx-password"));
        var certificateVerifyExit = HttpsCertificateSecretCommand.Execute(
            ["https-certificate-secret", "verify-certificate", pfxPath, certificate.Thumbprint],
            secrets,
            TextReader.Null,
            TextWriter.Null,
            secretError,
            inputIsRedirected: false);
        var wrongCertificateVerifyExit = HttpsCertificateSecretCommand.Execute(
            ["https-certificate-secret", "verify-certificate", pfxPath, "00"],
            secrets,
            TextReader.Null,
            TextWriter.Null,
            secretError,
            inputIsRedirected: false);
        Assert(certificateVerifyExit == 0 && wrongCertificateVerifyExit == 1,
            "HTTPS PFX identity is verified through the platform secret without revealing it");
    }
    var interactiveSecretExit = HttpsCertificateSecretCommand.Execute(
        ["https-certificate-secret", "set"],
        secrets,
        new StringReader("must-not-be-read"),
        TextWriter.Null,
        secretError,
        inputIsRedirected: false);
    Assert(interactiveSecretExit == 2 &&
           secrets.Get(HttpsCertificateSecretCommand.SecretName) == "pfx-password",
        "interactive secret input is rejected before reading");
    var secretDeleteExit = HttpsCertificateSecretCommand.Execute(
        ["https-certificate-secret", "delete"],
        secrets,
        TextReader.Null,
        TextWriter.Null,
        secretError,
        inputIsRedirected: false);
    Assert(secretDeleteExit == 0 &&
           secrets.Get(HttpsCertificateSecretCommand.SecretName) is null,
        "HTTPS PFX password can be removed from the platform vault");
    Assert(HttpsCertificateSecretCommand.Execute(
               ["https-certificate-secret", "verify"],
               secrets,
               TextReader.Null,
               TextWriter.Null,
               TextWriter.Null,
               inputIsRedirected: false) == 1,
        "HTTPS PFX password verification fails after deletion");

    var manager = new McpManager();
    var path = Path.Combine(root, "mcp-settings.json");
    var settings = new McpSettingsStore(path, secrets);
    var view = settings.Upsert(new McpServerUpdate(
        "legal",
        "streamable-http",
        "https://mcp.example.test/rpc",
        Headers: new Dictionary<string, string> { ["Authorization"] = "Bearer top-secret" },
        Enabled: true,
        Trusted: false), manager);
    Assert(view.HeaderKeys.SequenceEqual(["Authorization"]) && !view.Connected, "safe MCP view");
    Assert(!File.ReadAllText(path).Contains("top-secret", StringComparison.Ordinal), "MCP secret excluded from JSON");
    var request = settings.GetRequest("legal");
    Assert(request.Headers?["Authorization"] == "Bearer top-secret", "MCP secret restored from vault");
    var editedRequest = settings.BuildRequest(new McpServerUpdate(
        "legal",
        "streamable-http",
        "https://mcp.example.test/rpc",
        Headers: new Dictionary<string, string> { ["Authorization"] = "" }));
    Assert(editedRequest.Headers?["Authorization"] == "Bearer top-secret",
        "blank secret editor values retain existing vault values");
    Assert(!settings.IsToolAllowed("legal", "search"), "new untrusted MCP tools default deny");
    settings.SetToolPermissions("legal", new Dictionary<string, bool> { ["search"] = true, ["delete"] = false });
    Assert(settings.IsToolAllowed("legal", "search") && !settings.IsToolAllowed("legal", "delete"),
        "per-tool MCP permissions");
    var searchView = settings.Upsert(new McpServerUpdate(
        "legal",
        "streamable-http",
        "https://mcp.example.test/rpc",
        Headers: new Dictionary<string, string> { ["Authorization"] = "" },
        Enabled: true,
        Trusted: false,
        WebSearchEnabled: true,
        SearchToolName: "search",
        AllowedDomains: ["Example.COM", "docs.example.com", "example.com"],
        SearchMaxCalls: 500,
        SearchMaxResultCharacters: 500), manager);
    Assert(searchView.WebSearchEnabled && searchView.SearchToolName == "search" &&
           searchView.AllowedDomains.SequenceEqual(["example.com", "docs.example.com"]) &&
           searchView.SearchMaxCalls == 50 && searchView.SearchMaxResultCharacters == 1000,
        "Search MCP settings normalize domains and clamp limits");
    var missingSearchToolRejected = false;
    try
    {
        settings.Upsert(new McpServerUpdate(
            "invalid-search", "streamable-http", "https://mcp.example.test/rpc",
            WebSearchEnabled: true), manager);
    }
    catch (ArgumentException)
    {
        missingSearchToolRejected = true;
    }
    Assert(missingSearchToolRejected, "Search MCP requires an explicitly selected tool");
    settings.Upsert(new McpServerUpdate(
        "trusted",
        "sse",
        "https://trusted.example.test/events",
        Enabled: false,
        Trusted: true), manager);
    Assert(settings.IsToolAllowed("trusted", "any-tool"), "trusted MCP server allows discovered tools");
    var imported = settings.ImportJson(
        """
        {
          "mcpServers": {
            "legal": {
              "type": "streamable_http",
              "url": "https://mcp.example.test/v2",
              "headers": { "Authorization": "Bearer imported-secret" },
              "enabled": false,
              "trusted": true
            },
            "local-search": {
              "command": "node",
              "args": ["server.js", "--mode", "safe"],
              "env": { "SEARCH_TOKEN": "import-token" }
            }
          }
        }
        """,
        manager);
    Assert(imported is { Total: 2, Added: 1, Updated: 1 }, "MCP JSON import add/update summary");
    var importedViews = settings.GetViews(manager);
    var importedLegal = importedViews.Single(item => item.Name == "legal");
    Assert(importedLegal.Transport == "streamable-http" &&
           importedLegal.Command == "https://mcp.example.test/v2" &&
           !importedLegal.Trusted &&
           importedLegal.ToolPermissions.Count == 0,
        "MCP JSON import normalizes transport and resets trust and permissions");
    var importedLocal = settings.GetRequest("local-search");
    Assert(importedLocal.Arguments!.SequenceEqual(["server.js", "--mode", "safe"]) &&
           importedLocal.Environment?["SEARCH_TOKEN"] == "import-token",
        "MCP JSON import preserves argument arrays and secrets");
    Assert(!File.ReadAllText(path).Contains("import-token", StringComparison.Ordinal),
        "imported MCP secrets are excluded from JSON");
    var legacyMcpPath = Path.Combine(root, "mcp-servers.json");
    var migratedMcpPath = Path.Combine(root, "mcp-settings-migrated.json");
    File.WriteAllText(legacyMcpPath,
        """
        {
          "mcpServers": {
            "legacy-search": {
              "transport": "streamable_http",
              "url": "https://legacy.example.test/mcp",
              "enabled": true
            }
          }
        }
        """);
    var migratedSettings = new McpSettingsStore(
        migratedMcpPath,
        secrets,
        legacyMcpPath);
    var migratedView = migratedSettings.GetViews(manager).Single(item =>
        item.Name == "legacy-search");
    Assert(File.Exists(migratedMcpPath) &&
           migratedView.Transport == "streamable-http" &&
           !migratedView.Trusted,
        "COM mcp-servers.json is loaded and normalized into the JS settings store");
    var failedHealthRecorded = false;
    try
    {
        await manager.ConnectAsync(new McpServerRequest(
            "broken",
            "unused",
            Transport: "Bearer top-secret"));
    }
    catch (ArgumentException)
    {
        var state = manager.GetServerStates().Single(item => item.Name == "broken");
        failedHealthRecorded =
            !state.Connected &&
            state.LastCheckDurationMs is not null &&
            state.LastError?.Contains("[REDACTED]", StringComparison.Ordinal) == true &&
            !state.LastError.Contains("top-secret", StringComparison.Ordinal);
    }
    Assert(failedHealthRecorded, "failed MCP health is retained with secrets redacted");
    await manager.RemoveAsync("broken");
    Assert(manager.GetServerStates().All(item => item.Name != "broken"),
        "deleted MCP servers cannot reconnect from stale connection state");
    var tampered = Path.Combine(root, "tampered.json");
    File.WriteAllText(tampered,
        """[{"name":"bad","transport":"streamable-http","command":"http://example.com/rpc","arguments":[],"environmentKeys":[],"headerKeys":[],"enabled":true,"trusted":false,"toolPermissions":{}}]""");
    var rejected = false;
    try { _ = new McpSettingsStore(tampered, secrets); }
    catch (ArgumentException) { rejected = true; }
    Assert(rejected, "persisted MCP endpoints are revalidated");
    settings.Delete("legal");
    settings.Delete("local-search");
    Assert(secrets.Count == 0, "deleting MCP server deletes stored connection secrets");

    var recoveryPath = Path.Combine(root, "agent-recovery.bin");
    var recoveryStore = new EncryptedAgentRecoveryStore(recoveryPath, secrets);
    Assert(recoveryStore.Enabled, "Agent recovery encryption key is stored in the platform vault");
    var recoveryCheckpoint = new AgentCheckpoint(
        "recovery-session",
        2,
        3,
        "TrackedChanges",
        DateTimeOffset.UtcNow);
    var recoverySnapshot = new AgentRecoverySnapshot(
        "recovery-session",
        "https://localhost:3000",
        new AgentStartRequest("review confidential-contract-marker"),
        [
            new ChatMessage("system", "system"),
            new ChatMessage("user", "confidential-contract-marker"),
            new ChatMessage("tool", "tool-result", ToolCallId: "call-1", Name: "read_document"),
        ],
        2,
        recoveryCheckpoint,
        DateTimeOffset.UtcNow);
    recoveryStore.Save(recoverySnapshot);
    Assert(File.Exists(recoveryPath), "encrypted Agent checkpoint file is created");
    Assert(!Encoding.UTF8.GetString(File.ReadAllBytes(recoveryPath))
        .Contains("confidential-contract-marker", StringComparison.Ordinal),
        "Agent requirement and document context are not stored as plaintext");
    var restoredRecovery = new EncryptedAgentRecoveryStore(recoveryPath, secrets)
        .LoadAll()
        .Single();
    Assert(restoredRecovery.SessionId == "recovery-session" &&
           restoredRecovery.Messages.Last().ToolCallId == "call-1",
        "encrypted Agent checkpoint survives Bridge store reconstruction");
    var wrongSecrets = new MemorySecretStore();
    wrongSecrets.Set("agent-recovery-key-v1", Convert.ToBase64String(
        System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)));
    Assert(new EncryptedAgentRecoveryStore(recoveryPath, wrongSecrets).LoadAll().Count == 0,
        "Agent checkpoint cannot be decrypted with a different platform-vault key");
    var tamperedRecoveryPath = Path.Combine(root, "agent-recovery-tampered.bin");
    var tamperedRecoveryBytes = File.ReadAllBytes(recoveryPath);
    tamperedRecoveryBytes[^1] ^= 0x01;
    File.WriteAllBytes(tamperedRecoveryPath, tamperedRecoveryBytes);
    Assert(new EncryptedAgentRecoveryStore(tamperedRecoveryPath, secrets).LoadAll().Count == 0,
        "authenticated encryption rejects modified Agent checkpoint ciphertext");
    recoveryStore.Delete("recovery-session");
    Assert(!File.Exists(recoveryPath), "discarding Agent recovery removes the encrypted checkpoint");

    var ollamaSettingsPath = Path.Combine(root, "ollama-server-settings.json");
    IReadOnlyDictionary<string, string>? appliedOllamaVariables = null;
    var ollamaSettings = new OllamaServerSettingsStore(
        ollamaSettingsPath,
        variables => appliedOllamaVariables = new Dictionary<string, string>(variables));
    var savedOllamaSettings = ollamaSettings.SaveAndApply(
        new OllamaServerSettingsUpdate(
            Path.GetFullPath(root),
            "127.0.0.1:11434",
            "5m",
            32768,
            2,
            4,
            512));
    Assert(savedOllamaSettings.ContextLength == 32768, "Ollama server settings are returned after save");
    Assert(appliedOllamaVariables?["OLLAMA_HOST"] == "127.0.0.1:11434", "Ollama host is applied");
    Assert(appliedOllamaVariables?["OLLAMA_CONTEXT_LENGTH"] == "32768", "Ollama numeric settings are applied");
    var reloadedOllamaSettings = new OllamaServerSettingsStore(
        ollamaSettingsPath,
        _ => { }).Get();
    Assert(reloadedOllamaSettings.MaxQueue == 512, "Ollama server settings persist");
    var invalidOllamaHostRejected = false;
    try
    {
        ollamaSettings.SaveAndApply(
            new OllamaServerSettingsUpdate("", "user@host:11434", "", 0, 0, 0, 0));
    }
    catch (ArgumentException)
    {
        invalidOllamaHostRejected = true;
    }
    Assert(invalidOllamaHostRejected, "Ollama host rejects credentials and malformed authority");

    string? googleAuthorizationUrl = null;
    string? googleCallbackHtml = null;
    Task<string>? googleCallbackRequest = null;
    var googleTokenHandler = new GoogleOAuthExchangeHandler();
    var googleOAuth = new GoogleOAuthService(
        new HttpClient(googleTokenHandler),
        authorizationUrl =>
        {
            googleAuthorizationUrl = authorizationUrl;
            var query = ParseQuery(new Uri(authorizationUrl).Query);
            googleCallbackRequest = Task.Run(async () =>
            {
                using var callbackClient = new HttpClient();
                return await callbackClient.GetStringAsync(
                    $"{query["redirect_uri"]}?state={Uri.EscapeDataString(query["state"])}&code=smoke-code");
            });
        });
    var googleOAuthResult = await googleOAuth.AuthorizeAsync(new GoogleOAuthRequest(
        "client.apps.googleusercontent.com",
         "client-secret",
         "wordollama-smoke-project",
         "zh-CN"));
    googleCallbackHtml = await (googleCallbackRequest
        ?? throw new InvalidOperationException("Google OAuth callback request was not started"));
    var authorizationQuery = ParseQuery(new Uri(googleAuthorizationUrl!).Query);
    Assert(authorizationQuery["code_challenge_method"] == "S256", "Google OAuth uses PKCE S256");
    Assert(!string.IsNullOrWhiteSpace(authorizationQuery["code_challenge"]), "Google OAuth sends a PKCE challenge");
    Assert(googleTokenHandler.VerifierReceived, "Google OAuth exchanges the code with its PKCE verifier");
    Assert(googleOAuthResult.HasRefreshToken &&
           googleOAuthResult.Credential.RefreshToken == "refresh-token",
        "Google OAuth captures a durable refresh token");
    Assert(
        googleCallbackHtml?.Contains("认证完成", StringComparison.Ordinal) == true &&
        googleCallbackHtml.Contains("lang=\"zh-CN\"", StringComparison.Ordinal),
        "Google OAuth callback page follows the requested UI locale");
    var localizedOAuthValidation = string.Empty;
    try
    {
        await googleOAuth.AuthorizeAsync(new GoogleOAuthRequest("", null, null, "zh-CN"));
    }
    catch (ArgumentException exception)
    {
        localizedOAuthValidation = exception.Message;
    }
    Assert(
        localizedOAuthValidation.Contains("客户端 ID", StringComparison.Ordinal),
        "Google OAuth validation errors follow the requested UI locale");

    var updateRuntime = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture ==
        System.Runtime.InteropServices.Architecture.Arm64 ? "win-arm64" : "win-x64";
    if (OperatingSystem.IsMacOS())
    {
        updateRuntime = updateRuntime.Replace("win-", "osx-", StringComparison.Ordinal);
    }
    var installerExtension = OperatingSystem.IsMacOS() ? "pkg" : "exe";
    var installerPublisher = OperatingSystem.IsMacOS()
        ? "Developer ID Installer: WordOllama Test (TEAMID)"
        : "CN=WordOllama Test Publisher";
    var installerPayload = Encoding.UTF8.GetBytes("signed-installer-smoke-payload");
    var installerHash = Convert.ToHexString(
        System.Security.Cryptography.SHA256.HashData(installerPayload)).ToLowerInvariant();
    var installerThumbprint = new string('c', 40);
    var installerPublicKeySha256 = new string('d', 64);
    var updateIndex = $$"""
        {"schemaVersion":1,"product":"WordOllama","version":"1.2.0","generatedAt":"2026-07-29T00:00:00Z","releaseNotes":"smoke","artifacts":[{"runtime":"{{updateRuntime}}","url":"https://updates.example.test/bridge.zip","sha256":"{{new string('a', 64)}}","sizeBytes":12345,"signatureUrl":"https://updates.example.test/bridge.sig"}],"installers":[{"runtime":"{{updateRuntime}}","url":"https://updates.example.test/WordOllama-Installer.{{installerExtension}}","sha256":"{{installerHash}}","sizeBytes":{{installerPayload.Length}},"publisherSubject":"{{installerPublisher}}","signerThumbprint":"{{installerThumbprint}}","signerPublicKeySha256":"{{installerPublicKeySha256}}"}]}
        """;
    var updateService = new UpdateIndexService(
        new HttpClient(new StaticJsonHandler(updateIndex)),
        "https://updates.example.test/index.json",
        "1.1.0");
    var updateResult = await updateService.CheckAsync();
    Assert(updateResult.Configured && updateResult.UpdateAvailable &&
           updateResult.LatestVersion == "1.2.0" &&
           updateResult.Artifact?.Kind == "installer" &&
           updateResult.Artifact.Sha256 == installerHash &&
           updateResult.Artifact.PublisherSubject == installerPublisher &&
           updateResult.Artifact.Url.EndsWith($".{installerExtension}", StringComparison.Ordinal),
        "HTTPS update index prioritizes the signed user installer for the current runtime");
    var installerHandler = new UpdateDownloadHandler(updateIndex, installerPayload);
    var installerIndexService = new UpdateIndexService(
        new HttpClient(installerHandler),
        "https://updates.example.test/index.json",
        "1.1.0");
    var installerPlatform = new RecordingUpdateInstallerPlatform();
    var installerDownloadRoot = Path.Combine(root, "updates-success");
    var installResult = await new UpdateInstallerService(
        new HttpClient(installerHandler),
        installerIndexService,
        installerPlatform,
        installerDownloadRoot,
        installerPublisher,
        installerThumbprint,
        installerPublicKeySha256).DownloadVerifyAndLaunchAsync();
    Assert(
        installResult.Status == "launched" &&
        installResult.Version == "1.2.0" &&
        installerPlatform.VerifiedPublisher == installerPublisher &&
        installerPlatform.LaunchedPath is not null &&
        File.Exists(installerPlatform.LaunchedPath) &&
        installerHandler.InstallerRequests == 1,
        "update installer is downloaded, hash checked, publisher verified, and launched");

    var wrongHashIndex = updateIndex.Replace(
        installerHash,
        new string('0', 64),
        StringComparison.Ordinal);
    var wrongHashHandler = new UpdateDownloadHandler(wrongHashIndex, installerPayload);
    var wrongHashPlatform = new RecordingUpdateInstallerPlatform();
    var wrongHashRoot = Path.Combine(root, "updates-wrong-hash");
    var wrongHashRejected = false;
    try
    {
        await new UpdateInstallerService(
            new HttpClient(wrongHashHandler),
            new UpdateIndexService(
                new HttpClient(wrongHashHandler),
                "https://updates.example.test/index.json",
                "1.1.0"),
            wrongHashPlatform,
            wrongHashRoot,
            installerPublisher,
            installerThumbprint,
            installerPublicKeySha256).DownloadVerifyAndLaunchAsync();
    }
    catch (InvalidDataException)
    {
        wrongHashRejected = true;
    }
    Assert(
        wrongHashRejected &&
        wrongHashPlatform.LaunchedPath is null &&
        (!Directory.Exists(wrongHashRoot) ||
         !Directory.EnumerateFiles(wrongHashRoot).Any()),
        "hash-mismatched update installer is deleted and never launched");

    var wrongSizeIndex = updateIndex.Replace(
        $"\"sizeBytes\":{installerPayload.Length}",
        $"\"sizeBytes\":{installerPayload.Length + 1}",
        StringComparison.Ordinal);
    var wrongSizeHandler = new UpdateDownloadHandler(wrongSizeIndex, installerPayload);
    var wrongSizeRoot = Path.Combine(root, "updates-wrong-size");
    var wrongSizeRejected = false;
    try
    {
        await new UpdateInstallerService(
            new HttpClient(wrongSizeHandler),
            new UpdateIndexService(new HttpClient(wrongSizeHandler), "https://updates.example.test/index.json", "1.1.0"),
            new RecordingUpdateInstallerPlatform(),
            wrongSizeRoot,
            installerPublisher,
            installerThumbprint,
            installerPublicKeySha256).DownloadVerifyAndLaunchAsync();
    }
    catch (InvalidDataException)
    {
        wrongSizeRejected = true;
    }
    Assert(wrongSizeRejected &&
           (!Directory.Exists(wrongSizeRoot) || !Directory.EnumerateFiles(wrongSizeRoot).Any()),
        "size-mismatched update installer is deleted and never launched");

    var mismatchedSignerHandler = new UpdateDownloadHandler(updateIndex, installerPayload);
    var mismatchedSignerRejected = false;
    try
    {
        await new UpdateInstallerService(
            new HttpClient(mismatchedSignerHandler),
            new UpdateIndexService(new HttpClient(mismatchedSignerHandler), "https://updates.example.test/index.json", "1.1.0"),
            new RecordingUpdateInstallerPlatform(),
            Path.Combine(root, "updates-mismatched-signer"),
            installerPublisher,
            new string('e', 40),
            installerPublicKeySha256).DownloadVerifyAndLaunchAsync();
    }
    catch (UpdateInstallUnavailableException)
    {
        mismatchedSignerRejected = true;
    }
    Assert(mismatchedSignerRejected && mismatchedSignerHandler.InstallerRequests == 0,
        "update installer signer thumbprint must match the identity pinned by the installed Bridge");

    var missingPublisherIndex = updateIndex.Replace(
        $@",""publisherSubject"":""{installerPublisher}""",
        string.Empty,
        StringComparison.Ordinal);
    var missingPublisherHandler = new UpdateDownloadHandler(
        missingPublisherIndex,
        installerPayload);
    var missingPublisherRejected = false;
    try
    {
        await new UpdateInstallerService(
            new HttpClient(missingPublisherHandler),
            new UpdateIndexService(
                new HttpClient(missingPublisherHandler),
                "https://updates.example.test/index.json",
                "1.1.0"),
            new RecordingUpdateInstallerPlatform(),
            Path.Combine(root, "updates-missing-publisher"),
            installerPublisher,
            installerThumbprint,
            installerPublicKeySha256)
            .DownloadVerifyAndLaunchAsync();
    }
    catch (UpdateInstallUnavailableException)
    {
        missingPublisherRejected = true;
    }
    Assert(
        missingPublisherRejected && missingPublisherHandler.InstallerRequests == 0,
        "installer launch rejects update indexes without a pinned publisher before download");
    var mismatchedPublisherHandler = new UpdateDownloadHandler(
        updateIndex,
        installerPayload);
    var mismatchedPublisherRejected = false;
    try
    {
        await new UpdateInstallerService(
            new HttpClient(mismatchedPublisherHandler),
            new UpdateIndexService(
                new HttpClient(mismatchedPublisherHandler),
                "https://updates.example.test/index.json",
                "1.1.0"),
            new RecordingUpdateInstallerPlatform(),
            Path.Combine(root, "updates-mismatched-publisher"),
            "CN=Different Pinned Publisher",
            installerThumbprint,
            installerPublicKeySha256)
            .DownloadVerifyAndLaunchAsync();
    }
    catch (UpdateInstallUnavailableException)
    {
        mismatchedPublisherRejected = true;
    }
    Assert(
        mismatchedPublisherRejected &&
        mismatchedPublisherHandler.InstallerRequests == 0,
        "update-index publisher must match the publisher pinned by the installed Bridge");
    var unsignedInstallerPath = Path.Combine(
        root,
        $"unsigned-installer.{installerExtension}");
    await File.WriteAllBytesAsync(unsignedInstallerPath, installerPayload);
    var unsignedPlatformInstallerRejected = false;
    try
    {
        await new SystemUpdateInstallerPlatform().VerifyAsync(
            unsignedInstallerPath,
            installerPublisher,
            installerThumbprint,
            installerPublicKeySha256,
            "platform-trusted",
            CancellationToken.None);
    }
    catch (InvalidDataException)
    {
        unsignedPlatformInstallerRejected = true;
    }
    Assert(
        unsignedPlatformInstallerRejected,
        "the real platform verifier rejects an unsigned installer");
    var legacyUpdateIndex = $$"""
        {"schemaVersion":1,"product":"WordOllama","version":"1.2.0","generatedAt":"2026-07-29T00:00:00Z","releaseNotes":"legacy","artifacts":[{"runtime":"{{updateRuntime}}","url":"https://updates.example.test/bridge.zip","sha256":"{{new string('a', 64)}}","sizeBytes":12345,"signatureUrl":"https://updates.example.test/bridge.sig"}]}
        """;
    var legacyUpdateResult = await new UpdateIndexService(
        new HttpClient(new StaticJsonHandler(legacyUpdateIndex)),
        "https://updates.example.test/legacy-index.json",
        "1.1.0").CheckAsync();
    Assert(
        legacyUpdateResult.Artifact?.Kind == "archive" &&
        legacyUpdateResult.Artifact.Sha256 == new string('a', 64),
        "legacy update indexes safely fall back to the verified Bridge ZIP");
    var invalidInstallerRejected = false;
    try
    {
        var invalidInstallerIndex = updateIndex.Replace(
            $"WordOllama-Installer.{installerExtension}",
            "WordOllama-Installer.zip",
            StringComparison.Ordinal);
        _ = await new UpdateIndexService(
            new HttpClient(new StaticJsonHandler(invalidInstallerIndex)),
            "https://updates.example.test/index.json",
            "1.1.0").CheckAsync();
    }
    catch (InvalidDataException)
    {
        invalidInstallerRejected = true;
    }
    Assert(
        invalidInstallerRejected,
        "update index rejects an installer with the wrong platform extension");
    var loopbackInstallerRejected = false;
    try
    {
        var loopbackInstallerIndex = updateIndex.Replace(
            "https://updates.example.test/WordOllama-Installer",
            "https://127.0.0.1/WordOllama-Installer",
            StringComparison.Ordinal);
        _ = await new UpdateIndexService(
            new HttpClient(new StaticJsonHandler(loopbackInstallerIndex)),
            "https://updates.example.test/index.json",
            "1.1.0").CheckAsync();
    }
    catch (InvalidDataException)
    {
        loopbackInstallerRejected = true;
    }
    Assert(
        loopbackInstallerRejected,
        "update index rejects loopback installer URLs");
    var insecureUpdateRejected = false;
    try
    {
        _ = await new UpdateIndexService(
            new HttpClient(new StaticJsonHandler(updateIndex)),
            "http://updates.example.test/index.json",
            "1.1.0").CheckAsync();
    }
    catch (InvalidDataException)
    {
        insecureUpdateRejected = true;
    }
    Assert(insecureUpdateRejected, "update index rejects non-HTTPS sources");
    var loopbackUpdateRejected = false;
    try
    {
        _ = await new UpdateIndexService(
            new HttpClient(new StaticJsonHandler(updateIndex)),
            "https://127.0.0.1/index.json",
            "1.1.0").CheckAsync();
    }
    catch (InvalidDataException)
    {
        loopbackUpdateRejected = true;
    }
    Assert(loopbackUpdateRejected, "update index rejects loopback HTTPS sources");

    var rollbackRoot = Path.Combine(root, "rollback-installed");
    var rollbackCurrent = "1.2.0";
    var rollbackPrevious = "1.1.0";
    foreach (var version in new[] { rollbackCurrent, rollbackPrevious })
    {
        var versionRoot = Path.Combine(rollbackRoot, "versions", version);
        Directory.CreateDirectory(versionRoot);
        await File.WriteAllTextAsync(
            Path.Combine(
                versionRoot,
                OperatingSystem.IsWindows()
                    ? "WordOllama.DesktopBridge.exe"
                    : "WordOllama.DesktopBridge"),
            "smoke");
        await File.WriteAllTextAsync(Path.Combine(versionRoot, "appsettings.json"), "{}");
    }
    await File.WriteAllTextAsync(
        Path.Combine(rollbackRoot, "current-version"),
        rollbackCurrent);
    await File.WriteAllTextAsync(
        Path.Combine(rollbackRoot, "current.json"),
        $$"""{"currentVersion":"{{rollbackCurrent}}","previousVersion":"{{rollbackPrevious}}"}""");
    var rollbackPlatform = new RecordingUpdateRollbackPlatform(rollbackRoot);
    var rollbackService = new UpdateRollbackService(rollbackPlatform);
    var rollbackStatus = rollbackService.GetStatus();
    Assert(
        rollbackStatus.Available &&
        rollbackStatus.CurrentVersion == rollbackCurrent &&
        rollbackStatus.PreviousVersion == rollbackPrevious &&
        rollbackStatus.Reason is null,
        "installed update exposes only a validated retained version for rollback");
    var launchedRollback = rollbackService.Launch();
    Assert(
        launchedRollback.Available && rollbackPlatform.LaunchedRoot == rollbackRoot,
        "rollback launches the platform-owned installer helper instead of mutating files in the Bridge");
    await File.WriteAllTextAsync(
        Path.Combine(rollbackRoot, "current.json"),
        $$"""{"currentVersion":"{{rollbackCurrent}}","previousVersion":"../escape"}""");
    var unsafeRollback = rollbackService.GetStatus();
    var unsafeRollbackRejected = false;
    try
    {
        rollbackService.Launch();
    }
    catch (UpdateRollbackUnavailableException)
    {
        unsafeRollbackRejected = true;
    }
    Assert(
        !unsafeRollback.Available &&
        unsafeRollback.Reason == "previous-version-unavailable" &&
        unsafeRollbackRejected,
        "rollback rejects unsafe or tampered previous-version pointers");

    var memoryCandidates = AutomaticMemoryService.ExtractExplicitPreferenceCandidates(
        "今天天气不错。以后请始终使用简洁的中文。api_key=top-secret。I prefer short headings.");
    Assert(
        memoryCandidates.Count == 2 &&
        memoryCandidates.Any(value => value.Contains("简洁的中文", StringComparison.Ordinal)) &&
        memoryCandidates.Any(value => value.Contains("short headings", StringComparison.OrdinalIgnoreCase)),
        "automatic memory only observes explicit preference statements and rejects secrets");
    var existingMemory = new MemoryItem(
        "memory-1",
        "User prefers long answers.",
        DateTimeOffset.UtcNow,
        DateTimeOffset.UtcNow);
    var memoryChanges = AutomaticMemoryService.ParseChanges(
        """{"operations":[{"action":"update","id":"memory-1","content":"User prefers concise answers."},{"action":"add","id":"","content":"User prefers concise Chinese headings."},{"action":"update","id":"missing","content":"ignored"}]}""",
        [existingMemory]);
    Assert(
        memoryChanges.Count == 2 &&
        memoryChanges.Any(change => change.Action == "update" && change.Id == "memory-1") &&
        memoryChanges.Any(change => change.Action == "add"),
        "automatic memory validates strict JSON operations and known ids");

    await manager.DisposeAsync();
}
finally
{
    Directory.Delete(root, recursive: true);
}

Console.WriteLine("Unified HTTPS secret, signed update installer, encrypted recovery, MCP, automatic memory, Ollama settings, and Google OAuth PKCE smoke passed.");

static void Assert(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException($"Failed: {name}");
}

static Dictionary<string, string> ParseQuery(string query) =>
    query.TrimStart('?')
        .Split('&', StringSplitOptions.RemoveEmptyEntries)
        .Select(part => part.Split('=', 2))
        .ToDictionary(
            part => Uri.UnescapeDataString(part[0]),
            part => Uri.UnescapeDataString(part.Length > 1 ? part[1] : string.Empty),
            StringComparer.Ordinal);

sealed class MemorySecretStore : IMutableSecretStore
{
    private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);
    public int Count => _values.Count;
    public string? Get(string name) => _values.GetValueOrDefault(name);
    public void Set(string name, string value) => _values[name] = value;
    public void Delete(string name) => _values.Remove(name);
}

sealed class GoogleOAuthExchangeHandler : HttpMessageHandler
{
    public bool VerifierReceived { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var form = await request.Content!.ReadAsStringAsync(cancellationToken);
        VerifierReceived =
            form.Contains("code=smoke-code", StringComparison.Ordinal) &&
            form.Contains("code_verifier=", StringComparison.Ordinal) &&
            form.Contains("client_secret=client-secret", StringComparison.Ordinal);
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                """{"access_token":"access-token","refresh_token":"refresh-token","expires_in":3600}""",
                Encoding.UTF8,
                "application/json"),
        };
    }
}

sealed class StaticJsonHandler(string json) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken) =>
        Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
            RequestMessage = request,
        });
}

sealed class UpdateDownloadHandler(string indexJson, byte[] installer) : HttpMessageHandler
{
    public int InstallerRequests { get; private set; }

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        if (request.RequestUri?.AbsolutePath.EndsWith(
                "/index.json",
                StringComparison.Ordinal) == true)
        {
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(indexJson, Encoding.UTF8, "application/json"),
                RequestMessage = request,
            });
        }
        InstallerRequests += 1;
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(installer),
            RequestMessage = request,
        });
    }
}

sealed class ManualTimeProvider(DateTimeOffset current) : TimeProvider
{
    private DateTimeOffset _current = current;
    public override DateTimeOffset GetUtcNow() => _current;
    public void Advance(TimeSpan duration) => _current += duration;
}

sealed class RecordingUpdateInstallerPlatform : IUpdateInstallerPlatform
{
    public string? VerifiedPublisher { get; private set; }
    public string? LaunchedPath { get; private set; }

    public Task VerifyAsync(
        string installerPath,
        string expectedPublisherSubject,
        string expectedSignerThumbprint,
        string expectedPublicKeySha256,
        string distributionTrust,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(installerPath))
        {
            throw new InvalidOperationException(
                "Installer does not exist before platform verification.");
        }
        VerifiedPublisher = expectedPublisherSubject;
        return Task.CompletedTask;
    }

    public void Launch(string installerPath)
    {
        LaunchedPath = installerPath;
    }
}

sealed class RecordingUpdateRollbackPlatform(string? installRoot) : IUpdateRollbackPlatform
{
    public string? LaunchedRoot { get; private set; }

    public string? ResolveInstallRoot() => installRoot;

    public void Launch(string root) => LaunchedRoot = root;
}
