using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using WordOllama.Core;
using WordOllama.Contracts;

const string OriginalBody = """
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Service Agreement</w:t></w:r></w:p>
<w:p><w:r><w:t>Alpha clause remains unchanged.</w:t></w:r></w:p>
<w:p><w:r><w:t>Payment is due in 30 days.</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Risk level: low</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Tail anchor.</w:t></w:r></w:p>
""";

const string RevisedBody = """
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Service Agreement</w:t></w:r></w:p>
<w:p><w:r><w:t>Inserted preface.</w:t></w:r></w:p>
<w:p><w:r><w:t>Alpha clause remains unchanged.</w:t></w:r></w:p>
<w:p><w:r><w:t>Payment is due in 15 business days.</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Risk level: high</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Tail anchor.</w:t></w:r></w:p>
""";

var comparer = new OpenXmlDocumentComparer();
await using var original = CreateDocx(OriginalBody);
await using var revised = CreateDocx(RevisedBody);
var result = await comparer.CompareAsync(original, revised);

Assert(result.Algorithm == "structural-lcs-v2" && result.IsApproximate, "algorithm identity");
Assert(result.OriginalParagraphCount == 5 && result.RevisedParagraphCount == 6, "paragraph counts include table cells");
Assert(result.Summary is { Added: 1, Removed: 0, Modified: 2, Unchanged: 3, TableCellChanges: 1 },
    "structural summary avoids insertion cascade");
Assert(result.Changes.Count == 3, "only actual changes are emitted");

var inserted = result.Changes.Single(change => change.Kind == "added");
Assert(inserted.Revised == "Inserted preface." && inserted.OriginalParagraphIndex is null &&
       inserted.RevisedParagraphIndex == 2 &&
       inserted.InsertAfterOriginalParagraphIndex == 1 &&
       inserted.InsertAfterOriginalText == "Service Agreement" &&
       inserted.InsertAfterOriginalBlockType == "paragraph",
    "inserted paragraph keeps revised position and stable original anchor");

await using var leadingOriginal = CreateDocx("<w:p><w:r><w:t>Existing first paragraph</w:t></w:r></w:p>");
await using var leadingRevised = CreateDocx(
    "<w:p><w:r><w:t>New leading paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Existing first paragraph</w:t></w:r></w:p>");
var leadingResult = await comparer.CompareAsync(leadingOriginal, leadingRevised);
var leadingAddition = leadingResult.Changes.Single();
Assert(leadingAddition.Kind == "added" &&
       leadingAddition.InsertAfterOriginalParagraphIndex == 0 &&
       leadingAddition.InsertAfterOriginalText is null,
    "leading insertion carries an explicit document-start anchor");

var payment = result.Changes.Single(change => change.Original?.StartsWith("Payment", StringComparison.Ordinal) == true);
Assert(payment.Kind == "modified" && payment.OriginalParagraphIndex == 3 && payment.RevisedParagraphIndex == 4,
    "modified paragraph keeps both positions");
Assert(payment.TextChanges is { Count: > 0 } &&
       payment.TextChanges.Any(change => change.Original?.Contains("30", StringComparison.Ordinal) == true) &&
       payment.TextChanges.Any(change => change.Revised?.Contains("15", StringComparison.Ordinal) == true),
    "token-level payment edit is focused");

var table = result.Changes.Single(change => change.BlockType == "tableCell");
Assert(table.Location == "table:1/row:1/cell:1/paragraph:1" &&
       table.OriginalLocation == "table:1/row:1/cell:1/paragraph:1" &&
       table.RevisedLocation == "table:1/row:1/cell:1/paragraph:1" &&
       table.Original == "Risk level: low" && table.Revised == "Risk level: high",
    "table-cell context is retained");

await using var shiftedTableOriginal = CreateDocx("""
<w:p><w:r><w:t>Commercial terms</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Liability cap: 100</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Execution block</w:t></w:r></w:p>
""");
await using var shiftedTableRevised = CreateDocx("""
<w:p><w:r><w:t>Commercial terms</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Currency: CNY</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Liability cap: 200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Execution block</w:t></w:r></w:p>
""");
var shiftedTableResult = await comparer.CompareAsync(shiftedTableOriginal, shiftedTableRevised);
var shiftedRisk = shiftedTableResult.Changes.Single(
    change => change.Original?.StartsWith("Liability cap", StringComparison.Ordinal) == true);
Assert(shiftedTableResult.Summary is { Added: 1, Modified: 1, Removed: 0, TableCellChanges: 2 } &&
       shiftedRisk.OriginalLocation == "table:1/row:1/cell:1/paragraph:1" &&
       shiftedRisk.RevisedLocation == "table:2/row:1/cell:1/paragraph:1",
    $"inserted table does not hide the original/revised cell transition: {JsonSerializer.Serialize(shiftedTableResult)}");

await using var caseOriginal = CreateDocx("<w:p><w:r><w:t>CASE ONLY</w:t></w:r></w:p>");
await using var caseRevised = CreateDocx("<w:p><w:r><w:t>case only</w:t></w:r></w:p>");
var caseResult = await comparer.CompareAsync(caseOriginal, caseRevised, ignoreCase: true);
Assert(caseResult.Changes.Count == 0 && caseResult.Summary?.Unchanged == 1, "ignore-case alignment");

await using var styleOriginal = CreateDocx(
    "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Same title</w:t></w:r></w:p>");
await using var styleRevised = CreateDocx(
    "<w:p><w:pPr><w:pStyle w:val=\"Normal\"/></w:pPr><w:r><w:t>Same title</w:t></w:r></w:p>");
var styleResult = await comparer.CompareAsync(styleOriginal, styleRevised);
Assert(styleResult.Summary is { Modified: 1, HeadingChanges: 1 } &&
       styleResult.Changes[0].Style == "Normal" &&
       styleResult.Changes[0].OriginalStyle == "Heading1" &&
       styleResult.Changes[0].RevisedStyle == "Normal" &&
       styleResult.Changes[0].TextChanges?.Count == 0,
    $"style-only heading changes are visible without fake text edits: {JsonSerializer.Serialize(styleResult)}");

await using var duplicateOriginal = CreateDocx(
    "<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>Repeat</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p>");
await using var duplicateRevised = CreateDocx(
    "<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>Inserted</w:t></w:r></w:p><w:p><w:r><w:t>Repeat</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p>");
var duplicateResult = await comparer.CompareAsync(duplicateOriginal, duplicateRevised);
Assert(duplicateResult.Summary is { Added: 1, Modified: 0, Removed: 0 }, "middle insertion does not cascade");


var largeOriginalBody = new StringBuilder();
var largeRevisedBody = new StringBuilder();
for (var index = 0; index < 2100; index++)
{
    if (index == 1050)
    {
        largeRevisedBody.Append("<w:p><w:r><w:t>Large inserted anchor</w:t></w:r></w:p>");
    }
    var paragraph = $"<w:p><w:r><w:t>Unique paragraph {index:D4}</w:t></w:r></w:p>";
    largeOriginalBody.Append(paragraph);
    largeRevisedBody.Append(paragraph);
}
await using var largeOriginal = CreateDocx(largeOriginalBody.ToString());
await using var largeRevised = CreateDocx(largeRevisedBody.ToString());
var largeResult = await comparer.CompareAsync(largeOriginal, largeRevised);
Assert(largeResult.Summary is { Added: 1, Removed: 0, Modified: 0, Unchanged: 2100 },
    "large-document unique anchors avoid quadratic-memory fallback cascades");
var serialized = JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web));
Assert(serialized.Contains("\"paragraphIndex\"", StringComparison.Ordinal) &&
       serialized.Contains("\"textChanges\"", StringComparison.Ordinal) &&
       serialized.Contains("\"summary\"", StringComparison.Ordinal),
    "legacy and v2 response fields serialize together");

await using var invalid = CreateZip("not-document.xml", "<root/>");
var invalidRejected = false;
try
{
    await comparer.CompareAsync(invalid, CreateDocx("<w:p/>"));
}
catch (InvalidDataException exception)
{
    invalidRejected = exception.Message.Contains("word/document.xml", StringComparison.Ordinal);
}
Assert(invalidRejected, "invalid DOCX is rejected clearly");

var settingsTestRoot = Path.Combine(Path.GetTempPath(), "wordollama-provider-settings-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(settingsTestRoot);
try
{
    var secretStore = new MemorySecretStore();
    var settingsPath = Path.Combine(settingsTestRoot, "providers.json");
    var providerSettings = new ProviderSettingsStore(
        settingsPath,
        new ModelProviderOptions("Ollama", "http://127.0.0.1:11434", "", "test-model"),
        secretStore);
    var view = providerSettings.Upsert(new ProviderProfileUpdate(
        "cloud", "Cloud", "OpenAI", "https://api.openai.com/v1", "gpt-test", "top-secret",
        Temperature: 0.7,
        MaxTokens: 8192));
    Assert(view.Profiles.Count == 2 && view.Profiles.Single(profile => profile.Id == "cloud").HasApiKey,
        "provider profile and secret presence are exposed without the secret");
    Assert(!File.ReadAllText(settingsPath).Contains("top-secret", StringComparison.Ordinal),
        "provider API key is never persisted in JSON");
    providerSettings.Activate("cloud");
    var providerDefaults = providerSettings.ApplyDefaults(new ProviderChatRequest(
        [new ChatMessage("user", "test")]));
    Assert(providerDefaults is { Temperature: 0.7, MaxTokens: 8192, KeepAlive: "5m" },
        "active provider generation defaults apply to chat");
    var agentDefaults = providerSettings.ApplyDefaults(new AgentStartRequest("test"));
    Assert(agentDefaults is { Temperature: 0.7, MaxTokens: 8192 },
        "active provider generation defaults apply to Agent");
    Assert(providerSettings.GetActiveOptions() is { Type: "OpenAI", ApiKey: "top-secret" },
        "active provider resolves its secret from the vault");
    var reloadable = new ReloadableModelProvider(providerSettings.GetActiveOptions());
    Assert(reloadable.ProviderType == "OpenAI", "reloadable provider uses active profile");
    providerSettings.Activate("default");
    reloadable.Reload(providerSettings.GetActiveOptions());
    Assert(reloadable.ProviderType == "Ollama", "provider hot reload changes runtime provider");
    providerSettings.Upsert(new ProviderProfileUpdate(
        "gemini-oauth",
        "Gemini OAuth",
        "Gemini",
        "https://generativelanguage.googleapis.com/v1beta",
        "gemini-test"));
    var storedOAuthCredential = new GoogleOAuthCredential(
        "client.apps.googleusercontent.com",
        "",
        "refresh",
        "access",
        DateTimeOffset.UtcNow.AddHours(1),
        "wordollama-smoke-project");
    var oauthView = providerSettings.SetGoogleOAuthCredential(
        "gemini-oauth",
        storedOAuthCredential);
    Assert(oauthView.Profiles.Single(profile => profile.Id == "gemini-oauth").HasApiKey,
        "Google OAuth credential presence is exposed without token data");
    Assert(GoogleOAuthCredentialCodec.IsEncodedCredential(
            secretStore.Get("WORDOLLAMA_PROVIDER_GEMINI-OAUTH_API_KEY")),
        "Google OAuth credential is stored only in the provider vault secret");
    Assert(!File.ReadAllText(settingsPath).Contains("refresh", StringComparison.Ordinal),
        "Google OAuth tokens are excluded from provider JSON");
    var insecureRejected = false;
    try
    {
        providerSettings.Upsert(new ProviderProfileUpdate(
            "bad", "Bad", "OpenAI", "http://example.com/v1", "bad"));
    }
    catch (ArgumentException)
    {
        insecureRejected = true;
    }
    Assert(insecureRejected, "non-loopback HTTP provider endpoints are rejected");
    var tamperedPath = Path.Combine(settingsTestRoot, "tampered.json");
    File.WriteAllText(tamperedPath,
        """{"activeProviderId":"bad","profiles":[{"id":"bad","name":"Bad","type":"OpenAI","endpoint":"http://example.com/v1","model":"bad","toolCallingMode":"Auto","supportsStreaming":true,"supportsVision":false,"supportsJsonOutput":false,"contextWindow":0}]}""");
    var tamperedRejected = false;
    try
    {
        _ = new ProviderSettingsStore(
            tamperedPath,
            new ModelProviderOptions("Ollama", "http://127.0.0.1:11434", "", "test-model"),
            secretStore);
    }
    catch (ArgumentException)
    {
        tamperedRejected = true;
    }
    Assert(tamperedRejected, "tampered persisted provider endpoints are revalidated on load");
    var legacyDefaultPath = Path.Combine(settingsTestRoot, "legacy-default.json");
    File.WriteAllText(
        legacyDefaultPath,
        """{"activeProviderId":"default","profiles":[{"id":"default","name":"Ollama","type":"Ollama","endpoint":"http://127.0.0.1:11434","model":"llama3.2","toolCallingMode":"Auto","supportsStreaming":true,"supportsVision":false,"supportsJsonOutput":false,"contextWindow":0,"temperature":0.5,"maxTokens":4096,"keepAlive":"5m"}]}""");
    var migratedDefaults = new ProviderSettingsStore(
        legacyDefaultPath,
        new ModelProviderOptions("Ollama", "http://127.0.0.1:11434", "", ""),
        secretStore);
    Assert(
        migratedDefaults.GetActiveProfile().Model == "" &&
        File.ReadAllText(legacyDefaultPath).Contains("\"schemaVersion\": 1", StringComparison.Ordinal) &&
        !File.ReadAllText(legacyDefaultPath).Contains("\"model\": \"llama3.2\"", StringComparison.Ordinal),
        "legacy generated llama3.2 default is removed exactly once");
    providerSettings.Delete("cloud");
    Assert(secretStore.Get("WORDOLLAMA_PROVIDER_CLOUD_API_KEY") is null,
        "deleting a profile deletes its secret");
    var reviewSettings = new ReviewSettingsStore(Path.Combine(settingsTestRoot, "review.json"));
    reviewSettings.Save(new ReviewSettingsUpdate(" concise legal style ", AutoMemory: true));
    var memoryView = reviewSettings.AddMemory(new MemoryUpdate("User works on legal documents."));
    var memoryId = memoryView.Memories.Single().Id;
    reviewSettings.UpdateMemory(memoryId, new MemoryUpdate("User frequently reviews legal documents."));
    Assert(
        reviewSettings.Get().OutputPreference == "concise legal style" &&
        reviewSettings.Get().AutoMemory &&
        reviewSettings.Get().Memories.Single().Content ==
            "User frequently reviews legal documents.",
        "structured memories and output preferences are persisted by the Bridge");
    var reloadedReviewSettings = new ReviewSettingsStore(Path.Combine(settingsTestRoot, "review.json"));
    Assert(
        reloadedReviewSettings.Get().WritingProfile.Contains(
            "User frequently reviews legal documents.",
            StringComparison.Ordinal) &&
        reloadedReviewSettings.Get().WritingProfile.Contains(
            "concise legal style",
            StringComparison.Ordinal),
        "memories and output preferences reload across Bridge restarts");
    reviewSettings.DeleteMemories([memoryId]);
    Assert(reviewSettings.Get().Memories.Count == 0, "memory deletion persists");
}
finally
{
    Directory.Delete(settingsTestRoot, recursive: true);
}

var skillTestRoot = Path.Combine(Path.GetTempPath(), "wordollama-skill-import-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(skillTestRoot);
try
{
    var localTools = new LocalToolService(
        new NoopProcessRunner(),
        new LocalToolPolicy(
            new HashSet<string>(StringComparer.OrdinalIgnoreCase),
            [skillTestRoot],
            skillTestRoot,
            "python",
            false));
    var skillZip = CreateZip(
        "sample/SKILL.md",
        "---\nname: imported-skill\ndescription: Imported smoke skill\n---\n\n# Instructions");
    var imported = localTools.ImportSkill(new WordOllama.Contracts.ImportSkillRequest(
        "sample.zip",
        Convert.ToBase64String(skillZip.ToArray())));
    Assert(imported.Name == "imported-skill" && localTools.ListSkills().Any(skill => skill.Name == imported.Name),
        "safe Skill ZIP import");
    var traversalZip = CreateZip("../escape.txt", "escape");
    var traversalRejected = false;
    try
    {
        localTools.ImportSkill(new WordOllama.Contracts.ImportSkillRequest(
            "bad.zip",
            Convert.ToBase64String(traversalZip.ToArray())));
    }
    catch (InvalidDataException)
    {
        traversalRejected = true;
    }
    Assert(traversalRejected && !File.Exists(Path.Combine(Path.GetDirectoryName(skillTestRoot)!, "escape.txt")),
        "Skill ZIP path traversal is rejected");
    localTools.DeleteSkill(imported.Name);
    Assert(!localTools.ListSkills().Any(skill => skill.Name == imported.Name), "Skill deletion");
}
finally
{
    Directory.Delete(skillTestRoot, recursive: true);
}

var schema = JsonSerializer.SerializeToElement(new { type = "object" });
var readTool = new OfficeToolDescriptor("read_document", "read", false, schema);
var writeTool = new OfficeToolDescriptor("replace_text", "write", true, schema);
var agentProvider = new CapturingProvider([
    new ProviderChatResponse("fake", "fake", "done"),
]);
var fakeInternalTools = new FakeInternalTools();
var agent = new AgentSession(
    "mode-smoke",
    "https://localhost:3000",
    new AgentStartRequest(
        "inspect",
        Tools: [readTool, writeTool, .. fakeInternalTools.GetToolDescriptors()],
        RequirePlanConfirmation: false,
        MaxIterations: 2,
        ExecutionMode: "ViewOnly",
        AllowExternalTools: false,
        ImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        LanguageMode: "zh"),
    agentProvider,
    [fakeInternalTools]);
agent.Start();
await foreach (var runtimeEvent in agent.ReadEventsAsync())
{
    if (runtimeEvent.Type == "completed") break;
}
var advertisedNames = agentProvider.LastRequest?.Tools?.Select(tool => tool.Name).ToArray() ?? [];
Assert(advertisedNames.Contains("read_document") &&
       advertisedNames.Contains("read_skill") &&
       !advertisedNames.Contains("replace_text") &&
       !advertisedNames.Contains("execute_command"),
    "ViewOnly and external-tool settings filter advertised Agent tools");
Assert(agentProvider.LastRequest?.Messages.Any(message =>
           message.Role == "user" &&
           message.ImageDataUrl == "data:image/png;base64,iVBORw0KGgo=") == true,
    "Agent forwards the attached image to the model Provider");
Assert(agentProvider.LastRequest?.Messages.Any(message =>
           message.Role == "system" &&
           message.Content.Contains("Simplified Chinese", StringComparison.Ordinal)) == true,
    "Agent applies the configured output language to every provider iteration");

var englishPlanMessages = await CapturePlanMessagesAsync("en-US");
var chinesePlanMessages = await CapturePlanMessagesAsync("zh-CN");
Assert(
    englishPlanMessages.Plan.Contains("must be confirmed", StringComparison.Ordinal) &&
    englishPlanMessages.Failure.Contains("rejected by the user", StringComparison.Ordinal),
    "Agent emits English plan lifecycle messages for an English UI");
Assert(
    chinesePlanMessages.Plan.Contains("需要确认", StringComparison.Ordinal) &&
    chinesePlanMessages.Failure.Contains("用户拒绝", StringComparison.Ordinal),
    "Agent emits Chinese plan lifecycle messages for a Chinese UI");
foreach (var resourceKey in new[]
         {
             "AgentSessionCancelled",
             "AgentPlanPending",
             "AgentPlanRejected",
             "AgentToolBlocked",
             "AgentExternalToolDisabled",
             "AgentHighRiskRejected",
             "AgentIterationLimit",
             "OAuthComplete",
             "OAuthIncomplete",
             "OAuthGeminiOnly",
             "OAuthClientIdInvalid",
             "OAuthClientSecretTooLong",
             "OAuthProjectInvalid",
             "OAuthBrowserOpenFailed",
             "OAuthTimeout",
             "OAuthStateMismatch",
             "OAuthNotCompleted",
             "OAuthCodeMissing",
             "OAuthTokenExchangeFailed",
             "OAuthAccessTokenMissing",
             "OAuthCallbackNotLoopback",
             "OAuthRequestLineInvalid",
             "OAuthRequestInvalid",
             "OAuthHeadersInvalid",
             "OAuthTooManyHeaders",
             "OAuthFailedTitle",
             "OllamaProviderRequired",
         })
{
    Assert(
        UiText.Get("en-US", resourceKey) != resourceKey &&
        UiText.Get("zh-CN", resourceKey) != resourceKey,
        $"Bridge UI resource exists in English and Chinese: {resourceKey}");
}

var hallucinatedProvider = new CapturingProvider([
    new ProviderChatResponse("fake", "fake", "", [
        new ProviderToolCall("call-1", "replace_text", JsonSerializer.SerializeToElement(new { text = "bad" })),
    ]),
    new ProviderChatResponse("fake", "fake", "finished"),
]);
var guardedAgent = new AgentSession(
    "guard-smoke",
    "https://localhost:3000",
    new AgentStartRequest(
        "inspect",
        Tools: [readTool, writeTool],
        ExecutionMode: "ProposeChanges"),
    hallucinatedProvider);
guardedAgent.Start();
var emittedOfficeWrite = false;
var emittedBlockedResult = false;
await foreach (var runtimeEvent in guardedAgent.ReadEventsAsync())
{
    if (runtimeEvent.Type == "tool_call" &&
        runtimeEvent.Data?.TryGetProperty("name", out var toolName) == true &&
        toolName.GetString() == "replace_text")
    {
        emittedOfficeWrite = true;
    }
    if (runtimeEvent.Type == "tool_result" &&
        runtimeEvent.Data?.ToString().Contains("blocked", StringComparison.OrdinalIgnoreCase) == true)
    {
        emittedBlockedResult = true;
    }
    if (runtimeEvent.Type == "completed") break;
}
Assert(!emittedOfficeWrite && emittedBlockedResult,
    "non-writing Agent modes block hallucinated write calls at execution boundary");

var persistedCheckpoint = new AgentCheckpoint(
    "persisted-agent",
    3,
    2,
    "TrackedChanges",
    DateTimeOffset.UtcNow);
var persistedSnapshot = new AgentRecoverySnapshot(
    "persisted-agent",
    "https://localhost:3000",
    new AgentStartRequest("continue review", MaxIterations: 5),
    [
        new ChatMessage("system", "system"),
        new ChatMessage("user", "continue review"),
    ],
    3,
    persistedCheckpoint,
    DateTimeOffset.UtcNow);
var memoryRecoveryStore = new MemoryAgentRecoveryStore(persistedSnapshot);
var recoveredProvider = new CapturingProvider([
    new ProviderChatResponse("fake", "fake", "recovered"),
]);
var recoveredManager = new AgentSessionManager(
    recoveredProvider,
    Array.Empty<IInternalToolExecutor>(),
    memoryRecoveryStore);
Assert(recoveredManager.ListRecoveries("https://localhost:3000").Single().Iteration == 3,
    "Agent manager discovers encrypted checkpoints after Bridge restart");
Assert(recoveredManager.ListRecoveries("https://other-origin.test").Count == 0,
    "Agent recovery discovery is isolated by paired Office.js origin");
Assert(recoveredManager.TryGetCheckpoint(
        "persisted-agent",
        "https://localhost:3000",
        out var recoveredCheckpoint) &&
       recoveredCheckpoint.Iteration == 3 &&
       recoveredProvider.LastRequest is null,
    "checkpoint inspection does not resume the Agent before user confirmation");
Assert(recoveredManager.TryGet(
        "persisted-agent",
        "https://localhost:3000",
        out var recoveredAgent),
    "opening the recovered event stream materializes the persisted Agent");
await foreach (var runtimeEvent in recoveredAgent.ReadEventsAsync())
{
    if (runtimeEvent.Type == "completed") break;
}
Assert(recoveredProvider.LastRequest?.Messages.Any(message =>
           message.Role == "user" && message.Content == "continue review") == true,
    "recovered Agent resumes with its encrypted message history");
Assert(memoryRecoveryStore.DeletedSessionIds.Contains("persisted-agent"),
    "successful recovered Agent completion deletes its checkpoint");

var remoteOllamaRejected = false;
try { _ = new OllamaModelManager("https://example.com"); }
catch (ArgumentException) { remoteOllamaRejected = true; }
Assert(remoteOllamaRejected, "Ollama model management is restricted to loopback");
var invalidOllamaModelRejected = false;
try { await new OllamaModelManager("http://127.0.0.1:11434").DeleteAsync("bad model"); }
catch (ArgumentException) { invalidOllamaModelRejected = true; }
Assert(invalidOllamaModelRejected, "invalid Ollama model names are rejected before network access");

var expiredGoogleCredential = new GoogleOAuthCredential(
    "desktop-client.apps.googleusercontent.com",
    "desktop-secret",
    "refresh-token",
    "expired-access-token",
    DateTimeOffset.UtcNow.AddMinutes(-5),
    "wordollama-smoke-project");
var encodedGoogleCredential = GoogleOAuthCredentialCodec.Encode(expiredGoogleCredential);
Assert(
    GoogleOAuthCredentialCodec.TryDecode(encodedGoogleCredential, out var decodedGoogleCredential) &&
    decodedGoogleCredential == expiredGoogleCredential,
    "Google OAuth credentials round-trip through the system-vault payload codec");
var googleHandler = new GoogleOAuthSmokeHandler();
var googleProvider = new GeminiProvider(
    "https://generativelanguage.googleapis.com/v1beta",
    encodedGoogleCredential,
    "gemini-test",
    messageHandler: googleHandler);
var googleModels = await googleProvider.FetchModelsAsync();
Assert(googleModels.SequenceEqual(["gemini-test"]), "Gemini OAuth model response is parsed");
Assert(googleHandler.RefreshRequested, "expired Google access tokens are refreshed");
Assert(googleHandler.BearerToken == "fresh-access-token", "Gemini requests use refreshed Bearer authentication");
Assert(googleHandler.QuotaProject == "wordollama-smoke-project", "Gemini OAuth sends the quota project");

Console.WriteLine("Unified comparer and provider settings smoke passed.");

static MemoryStream CreateDocx(string body)
{
    const string prefix = """
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
""";
    const string suffix = "</w:body></w:document>";
    return CreateZip("word/document.xml", prefix + body + suffix);
}

static MemoryStream CreateZip(string entryName, string content)
{
    var stream = new MemoryStream();
    using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
    {
        var entry = archive.CreateEntry(entryName, CompressionLevel.Fastest);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        writer.Write(content);
    }
    stream.Position = 0;
    return stream;
}

static void Assert(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException($"Failed: {name}");
}

static async Task<(string Plan, string Failure)> CapturePlanMessagesAsync(string uiLocale)
{
    var session = new AgentSession(
        $"locale-{uiLocale}",
        "https://localhost:3000",
        new AgentStartRequest(
            "inspect",
            RequirePlanConfirmation: true,
            UiLocale: uiLocale),
        new CapturingProvider([]));
    session.Start();
    var plan = string.Empty;
    var failure = string.Empty;
    await foreach (var runtimeEvent in session.ReadEventsAsync())
    {
        if (runtimeEvent.Type == "plan_pending")
        {
            plan = runtimeEvent.Message ?? string.Empty;
            session.ConfirmPlan(new AgentPlanConfirmationRequest(false));
        }
        if (runtimeEvent.Type == "failed")
        {
            failure = runtimeEvent.Message ?? string.Empty;
            break;
        }
    }
    return (plan, failure);
}

sealed class MemorySecretStore : IMutableSecretStore
{
    private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);

    public string? Get(string name) => _values.GetValueOrDefault(name);
    public void Set(string name, string value) => _values[name] = value;
    public void Delete(string name) => _values.Remove(name);
}

sealed class MemoryAgentRecoveryStore(params AgentRecoverySnapshot[] snapshots) : IAgentRecoveryStore
{
    private readonly Dictionary<string, AgentRecoverySnapshot> _snapshots =
        snapshots.ToDictionary(snapshot => snapshot.SessionId, StringComparer.Ordinal);
    public HashSet<string> DeletedSessionIds { get; } = new(StringComparer.Ordinal);
    public IReadOnlyList<AgentRecoverySnapshot> LoadAll() => _snapshots.Values.ToArray();
    public void Save(AgentRecoverySnapshot snapshot) => _snapshots[snapshot.SessionId] = snapshot;
    public void Delete(string sessionId)
    {
        DeletedSessionIds.Add(sessionId);
        _snapshots.Remove(sessionId);
    }
}

sealed class NoopProcessRunner : IProcessRunner
{
    public Task<ProcessExecutionResult> RunAsync(
        ProcessExecutionRequest request,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(new ProcessExecutionResult(0, "", "", false));
}

sealed class CapturingProvider : IModelProvider
{
    private readonly Queue<ProviderChatResponse> _responses;
    public CapturingProvider(IEnumerable<ProviderChatResponse> responses) => _responses = new Queue<ProviderChatResponse>(responses);
    public string ProviderType => "fake";
    public ProviderChatRequest? LastRequest { get; private set; }
    public Task<ProviderChatResponse> ChatAsync(ProviderChatRequest request, CancellationToken cancellationToken = default)
    {
        LastRequest = request;
        return Task.FromResult(_responses.Count > 0
            ? _responses.Dequeue()
            : new ProviderChatResponse("fake", "fake", "done"));
    }
    public Task<IReadOnlyList<string>> FetchModelsAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<string>>(["fake"]);
}

sealed class FakeInternalTools : IInternalToolExecutor
{
    private static readonly JsonElement Schema = JsonSerializer.SerializeToElement(new { type = "object" });
    public IReadOnlyList<OfficeToolDescriptor> GetToolDescriptors() =>
    [
        new("read_skill", "read skill", false, Schema),
        new("execute_command", "execute", false, Schema),
    ];
    public bool IsKnownTool(string name) => name is "read_skill" or "execute_command";
    public Task<string> ExecuteAsync(string name, JsonElement arguments, CancellationToken cancellationToken = default) =>
        Task.FromResult("ok");
}

sealed class GoogleOAuthSmokeHandler : HttpMessageHandler
{
    public bool RefreshRequested { get; private set; }
    public string? BearerToken { get; private set; }
    public string? QuotaProject { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        if (request.RequestUri?.Host == "oauth2.googleapis.com")
        {
            RefreshRequested = true;
            var form = await request.Content!.ReadAsStringAsync(cancellationToken);
            if (!form.Contains("refresh_token=refresh-token", StringComparison.Ordinal))
            {
                return new HttpResponseMessage(HttpStatusCode.BadRequest)
                {
                    Content = new StringContent("""{"error":"missing_refresh_token"}"""),
                };
            }
            return JsonResponse("""{"access_token":"fresh-access-token","expires_in":3600}""");
        }

        BearerToken = request.Headers.Authorization?.Scheme == "Bearer"
            ? request.Headers.Authorization.Parameter
            : null;
        QuotaProject = request.Headers.TryGetValues("x-goog-user-project", out var values)
            ? values.Single()
            : null;
        return JsonResponse(
            """{"models":[{"name":"models/gemini-test","supportedGenerationMethods":["generateContent"]}]}""");
    }

    private static HttpResponseMessage JsonResponse(string json) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
}
