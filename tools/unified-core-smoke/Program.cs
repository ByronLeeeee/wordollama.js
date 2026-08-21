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
        MaxTokens: 8192,
        ApiMode: "Responses",
        ReasoningEffort: "High"));
    Assert(view.Profiles.Count >= 1 &&
           view.Profiles.Single(profile => profile.Id == "cloud").HasApiKey &&
           view.Profiles.Single(profile => profile.Id == "cloud").ApiMode == "Responses" &&
           view.Profiles.Single(profile => profile.Id == "cloud").ReasoningEffort == "High",
        "provider profile, protocol, and secret presence are exposed without the secret");
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
    Assert(providerSettings.GetActiveOptions() is { Type: "OpenAI", ApiKey: "top-secret", ApiMode: "Responses", ReasoningEffort: "High" },
        "active provider resolves its protocol and secret from the vault");
    var reloadable = new ReloadableModelProvider(providerSettings.GetActiveOptions());
    Assert(reloadable.ProviderType == "OpenAI", "reloadable provider uses active profile");
    providerSettings.Upsert(new ProviderProfileUpdate(
        "local", "Local", "Ollama", "http://127.0.0.1:11434", "test-model"));
    providerSettings.Activate("local");
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
    var modelFetchOptions = providerSettings.BuildOptionsForModelFetch(new ProviderProfileUpdate(
        "zhipu-fetch",
        "Zhipu GLM",
        "OpenAI",
        "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "",
        ApiKey: "test-key",
        ApiMode: "ChatCompletions"));
    Assert(
        modelFetchOptions.Model == "" &&
        modelFetchOptions.Endpoint.EndsWith("/chat/completions", StringComparison.Ordinal),
        "model discovery accepts an empty model and preserves the complete provider endpoint");
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
        migratedDefaults.GetActiveProfile() is null &&
        File.ReadAllText(legacyDefaultPath).Contains("\"schemaVersion\": 2", StringComparison.Ordinal) &&
        !File.ReadAllText(legacyDefaultPath).Contains("\"model\": \"llama3.2\"", StringComparison.Ordinal),
        "legacy generated llama3.2 default is removed exactly once");
    providerSettings.Delete("cloud");
    Assert(secretStore.Get("WORDOLLAMA_PROVIDER_CLOUD_API_KEY") is null,
        "deleting a profile deletes its secret");
    var reviewSettings = new ReviewSettingsStore(Path.Combine(settingsTestRoot, "review.json"));
    reviewSettings.Save(new ReviewSettingsUpdate(
        " concise legal style ",
        AutoMemory: true,
        MemoryProviderProfileId: "cloud"));
    var memoryView = reviewSettings.AddMemory(new MemoryUpdate("User works on legal documents."));
    var memoryId = memoryView.Memories.Single().Id;
    reviewSettings.UpdateMemory(memoryId, new MemoryUpdate("User frequently reviews legal documents."));
    Assert(
        reviewSettings.Get().OutputPreference == "concise legal style" &&
        reviewSettings.Get().AutoMemory &&
        reviewSettings.Get().MemoryProviderProfileId == "cloud" &&
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
            StringComparison.Ordinal) &&
        reloadedReviewSettings.Get().MemoryProviderProfileId == "cloud",
        "memories, output preferences, and the memory model reload across Bridge restarts");
    reviewSettings.DeleteMemories([memoryId]);
    Assert(reviewSettings.Get().Memories.Count == 0, "memory deletion persists");
}
finally
{
    Directory.Delete(settingsTestRoot, recursive: true);
}

var responsesHandler = new ResponsesApiSmokeHandler();
var responsesProvider = new OpenAiCompatibleProvider(
    "https://api.openai.com/v1",
    "test-key",
    "gpt-test",
    httpMessageHandler: responsesHandler,
    reasoningEffort: "High");
var responsesResult = await responsesProvider.ChatAsync(new ProviderChatRequest(
    [
        new ChatMessage("system", "You are concise."),
        new ChatMessage("user", "Translate this."),
    ],
    MaxTokens: 120));
Assert(
    responsesHandler.LastPath == "/v1/responses" &&
    responsesHandler.LastRequestBody?.Contains("\"instructions\":\"You are concise.\"", StringComparison.Ordinal) == true &&
    responsesHandler.LastRequestBody.Contains("\"max_output_tokens\":120", StringComparison.Ordinal) &&
    responsesHandler.LastRequestBody.Contains("\"reasoning\":{\"effort\":\"high\"}", StringComparison.Ordinal) &&
    responsesResult.Content == "Responses reply",
    "Responses API request mapping and response normalization");
var streamedResponses = new List<ProviderChatChunk>();
await foreach (var chunk in responsesProvider.ChatStreamAsync(new ProviderChatRequest(
    [new ChatMessage("user", "Stream this.")])))
{
    streamedResponses.Add(chunk);
}
Assert(
    responsesHandler.LastRequestBody?.Contains("\"stream\":true", StringComparison.Ordinal) == true &&
    streamedResponses.Any(chunk => chunk.Delta == "Responses ") &&
    streamedResponses.Any(chunk => chunk.Delta == "reply") &&
    streamedResponses.Last().Done,
    "Responses API SSE deltas are normalized to Bridge chunks");

var chatReasoningHandler = new JsonCaptureHandler(
    """{"choices":[{"message":{"content":"Chat reply"}}]}""");
var chatReasoningProvider = new OpenAiCompatibleProvider(
    "https://compatible.example/v1",
    "test-key",
    "reasoning-model",
    apiMode: "ChatCompletions",
    httpMessageHandler: chatReasoningHandler,
    reasoningEffort: "Medium");
_ = await chatReasoningProvider.ChatAsync(new ProviderChatRequest(
    [new ChatMessage("user", "Think.")],
    MaxTokens: 256));
Assert(
    chatReasoningHandler.LastRequestBody?.Contains("\"reasoning_effort\":\"medium\"", StringComparison.Ordinal) == true &&
    chatReasoningHandler.LastRequestBody.Contains("\"max_completion_tokens\":256", StringComparison.Ordinal) &&
    !chatReasoningHandler.LastRequestBody.Contains("\"max_tokens\"", StringComparison.Ordinal) &&
    !chatReasoningHandler.LastRequestBody.Contains("\"temperature\"", StringComparison.Ordinal),
    "Chat Completions reasoning uses reasoning_effort and max_completion_tokens");
using (var compatibleRequest = JsonDocument.Parse(chatReasoningHandler.LastRequestBody!))
{
    var message = compatibleRequest.RootElement.GetProperty("messages")[0];
    Assert(
        message.GetProperty("role").GetString() == "user" &&
        message.GetProperty("content").GetString() == "Think." &&
        !message.TryGetProperty("tool_call_id", out _) &&
        !message.TryGetProperty("name", out _) &&
        !message.TryGetProperty("tool_calls", out _),
        "OpenAI-compatible plain messages omit null tool fields for strict llama.cpp parsers");
}

var ordinaryZhipuHandler = new ProviderSmokeHandler(
    """{"data":[{"id":"glm-4.7-flash"},{"id":"glm-4v-flash"}]}""");
var ordinaryZhipuProvider = new OpenAiCompatibleProvider(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "test-key",
    "",
    apiMode: "ChatCompletions",
    httpMessageHandler: ordinaryZhipuHandler);
var ordinaryZhipuModels = await ordinaryZhipuProvider.FetchModelsAsync();
Assert(
    ordinaryZhipuHandler.LastRequestUri?.AbsolutePath == "/api/paas/v4/models" &&
    ordinaryZhipuModels.SequenceEqual(["glm-4.7-flash", "glm-4v-flash"]),
    "full ordinary Zhipu chat endpoint is normalized to the correct models URL without conflating GLM model capabilities");

var codingZhipuHandler = new ProviderSmokeHandler("""{"data":[{"id":"glm-coding"}]}""");
var codingZhipuProvider = new OpenAiCompatibleProvider(
    "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
    "test-key",
    "",
    apiMode: "ChatCompletions",
    httpMessageHandler: codingZhipuHandler);
_ = await codingZhipuProvider.FetchModelsAsync();
Assert(
    codingZhipuHandler.LastRequestUri?.AbsolutePath == "/api/coding/paas/v4/models",
    "full Zhipu Coding Plan chat endpoint is normalized to the Coding Plan models URL");

var zhipuToolHandler = new ProviderSmokeHandler("""{"choices":[{"message":{"content":"ok"}}]}""");
var zhipuToolProvider = new OpenAiCompatibleProvider(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "test-key",
    "glm-4.7-flash",
    apiMode: "ChatCompletions",
    httpMessageHandler: zhipuToolHandler);
_ = await zhipuToolProvider.ChatAsync(new ProviderChatRequest(
    [new ChatMessage("user", "Call capability_echo.")],
    Tools:
    [
        new OfficeToolDescriptor(
            "capability_echo",
            "Echo a value.",
            false,
            JsonSerializer.SerializeToElement(new
            {
                type = "object",
                properties = new { value = new { type = "string" } },
                required = new[] { "value" },
            })),
    ]));
using (var toolRequest = JsonDocument.Parse(zhipuToolHandler.LastRequestBody!))
{
    Assert(
        toolRequest.RootElement.GetProperty("tool_choice").GetString() == "auto" &&
        toolRequest.RootElement.GetProperty("tools")[0].GetProperty("type").GetString() == "function" &&
        toolRequest.RootElement.GetProperty("tools")[0].GetProperty("function").GetProperty("name").GetString() == "capability_echo",
        "OpenAI-compatible tool probes send standard tools with explicit tool_choice auto");
}

var zhipuSuccessErrorHandler = new ProviderSmokeHandler(
    """{"error":{"code":"1113","message":"Insufficient balance or resource package"}}""");
var zhipuSuccessErrorProvider = new OpenAiCompatibleProvider(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "test-key",
    "glm-4.7-flash",
    apiMode: "ChatCompletions",
    httpMessageHandler: zhipuSuccessErrorHandler);
var zhipuSuccessErrorThrown = false;
try
{
    _ = await zhipuSuccessErrorProvider.ChatAsync(new ProviderChatRequest([new ChatMessage("user", "hello")]));
}
catch (HttpRequestException exception)
{
    zhipuSuccessErrorThrown = exception.Message.Contains("1113", StringComparison.Ordinal);
}
Assert(zhipuSuccessErrorThrown, "HTTP 200 provider error objects are rejected and preserve Zhipu error code 1113");

var zhipuHttpErrorHandler = new ProviderSmokeHandler(
    """{"error":{"code":1305,"message":"Free model is busy"}}""",
    HttpStatusCode.TooManyRequests);
var zhipuHttpErrorProvider = new OpenAiCompatibleProvider(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "test-key",
    "glm-4.7-flash",
    apiMode: "ChatCompletions",
    httpMessageHandler: zhipuHttpErrorHandler);
var zhipuHttpErrorThrown = false;
try
{
    _ = await zhipuHttpErrorProvider.ChatAsync(new ProviderChatRequest([new ChatMessage("user", "hello")]));
}
catch (HttpRequestException exception)
{
    zhipuHttpErrorThrown = exception.StatusCode == HttpStatusCode.TooManyRequests &&
                           exception.Message.Contains("1305", StringComparison.Ordinal);
}
Assert(zhipuHttpErrorThrown, "non-success HTTP responses are rejected and preserve Zhipu error code 1305");

var zhipuStreamErrorHandler = new ProviderSmokeHandler(
    "data: {\"error\":{\"code\":1305,\"message\":\"Free model is busy\"}}\n\n",
    mediaType: "text/event-stream");
var zhipuStreamErrorProvider = new OpenAiCompatibleProvider(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "test-key",
    "glm-4.7-flash",
    apiMode: "ChatCompletions",
    httpMessageHandler: zhipuStreamErrorHandler);
var zhipuStreamErrorThrown = false;
try
{
    await foreach (var _ in zhipuStreamErrorProvider.ChatStreamAsync(
                       new ProviderChatRequest([new ChatMessage("user", "hello")])))
    {
    }
}
catch (HttpRequestException exception)
{
    zhipuStreamErrorThrown = exception.Message.Contains("1305", StringComparison.Ordinal);
}
Assert(zhipuStreamErrorThrown, "stream error events are rejected instead of being normalized into a successful done chunk");

var claudeHandler = new JsonCaptureHandler(
    """{"content":[{"type":"thinking","thinking":"summary","signature":"signed-thinking"},{"type":"tool_use","id":"call-1","name":"lookup","input":{"q":"x"}}]}""");
var claudeProvider = new AnthropicProvider(
    "https://api.anthropic.com/v1",
    "test-key",
    "claude-sonnet-4-6",
    messageHandler: claudeHandler,
    reasoningEffort: "Medium");
var claudeResponse = await claudeProvider.ChatAsync(new ProviderChatRequest(
    [new ChatMessage("user", "Use a tool.")],
    MaxTokens: 4096));
Assert(
    claudeHandler.LastRequestBody?.Contains("\"thinking\":{\"type\":\"adaptive\"}", StringComparison.Ordinal) == true &&
    claudeHandler.LastRequestBody.Contains("\"output_config\":{\"effort\":\"medium\"}", StringComparison.Ordinal) &&
    !claudeHandler.LastRequestBody.Contains("\"temperature\"", StringComparison.Ordinal),
    "Claude 4.6+ uses adaptive thinking with output_config.effort");
_ = await claudeProvider.ChatAsync(new ProviderChatRequest([
    new ChatMessage("user", "Use a tool."),
    new ChatMessage("assistant", claudeResponse.Content, ToolCalls: claudeResponse.ToolCalls, ProviderData: claudeResponse.ProviderData),
    new ChatMessage("tool", "result", ToolCallId: "call-1", Name: "lookup"),
]));
Assert(
    claudeHandler.LastRequestBody?.Contains("\"signature\":\"signed-thinking\"", StringComparison.Ordinal) == true,
    "Claude thinking blocks are preserved unchanged through Agent tool turns");

var claudeManualHandler = new JsonCaptureHandler("""{"content":[{"type":"text","text":"ok"}]}""");
var claudeManualProvider = new AnthropicProvider(
    "https://api.anthropic.com/v1",
    "test-key",
    "claude-sonnet-4-5",
    messageHandler: claudeManualHandler,
    reasoningEffort: "Custom",
    thinkingBudget: 2048);
_ = await claudeManualProvider.ChatAsync(new ProviderChatRequest([new ChatMessage("user", "Think.")], MaxTokens: 4096));
Assert(
    claudeManualHandler.LastRequestBody?.Contains("\"thinking\":{\"type\":\"enabled\",\"budget_tokens\":2048}", StringComparison.Ordinal) == true,
    "Claude 4.5 and earlier use manual budget_tokens thinking");

var gemini3Handler = new JsonCaptureHandler("""{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}""");
var gemini3Provider = new GeminiProvider(
    "https://generativelanguage.googleapis.com/v1beta",
    "test-key",
    "gemini-3-flash-preview",
    messageHandler: gemini3Handler,
    reasoningEffort: "Medium");
_ = await gemini3Provider.ChatAsync(new ProviderChatRequest([new ChatMessage("user", "Think.")]));
Assert(
    gemini3Handler.LastRequestBody?.Contains("\"thinkingConfig\":{\"thinkingLevel\":\"medium\"}", StringComparison.Ordinal) == true,
    "Gemini 3 generateContent uses thinkingLevel");

var gemini25Handler = new JsonCaptureHandler("""{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}""");
var gemini25Provider = new GeminiProvider(
    "https://generativelanguage.googleapis.com/v1beta",
    "test-key",
    "gemini-2.5-flash",
    messageHandler: gemini25Handler,
    reasoningEffort: "Medium");
_ = await gemini25Provider.ChatAsync(new ProviderChatRequest([new ChatMessage("user", "Think.")]));
Assert(
    gemini25Handler.LastRequestBody?.Contains("\"thinkingConfig\":{\"thinkingBudget\":8192}", StringComparison.Ordinal) == true,
    "Gemini 2.5 generateContent maps medium to the documented thinkingBudget");

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
    var created = localTools.CreateSkill(new CreateSkillRequest(
        "Contract Review Helper",
        "Review contracts with the available Word tools when the user requests a repeatable contract-risk workflow.",
        "---\nname: ignored\ndescription: ignored\nextra: rejected\n---\n\n# Contract review\n\nRead the document before making changes. Cite evidence and verify every write."));
    var createdContent = await localTools.ReadSkillAsync(new ReadSkillRequest(created.Name));
    Assert(created.Name == "contract-review-helper" &&
           createdContent.StartsWith("---\nname: contract-review-helper\n", StringComparison.Ordinal) &&
           !createdContent.Contains("extra:", StringComparison.Ordinal) &&
           localTools.GetToolDescriptors().Any(tool => tool.Name == "create_skill" && tool.IsWriteOperation),
        "AI-created Skills use normalized names, strict frontmatter, and an explicit write tool");
    foreach (var alias in new[] { "legacy-folder", "duplicate-folder" })
    {
        var aliasRoot = Path.Combine(skillTestRoot, alias);
        Directory.CreateDirectory(aliasRoot);
        File.WriteAllText(
            Path.Combine(aliasRoot, "SKILL.md"),
            "---\nname: canonical-skill\ndescription: Canonical lookup smoke\n---\n\n# Canonical instructions");
    }
    Assert(localTools.ListSkills().Count(skill => skill.Name == "canonical-skill") == 1,
        "Skill catalog deduplicates canonical names from legacy folders");
    Assert((await localTools.ReadSkillAsync(new ReadSkillRequest("canonical-skill")))
            .Contains("Canonical instructions", StringComparison.Ordinal),
        "read_skill resolves the canonical SKILL.md name instead of requiring a matching folder");
    var listedSkills = await localTools.ExecuteAsync(
        "list_skills",
        JsonSerializer.SerializeToElement(new { }));
    Assert(listedSkills.Contains("canonical-skill", StringComparison.Ordinal),
        "list_skills exposes the installed canonical catalog to Agent sessions");
    var selectedSkillProvider = new CapturingProvider([
        new ProviderChatResponse("fake", "fake", "skill loaded"),
    ]);
    var selectedSkillAgent = new AgentSession(
        "selected-skill-smoke",
        "https://localhost:3000",
        new AgentStartRequest(
            "use the selected skill",
            Tools: localTools.GetToolDescriptors(),
            SkillName: "canonical-skill"),
        selectedSkillProvider,
        [localTools]);
    selectedSkillAgent.Start();
    await foreach (var runtimeEvent in selectedSkillAgent.ReadEventsAsync())
    {
        if (runtimeEvent.Type == "completed") break;
    }
    Assert(selectedSkillProvider.LastRequest?.Messages.Any(message =>
               message.Role == "system" &&
               message.Content.Contains("explicitly selected Skill 'canonical-skill'", StringComparison.Ordinal) &&
               message.Content.Contains("Canonical instructions", StringComparison.Ordinal)) == true,
        "an explicitly selected Skill is preloaded before the first model turn");
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
    var networkTools = new LocalToolService(
        new NoopProcessRunner(),
        new LocalToolPolicy(new HashSet<string>(), [skillTestRoot], skillTestRoot, "python", true));
    Assert(networkTools.GetToolDescriptors().Any(tool => tool.Name == "fetch_url") &&
           networkTools.GetToolDescriptors().All(tool => tool.Name != "http_request"),
        "network capability is exposed only as constrained fetch_url");
    foreach (var blockedUrl in new[] { "http://example.com", "https://127.0.0.1/private", "https://[::1]/private" })
    {
        var rejected = false;
        try { await SafeWebFetcher.FetchAsync(new FetchUrlToolRequest(blockedUrl, 1)); }
        catch (LocalToolPolicyException) { rejected = true; }
        Assert(rejected, $"fetch_url rejects unsafe target {blockedUrl}");
    }
    var auditPath = Path.Combine(skillTestRoot, "terminal-audit.jsonl");
    var terminalTools = new LocalToolService(
        new NoopProcessRunner(),
        new LocalToolPolicy(new HashSet<string>(), [skillTestRoot], skillTestRoot, "python", false, auditPath));
    const string sensitiveTerminalScript = "$env:API_KEY='must-never-enter-audit'; Write-Output ok";
    _ = await terminalTools.RunTerminalAsync(new RunTerminalRequest(
        sensitiveTerminalScript,
        TimeoutSeconds: 5,
        WorkingDirectory: skillTestRoot));
    var auditText = File.ReadAllText(auditPath);
    using var auditDocument = JsonDocument.Parse(auditText);
    Assert(!auditText.Contains("must-never-enter-audit", StringComparison.Ordinal) &&
           auditDocument.RootElement.GetProperty("scriptSha256").GetString()?.Length == 64 &&
           auditDocument.RootElement.GetProperty("scriptCharacters").GetInt32() == sensitiveTerminalScript.Length,
        "full-terminal audit stores only command hash and metadata, never sensitive arguments");
    localTools.DeleteSkill(imported.Name);
    Assert(!localTools.ListSkills().Any(skill => skill.Name == imported.Name), "Skill deletion");
    localTools.DeleteSkill("canonical-skill");
    Assert(!Directory.Exists(Path.Combine(skillTestRoot, "legacy-folder")) &&
           !Directory.Exists(Path.Combine(skillTestRoot, "duplicate-folder")),
        "deleting a canonical Skill cleans duplicate legacy directories");
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
        LanguageMode: "zh",
        Goal: "Finish the document review"),
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
       !advertisedNames.Contains("execute_command") &&
       !advertisedNames.Contains("read_workspace_file"),
    "ViewOnly and external-tool settings filter advertised Agent tools");
Assert(agentProvider.LastRequest?.Messages.Any(message =>
           message.Role == "user" &&
           message.ImageDataUrl == "data:image/png;base64,iVBORw0KGgo=") == true,
    "Agent forwards the attached image to the model Provider");
Assert(agentProvider.LastRequest?.Messages.Any(message =>
           message.Role == "system" &&
           message.Content.Contains("Simplified Chinese", StringComparison.Ordinal)) == true,
    "Agent applies the configured output language to every provider iteration");
Assert(agentProvider.LastRequest?.Messages.Any(message =>
           message.Role == "system" &&
           message.Content.Contains("Finish the document review", StringComparison.Ordinal)) == true,
    "Agent persists the durable goal in the model context");

var granularProvider = new CapturingProvider([
    new ProviderChatResponse("fake", "fake", "done"),
]);
var granularAgent = new AgentSession(
    "granular-permissions-smoke",
    "https://localhost:3000",
    new AgentStartRequest(
        "inspect",
        Tools: [readTool, .. fakeInternalTools.GetToolDescriptors()],
        AllowLocalTools: false,
        AllowNetworkTools: true,
        AllowMcpTools: true),
    granularProvider,
    [fakeInternalTools]);
granularAgent.Start();
await foreach (var runtimeEvent in granularAgent.ReadEventsAsync())
{
    if (runtimeEvent.Type == "completed") break;
}
var granularNames = granularProvider.LastRequest?.Tools?.Select(tool => tool.Name).ToArray() ?? [];
Assert(granularNames.Contains("read_skill") &&
       granularNames.Contains("fetch_url") &&
       granularNames.Contains("mcp__fake__lookup") &&
       !granularNames.Contains("execute_command"),
    "Agent independently filters local, network, and MCP tools");

Assert(await ObservePermissionAsync("request"),
    "request-approval mode asks before an isolated workspace write");
Assert(!await ObservePermissionAsync("auto"),
    "auto-approve mode permits only the isolated workspace write without prompting");
Assert(!await ObservePermissionAsync("full"),
    "full-access mode skips per-tool confirmation after the UI session confirmation");

var englishPlanMessages = await CapturePlanMessagesAsync("en-US");
var chinesePlanMessages = await CapturePlanMessagesAsync("zh-CN");
Assert(
    englishPlanMessages.Plan.Contains("must be confirmed", StringComparison.Ordinal) &&
    englishPlanMessages.Steps.SequenceEqual(["Inspect the relevant clauses", "Apply the agreed edits"]) &&
    englishPlanMessages.Failure.Contains("rejected by the user", StringComparison.Ordinal),
    "Agent shows a model-authored English TODO only when update_plan is called");
Assert(
    chinesePlanMessages.Plan.Contains("需要确认", StringComparison.Ordinal) &&
    chinesePlanMessages.Steps.SequenceEqual(["检查相关条款", "应用确认后的修改"]) &&
    chinesePlanMessages.Failure.Contains("用户拒绝", StringComparison.Ordinal),
    "Agent shows a model-authored Chinese TODO only when update_plan is called");
var simplePlanProvider = new CapturingProvider([new ProviderChatResponse("fake", "fake", "hello")]);
var simplePlanAgent = new AgentSession(
    "simple-plan-smoke",
    "https://localhost:3000",
    new AgentStartRequest("hello", RequirePlanConfirmation: true),
    simplePlanProvider);
simplePlanAgent.Start();
var simplePlanWasShown = false;
await foreach (var runtimeEvent in simplePlanAgent.ReadEventsAsync())
{
    simplePlanWasShown |= runtimeEvent.Type == "plan_pending";
}
Assert(!simplePlanWasShown &&
       simplePlanProvider.LastRequest?.Tools?.Any(tool => tool.Name == "update_plan") == true,
    "simple Agent requests complete directly while the model retains the option to create a TODO");
foreach (var resourceKey in new[]
         {
             "AgentSessionCancelled",
             "AgentPlanPending",
              "AgentPlanReadStep",
              "AgentPlanAnalyzeStep",
              "AgentPlanApplyStep",
              "AgentPlanProposeStep",
              "AgentPlanAnswerStep",
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
    new AgentStartRequest("continue review", MaxIterations: 5, Goal: "Complete the recovered review"),
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
Assert(recoveredManager.ListRecoveries("https://localhost:3000").Single() is
       { Iteration: 3, Goal: "Complete the recovered review" },
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

var workspaceRoot = Path.Combine(Path.GetTempPath(), "wordollama-workspace-smoke-" + Guid.NewGuid().ToString("N"));
var workspaceFactory = new AgentWorkspaceFactory(workspaceRoot);
var workspaceSessionId = Guid.NewGuid().ToString("N");
var workspace = workspaceFactory.Create(workspaceSessionId);
await workspace.ExecuteAsync("write_workspace_file", JsonSerializer.SerializeToElement(new
{
    path = "notes/plan.md",
    content = "# Plan\nSafe workspace",
}));
var workspaceRead = await workspace.ExecuteAsync("read_workspace_file", JsonSerializer.SerializeToElement(new
{
    path = "notes/plan.md",
}));
Assert(workspaceRead.Contains("Safe workspace", StringComparison.Ordinal), "workspace roundtrip");
var workspaceEscapeBlocked = false;
try
{
    await workspace.ExecuteAsync("read_workspace_file", JsonSerializer.SerializeToElement(new { path = "../outside.txt" }));
}
catch (InvalidOperationException)
{
    workspaceEscapeBlocked = true;
}
Assert(workspaceEscapeBlocked, "workspace traversal is blocked");
workspaceFactory.Delete(workspaceSessionId);
Assert(!Directory.Exists(Path.Combine(workspaceRoot, workspaceSessionId)), "workspace cleanup");
var degradedWorkspaceFactory = new AgentWorkspaceFactory(
    workspaceRoot,
    new FailingAgentCodeSandboxFactory());
var degradedWorkspaceSessionId = Guid.NewGuid().ToString("N");
var degradedWorkspace = degradedWorkspaceFactory.Create(degradedWorkspaceSessionId);
var degradedToolNames = degradedWorkspace.GetToolDescriptors()
    .Select(tool => tool.Name)
    .ToHashSet(StringComparer.Ordinal);
Assert(
    degradedToolNames.Contains("write_workspace_file") &&
    !degradedToolNames.Contains("run_python") &&
    !degradedToolNames.Contains("run_node"),
    "Agent creation fails closed to workspace-only tools when code sandbox setup is unavailable");
degradedWorkspaceFactory.Delete(degradedWorkspaceSessionId);
var workspaceProvider = new CapturingProvider([
    new ProviderChatResponse("fake", "fake", "workspace ready"),
]);
var workspaceManager = new AgentSessionManager(
    workspaceProvider,
    Array.Empty<IInternalToolExecutor>(),
    workspaceFactory: workspaceFactory);
var workspaceAgent = workspaceManager.Create(
    new AgentStartRequest("prepare notes", AllowLocalTools: true),
    "https://localhost:3000");
await foreach (var runtimeEvent in workspaceAgent.ReadEventsAsync())
{
    if (runtimeEvent.Type == "completed") break;
}
Assert(workspaceProvider.LastRequest?.Tools?.Any(tool => tool.Name == "write_workspace_file") == true,
    "session workspace tools are advertised to the Agent");
workspaceManager.Remove(workspaceAgent.Id);
Assert(!Directory.Exists(Path.Combine(workspaceRoot, workspaceAgent.Id)),
    "session manager cleans the workspace after completion");
Directory.Delete(workspaceRoot);

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

static async Task<bool> ObservePermissionAsync(string permissionMode)
{
    var tools = new FakeInternalTools();
    var provider = new CapturingProvider([
        new ProviderChatResponse("fake", "fake", "", [
            new ProviderToolCall("workspace-call", "write_workspace_file", JsonSerializer.SerializeToElement(new { path = "note.txt", content = "ok" })),
        ]),
        new ProviderChatResponse("fake", "fake", "finished"),
    ]);
    var session = new AgentSession(
        "permission-mode-" + permissionMode,
        "https://localhost:3000",
        new AgentStartRequest(
            "write a temporary note",
            Tools: tools.GetToolDescriptors(),
            AllowLocalTools: true,
            PermissionMode: permissionMode),
        provider,
        [tools]);
    session.Start();
    var requested = false;
    await foreach (var runtimeEvent in session.ReadEventsAsync())
    {
        if (runtimeEvent.Type == "permission_request")
        {
            requested = true;
            var callId = runtimeEvent.Data?.GetProperty("callId").GetString() ?? "";
            session.SubmitPermission(new AgentPermissionRequest(callId, true));
        }
        if (runtimeEvent.Type == "completed") break;
    }
    return requested;
}

static void Assert(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException($"Failed: {name}");
}

static async Task<(string Plan, string Failure, IReadOnlyList<string> Steps)> CapturePlanMessagesAsync(string uiLocale)
{
    var planSteps = uiLocale.StartsWith("zh", StringComparison.OrdinalIgnoreCase)
        ? new[] { "检查相关条款", "应用确认后的修改" }
        : new[] { "Inspect the relevant clauses", "Apply the agreed edits" };
    var session = new AgentSession(
        $"locale-{uiLocale}",
        "https://localhost:3000",
        new AgentStartRequest(
            "inspect",
            RequirePlanConfirmation: true,
            UiLocale: uiLocale),
        new CapturingProvider([
            new ProviderChatResponse(
                "fake",
                "fake",
                "",
                [new ProviderToolCall(
                    "plan-1",
                    "update_plan",
                    JsonSerializer.SerializeToElement(new { steps = planSteps }))]),
        ]));
    session.Start();
    var plan = string.Empty;
    var failure = string.Empty;
    IReadOnlyList<string> steps = [];
    await foreach (var runtimeEvent in session.ReadEventsAsync())
    {
        if (runtimeEvent.Type == "plan_pending")
        {
            plan = runtimeEvent.Message ?? string.Empty;
            if (runtimeEvent.Data is { } data && data.TryGetProperty("steps", out var stepsElement))
            {
                steps = stepsElement.EnumerateArray()
                    .Select(step => step.GetString() ?? string.Empty)
                    .Where(step => !string.IsNullOrWhiteSpace(step))
                    .ToArray();
            }
            session.ConfirmPlan(new AgentPlanConfirmationRequest(false));
        }
        if (runtimeEvent.Type == "failed")
        {
            failure = runtimeEvent.Message ?? string.Empty;
            break;
        }
    }
    return (plan, failure, steps);
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

sealed class FailingAgentCodeSandboxFactory : IAgentCodeSandboxFactory
{
    public IAgentCodeSandbox Create(string sessionId, string workspaceRoot) =>
        throw new InvalidOperationException("sandbox setup fixture");
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
        new("fetch_url", "request", false, Schema),
        new("write_workspace_file", "workspace write", false, Schema),
        new("mcp__fake__lookup", "lookup", false, Schema),
    ];
    public bool IsKnownTool(string name) =>
        name is "read_skill" or "execute_command" or "fetch_url" or "write_workspace_file" or "mcp__fake__lookup";
    public Task<string> ExecuteAsync(string name, JsonElement arguments, CancellationToken cancellationToken = default) =>
        Task.FromResult("ok");
}

sealed class ResponsesApiSmokeHandler : HttpMessageHandler
{
    public string? LastPath { get; private set; }
    public string? LastRequestBody { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        LastPath = request.RequestUri?.AbsolutePath;
        LastRequestBody = await request.Content!.ReadAsStringAsync(cancellationToken);
        if (LastRequestBody.Contains("\"stream\":true", StringComparison.Ordinal))
        {
            var stream = string.Join(
                "\n\n",
                """data: {"type":"response.output_text.delta","delta":"Responses "}""",
                """data: {"type":"response.output_text.delta","delta":"reply"}""",
                """data: {"type":"response.completed","response":{"output":[]}}""",
                "data: [DONE]",
                string.Empty);
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(stream, Encoding.UTF8, "text/event-stream"),
            };
            return response;
        }

        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                "{\"output_text\":\"Responses reply\",\"output\":[]}",
                Encoding.UTF8,
                "application/json"),
        };
    }
}

sealed class JsonCaptureHandler(string responseBody) : HttpMessageHandler
{
    public string? LastRequestBody { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        LastRequestBody = request.Content is null
            ? null
            : await request.Content.ReadAsStringAsync(cancellationToken);
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(responseBody, Encoding.UTF8, "application/json"),
        };
    }
}

sealed class ProviderSmokeHandler(
    string responseBody,
    HttpStatusCode statusCode = HttpStatusCode.OK,
    string mediaType = "application/json") : HttpMessageHandler
{
    public Uri? LastRequestUri { get; private set; }
    public string? LastRequestBody { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        LastRequestUri = request.RequestUri;
        LastRequestBody = request.Content is null
            ? null
            : await request.Content.ReadAsStringAsync(cancellationToken);
        return new HttpResponseMessage(statusCode)
        {
            Content = new StringContent(responseBody, Encoding.UTF8, mediaType),
        };
    }
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
