using System.Security.Cryptography;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Net;
using WordOllama.DesktopBridge;
using WordOllama.Contracts;
using WordOllama.Core;
using WordOllama.Mcp;
using WordOllama.Platform;

if (HttpsCertificateSecretCommand.IsRequested(args))
{
    Environment.ExitCode = HttpsCertificateSecretCommand.Execute(
        args,
        new PlatformSecretStore(),
        Console.In,
        Console.Out,
        Console.Error,
        Console.IsInputRedirected);
    return;
}

var userScope = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
if (string.IsNullOrWhiteSpace(userScope))
{
    userScope = Environment.UserName;
}
var instanceHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(userScope)))[..16];
using var instanceMutex = new Mutex(
    initiallyOwned: true,
    name: $"WordOllama.DesktopBridge.{instanceHash}",
    createdNew: out var ownsInstanceMutex);
if (!ownsInstanceMutex)
{
    Console.Error.WriteLine("WordOllama Desktop Bridge is already running for this user.");
    return;
}

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
});
var settingsRoot = PlatformPaths.GetSettingsRoot();
var defaultSkillsRoot = PlatformPaths.GetSkillsRoot();
var usesDefaultPersistentPath = new[]
{
    "Bridge:ProviderSettingsPath",
    "Bridge:McpSettingsPath",
    "Bridge:ReviewSettingsPath",
    "Bridge:AgentRecoveryPath",
    "Bridge:LocalTools:SkillsRoot",
}.Any(key => string.IsNullOrWhiteSpace(builder.Configuration[key]));
if (builder.Configuration.GetValue("Bridge:MigrateLegacyUserData", true) &&
    usesDefaultPersistentPath)
{
    try
    {
        var migration = LegacyUserDataMigrator.Migrate(
            PlatformPaths.GetLegacySettingsRoot(),
            settingsRoot,
            PlatformPaths.GetLegacySkillsRoot(),
            defaultSkillsRoot);
        if (migration.SettingsFilesCopied > 0 || migration.SkillFilesCopied > 0)
        {
            Console.WriteLine(
                $"Migrated {migration.SettingsFilesCopied} settings files and " +
                $"{migration.SkillFilesCopied} Skill files into the isolated WordOllama.JS profile.");
        }
    }
    catch (Exception exception) when (
        exception is IOException or UnauthorizedAccessException or OverflowException)
    {
        Console.Error.WriteLine(
            $"Legacy user-data migration was skipped safely: {exception.Message}");
    }
}
var bridgeUrls = builder.Configuration["Bridge:Urls"]
    ?? "http://127.0.0.1:37421";
var configuredSkillsRoot = builder.Configuration["Bridge:LocalTools:SkillsRoot"];
var skillsRoot = string.IsNullOrWhiteSpace(configuredSkillsRoot)
    ? defaultSkillsRoot
    : configuredSkillsRoot;
var configuredAuthorizedRoots = builder.Configuration
    .GetSection("Bridge:LocalTools:AuthorizedRoots")
    .Get<string[]>();
var authorizedRoots = configuredAuthorizedRoots is { Length: > 0 }
    ? configuredAuthorizedRoots
    : [skillsRoot];
var configuredAllowedExecutables = builder.Configuration
    .GetSection("Bridge:LocalTools:AllowedExecutables")
    .Get<string[]>();
var allowedExecutables = configuredAllowedExecutables is { Length: > 0 }
    ? configuredAllowedExecutables
    : ["python", "python3", "dotnet"];
var configuredPythonExecutable = builder.Configuration["Bridge:LocalTools:PythonExecutable"];
var pythonExecutable = string.IsNullOrWhiteSpace(configuredPythonExecutable)
    ? (OperatingSystem.IsWindows() ? "python" : "python3")
    : configuredPythonExecutable;
var allowHttpRequests = builder.Configuration.GetValue("Bridge:LocalTools:AllowHttpRequests", false);
var modelProviderType = builder.Configuration["Bridge:ModelProvider:Type"] ?? "Ollama";
var modelProviderEndpoint = builder.Configuration["Bridge:ModelProvider:Endpoint"]
    ?? builder.Configuration["Bridge:Ollama:Endpoint"]
    ?? "http://127.0.0.1:11434";
var secretStore = new PlatformSecretStore();
var modelProviderApiKey = builder.Configuration["Bridge:ModelProvider:ApiKey"];
if (string.IsNullOrWhiteSpace(modelProviderApiKey))
{
    var providerSecretName = modelProviderType.Trim().ToUpperInvariant() switch
    {
        "CLAUDE" or "ANTHROPIC" => "WORDOLLAMA_ANTHROPIC_API_KEY",
        "GEMINI" or "GOOGLE" => "WORDOLLAMA_GEMINI_API_KEY",
        "OPENAI" => "WORDOLLAMA_OPENAI_API_KEY",
        _ => "WORDOLLAMA_PROVIDER_API_KEY",
    };
    modelProviderApiKey = secretStore.Get(providerSecretName)
        ?? secretStore.Get("WORDOLLAMA_PROVIDER_API_KEY")
        ?? string.Empty;
}
var modelProviderModel = builder.Configuration["Bridge:ModelProvider:Model"]
    ?? builder.Configuration["Bridge:Ollama:Model"]
    ?? string.Empty;
var initialProviderOptions = new ModelProviderOptions(
    modelProviderType,
    modelProviderEndpoint,
    modelProviderApiKey,
    modelProviderModel);
var providerSettingsPath = builder.Configuration["Bridge:ProviderSettingsPath"]
    ?? Path.Combine(settingsRoot, "provider-settings.json");
var providerSettings = new ProviderSettingsStore(
    providerSettingsPath,
    initialProviderOptions,
    secretStore);
var reloadableProvider = new ReloadableModelProvider(providerSettings.GetActiveOptions());
var configuredMcpSettingsPath = builder.Configuration["Bridge:McpSettingsPath"];
var mcpSettingsPath = configuredMcpSettingsPath
    ?? Path.Combine(settingsRoot, "mcp-settings.json");
var legacyMcpSettingsPath = string.IsNullOrWhiteSpace(configuredMcpSettingsPath)
    ? Path.Combine(PlatformPaths.GetLegacySettingsRoot(), "mcp-servers.json")
    : null;
var mcpSettings = new McpSettingsStore(
    mcpSettingsPath,
    secretStore,
    legacyMcpSettingsPath);
var reviewSettingsPath = builder.Configuration["Bridge:ReviewSettingsPath"]
    ?? Path.Combine(settingsRoot, "review-settings.json");
var reviewSettings = new ReviewSettingsStore(reviewSettingsPath);
var agentRecoveryPath = builder.Configuration["Bridge:AgentRecoveryPath"]
    ?? Path.Combine(settingsRoot, "agent-recovery.bin");
var agentRecoveryStore = new EncryptedAgentRecoveryStore(agentRecoveryPath, secretStore);
var bridgeVersion = typeof(Program).Assembly
    .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
    .InformationalVersion.Split('+', 2)[0]
    ?? typeof(Program).Assembly.GetName().Version?.ToString()
    ?? "0.1.0";
var updateIndexUrl = builder.Configuration["Bridge:Updates:IndexUrl"] ?? string.Empty;
var expectedUpdatePublisherSubject =
    builder.Configuration["Bridge:Updates:ExpectedPublisherSubject"] ?? string.Empty;
var updateService = new UpdateIndexService(new HttpClient(), updateIndexUrl, bridgeVersion);
var updateDownloadRoot = Path.Combine(settingsRoot, "updates");

foreach (var configuredUrl in bridgeUrls.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
{
    if (!Uri.TryCreate(configuredUrl, UriKind.Absolute, out var bridgeUri) ||
        (bridgeUri.Scheme != Uri.UriSchemeHttps &&
         !(bridgeUri.Scheme == Uri.UriSchemeHttp &&
           bridgeUri.Host is "127.0.0.1" or "localhost" or "::1")))
    {
        throw new InvalidOperationException(
            "Bridge URLs must use HTTPS; loopback HTTP is allowed only for local development.");
    }
}

var httpsCertificatePath = builder.Configuration["Bridge:HttpsCertificate:Path"];
var configuredHttpsCertificatePassword = builder.Configuration["Bridge:HttpsCertificate:Password"];
var httpsCertificatePassword =
    secretStore.Get(HttpsCertificateSecretCommand.SecretName)
    ?? Environment.GetEnvironmentVariable(HttpsCertificateSecretCommand.SecretName)
    ?? configuredHttpsCertificatePassword;
var bridgeEndpoints = bridgeUrls.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    .Select(url => new Uri(url, UriKind.Absolute))
    .ToArray();
if (bridgeEndpoints.Any(endpoint => endpoint.Scheme == Uri.UriSchemeHttps))
{
    if (string.IsNullOrWhiteSpace(httpsCertificatePath) &&
        !builder.Environment.IsDevelopment())
    {
        throw new InvalidOperationException(
            "Production HTTPS requires Bridge:HttpsCertificate:Path; provide WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD when the PFX is encrypted.");
    }

    if (!string.IsNullOrWhiteSpace(httpsCertificatePath) &&
        !File.Exists(httpsCertificatePath))
    {
        throw new InvalidOperationException(
            $"Configured HTTPS certificate file was not found: {httpsCertificatePath}");
    }

    builder.WebHost.ConfigureKestrel(options =>
    {
        foreach (var endpoint in bridgeEndpoints)
        {
            var port = endpoint.Port > 0 ? endpoint.Port : 443;
            if (endpoint.Scheme == Uri.UriSchemeHttps)
            {
                options.ListenLocalhost(port, listen =>
                {
                    if (!string.IsNullOrWhiteSpace(httpsCertificatePath))
                    {
                        listen.UseHttps(httpsCertificatePath, httpsCertificatePassword);
                    }
                    else
                    {
                        listen.UseHttps();
                    }
                });
            }
            else
            {
                options.Listen(IPAddress.Loopback, port);
            }
        }
    });
}
else
{
    builder.WebHost.UseUrls(bridgeUrls);
}
builder.Services.AddSingleton<BridgeSessionStore>();
builder.Services.AddSingleton<IProcessRunner, ProcessRunner>();
builder.Services.AddSingleton<ISystemFolderLauncher, SystemFolderLauncher>();
builder.Services.AddSingleton(new LocalToolPolicy(
    new HashSet<string>(allowedExecutables, StringComparer.OrdinalIgnoreCase),
    authorizedRoots,
    skillsRoot,
    pythonExecutable,
    allowHttpRequests));
builder.Services.AddSingleton<LocalToolService>();
builder.Services.AddSingleton<IInternalToolExecutor>(sp => sp.GetRequiredService<LocalToolService>());
builder.Services.AddSingleton<IMutableSecretStore>(secretStore);
builder.Services.AddSingleton(providerSettings);
builder.Services.AddSingleton(reloadableProvider);
builder.Services.AddSingleton<IModelProvider>(reloadableProvider);
builder.Services.AddSingleton(mcpSettings);
builder.Services.AddSingleton(reviewSettings);
builder.Services.AddSingleton<IAgentRecoveryStore>(agentRecoveryStore);
builder.Services.AddSingleton<GoogleOAuthService>();
builder.Services.AddSingleton(updateService);
builder.Services.AddSingleton<IUpdateInstallerPlatform, SystemUpdateInstallerPlatform>();
builder.Services.AddSingleton(sp => new UpdateInstallerService(
    new HttpClient(),
    updateService,
    sp.GetRequiredService<IUpdateInstallerPlatform>(),
    updateDownloadRoot,
    expectedUpdatePublisherSubject));
builder.Services.AddSingleton<AgentSessionManager>();
builder.Services.AddSingleton<IInternalToolExecutor, McpToolExecutor>();
builder.Services.AddSingleton<McpManager>();
builder.Services.AddSingleton<IDocumentComparer, OpenXmlDocumentComparer>();
builder.Services.AddSingleton<LegalArticleService>();
builder.Services.AddSingleton<AutomaticMemoryService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<AutomaticMemoryService>());
builder.Services.AddSingleton<IAgentRuntime>(sp => new AgentRuntime(
    sp.GetRequiredService<IModelProvider>(),
    sp.GetServices<IInternalToolExecutor>()));
builder.Services.AddCors(options =>
{
    options.AddPolicy("officejs", policy =>
    {
        var origins = builder.Configuration.GetSection("Bridge:AllowedOrigins")
            .Get<string[]>()
            ?? ["https://localhost:3000", "https://localhost:5173"];

        policy.WithOrigins(origins)
            .WithHeaders("Content-Type", "Accept-Language", BridgeProtocol.SessionHeader, BridgeProtocol.CsrfHeader)
            .WithMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
            .AllowCredentials();
    });
});

var app = builder.Build();
var addinWebRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
if (Directory.Exists(addinWebRoot))
{
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(addinWebRoot),
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(addinWebRoot),
    });
}
app.UseCors("officejs");
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    if (context.Request.Method is "POST" or "PUT" or "PATCH" or "DELETE" &&
        !context.Request.Path.StartsWithSegments("/pair"))
    {
        var token = context.Request.Headers[BridgeProtocol.SessionHeader].FirstOrDefault()
            ?? context.Request.Cookies[BridgeSessionStore.CookieName];
        var origin = context.Request.Headers.Origin.FirstOrDefault();
        if (!context.RequestServices.GetRequiredService<BridgeSessionStore>()
                .TryGet(token, origin, out var session) ||
            !session.IsCsrfValid(context.Request.Headers[BridgeProtocol.CsrfHeader].FirstOrDefault()))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }
    }
    await next();
});
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (NoActiveModelException) when (!context.Response.HasStarted)
    {
        context.Response.Clear();
        context.Response.StatusCode = StatusCodes.Status409Conflict;
        await context.Response.WriteAsJsonAsync(new
        {
            error = UiText.Get(context.Request.Headers.AcceptLanguage.FirstOrDefault(), "NoActiveModel"),
        });
    }
});
var eventJsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var agentRecoveryCapabilities = agentRecoveryStore.Enabled
    ? new[] { "encrypted-agent-recovery" }
    : Array.Empty<string>();

app.MapGet("/health", (IAgentRuntime runtime, IModelProvider provider) =>
    Results.Ok(new BridgeHealthResponse(
        BridgeProtocol.CurrentVersion,
        bridgeVersion,
        Ready: true,
        ["bridge", .. runtime.Capabilities, provider.ProviderType, "provider-settings", "local-process", "local-secrets", "legal-articles", .. agentRecoveryCapabilities])));

if (app.Environment.IsDevelopment())
{
    app.MapPost("/pair", (PairRequest request, BridgeSessionStore sessions) =>
    {
        if (string.IsNullOrWhiteSpace(request.PairingCode) ||
            !sessions.IsPairingCodeValid(request.PairingCode))
        {
            return Results.Unauthorized();
        }

        if (!sessions.IsOriginAllowed(request.Origin))
        {
            return Results.BadRequest(new { error = "origin_not_allowed" });
        }

        var session = sessions.Create(request.Origin);
        return Results.Ok(new PairResponse(
            BridgeProtocol.CurrentVersion,
            session.Token,
            session.ExpiresAt,
            ["agent", "providers", "provider-settings", "mcp", "skills", "local-tools", .. agentRecoveryCapabilities],
            session.CsrfToken));
    });
}

app.MapPost("/pair/automatic", (
    AutomaticPairRequest request,
    HttpContext httpContext,
    BridgeSessionStore sessions) =>
{
    var remoteAddress = httpContext.Connection.RemoteIpAddress;
    var requestOrigin = httpContext.Request.Headers["Origin"].FirstOrDefault();
    if (remoteAddress is null ||
        !IPAddress.IsLoopback(remoteAddress) ||
        string.IsNullOrWhiteSpace(requestOrigin) ||
        !string.Equals(requestOrigin, request.Origin, StringComparison.OrdinalIgnoreCase))
    {
        return Results.Unauthorized();
    }

    if (!sessions.IsOriginAllowed(request.Origin))
    {
        return Results.BadRequest(new { error = "origin_not_allowed" });
    }

    var session = sessions.Create(request.Origin);
    httpContext.Response.Cookies.Append(
        BridgeSessionStore.CookieName,
        session.Token,
        new CookieOptions
        {
            HttpOnly = true,
            Secure = httpContext.Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            Expires = session.ExpiresAt,
        });
    return Results.Ok(new PairResponse(
        BridgeProtocol.CurrentVersion,
        session.Token,
        session.ExpiresAt,
        ["agent", "providers", "provider-settings", "mcp", "skills", "local-tools", .. agentRecoveryCapabilities],
        session.CsrfToken));
});

app.MapGet("/updates/check", async (
    HttpRequest httpRequest,
    BridgeSessionStore sessions,
    UpdateIndexService updates,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        return Results.Ok(await updates.CheckAsync(cancellationToken));
    }
    catch (Exception exception) when (
        exception is HttpRequestException or JsonException or InvalidDataException or
        PlatformNotSupportedException)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/updates/install", async (
    HttpRequest httpRequest,
    BridgeSessionStore sessions,
    UpdateInstallerService installer,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        return Results.Ok(await installer.DownloadVerifyAndLaunchAsync(cancellationToken));
    }
    catch (UpdateInstallBusyException exception)
    {
        return Results.Conflict(new { error = exception.Message });
    }
    catch (UpdateInstallUnavailableException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (Exception exception) when (
        exception is HttpRequestException or JsonException or InvalidDataException or
        PlatformNotSupportedException or InvalidOperationException)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/commands", async (
    HttpRequest httpRequest,
    CommandRequest request,
    BridgeSessionStore sessions,
    IAgentRuntime runtime,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    if (!sessions.TryGet(token, httpRequest.Headers.Origin, out _))
    {
        return Results.Unauthorized();
    }

    var requestId = Guid.NewGuid().ToString("N");
    await foreach (var runtimeEvent in runtime.ExecuteAsync(request, cancellationToken))
    {
        if (runtimeEvent.Type == "failed")
        {
            return Results.Json(
                new CommandResponse(requestId, "failed", runtimeEvent.Message),
                statusCode: StatusCodes.Status400BadRequest);
        }
    }

    return Results.Ok(new CommandResponse(requestId, "accepted"));
});

app.MapPost("/capabilities", (
    HttpRequest httpRequest,
    ToolCatalogRequest request,
    BridgeSessionStore sessions) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }

    sessions.RegisterOfficeTools(token!, request.Tools);
    return Results.Ok(new ToolCatalogResponse(
        BridgeProtocol.CurrentVersion,
        request.Tools.Count,
        request.Tools));
});

async Task<IResult> ChatWithProvider(
    HttpRequest httpRequest,
    ProviderChatRequest request,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    IModelProvider provider,
    AutomaticMemoryService automaticMemory,
    CancellationToken cancellationToken)
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }

    try
    {
        var selectedProvider = string.IsNullOrWhiteSpace(request.ProviderProfileId)
            ? provider
            : ModelProviderFactory.Create(settings.GetOptions(request.ProviderProfileId));
        var response = await selectedProvider.ChatAsync(
            settings.ApplyDefaults(request, request.ProviderProfileId),
            cancellationToken);
        automaticMemory.Observe(request);
        return Results.Ok(response);
    }
    catch (HttpRequestException exception)
    {
        return Results.Problem(
            exception.Message,
            statusCode: StatusCodes.Status502BadGateway,
            title: "Model provider unavailable");
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
}

app.MapPost("/providers/chat", ChatWithProvider);
// Kept for clients from the first migration preview.
app.MapPost("/providers/ollama/chat", ChatWithProvider);

async Task StreamProviderChat(
    HttpContext httpContext,
    ProviderChatRequest request,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    IModelProvider provider,
    AutomaticMemoryService automaticMemory,
    CancellationToken cancellationToken)
{
    var token = httpContext.Request.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpContext.Request.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        httpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    httpContext.Response.ContentType = "application/x-ndjson";
    httpContext.Response.Headers.CacheControl = "no-cache";
    var selectedProvider = string.IsNullOrWhiteSpace(request.ProviderProfileId)
        ? provider
        : ModelProviderFactory.Create(settings.GetOptions(request.ProviderProfileId));
    await foreach (var chunk in selectedProvider.ChatStreamAsync(
        settings.ApplyDefaults(request, request.ProviderProfileId),
        cancellationToken))
    {
        await httpContext.Response.WriteAsync(
            JsonSerializer.Serialize(chunk, eventJsonOptions) + "\n",
            cancellationToken);
        await httpContext.Response.Body.FlushAsync(cancellationToken);
    }
    automaticMemory.Observe(request);
}

app.MapPost("/providers/chat/stream", StreamProviderChat);

async Task<IResult> ListProviderModels(
    HttpRequest httpRequest,
    BridgeSessionStore sessions,
    IModelProvider provider,
    CancellationToken cancellationToken)
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }

    try
    {
        return Results.Ok(new
        {
            provider = provider.ProviderType,
            models = await provider.FetchModelsAsync(cancellationToken),
        });
    }
    catch (HttpRequestException exception)
    {
        return Results.Problem(
            exception.Message,
            statusCode: StatusCodes.Status502BadGateway,
            title: "Model provider unavailable");
    }
}

app.MapGet("/providers/models", ListProviderModels);
// Kept for clients from the first migration preview.
app.MapGet("/providers/ollama/models", ListProviderModels);

app.MapGet("/providers/runtime", async (
    HttpRequest httpRequest,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();

    var active = settings.GetActiveProfile();
    if (active is null)
    {
        return Results.Ok(new ProviderRuntimeResponse(string.Empty, string.Empty, []));
    }
    try
    {
        IReadOnlyList<string> models =
            string.Equals(active.Type, "Ollama", StringComparison.OrdinalIgnoreCase)
                ? await new OllamaModelManager(active.Endpoint).GetRunningModelsAsync(cancellationToken)
                : string.IsNullOrWhiteSpace(active.Model) ? [] : [active.Model];
        return Results.Ok(new ProviderRuntimeResponse(active.Name, active.Type, models));
    }
    catch (HttpRequestException)
    {
        return Results.Ok(new ProviderRuntimeResponse(active.Name, active.Type, []));
    }
});

app.MapPost("/providers/ollama/models/pull", async (
    HttpContext httpContext,
    OllamaModelRequest request,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    CancellationToken cancellationToken) =>
{
    var token = httpContext.Request.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpContext.Request.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        httpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }
    try
    {
        var manager = CreateActiveOllamaManager(
            settings,
            httpContext.Request.Headers.AcceptLanguage.FirstOrDefault());
        httpContext.Response.ContentType = "application/x-ndjson";
        httpContext.Response.Headers.CacheControl = "no-cache";
        await foreach (var progress in manager.PullAsync(request.Model, cancellationToken))
        {
            await httpContext.Response.WriteAsync(
                JsonSerializer.Serialize(progress, eventJsonOptions) + "\n",
                cancellationToken);
            await httpContext.Response.Body.FlushAsync(cancellationToken);
        }
    }
    catch (ArgumentException exception)
    {
        if (!httpContext.Response.HasStarted)
        {
            httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await httpContext.Response.WriteAsJsonAsync(new { error = exception.Message }, cancellationToken);
        }
    }
    catch (HttpRequestException exception)
    {
        if (!httpContext.Response.HasStarted)
        {
            httpContext.Response.StatusCode = StatusCodes.Status502BadGateway;
            await httpContext.Response.WriteAsJsonAsync(new { error = exception.Message }, cancellationToken);
        }
    }
});

app.MapPost("/providers/ollama/models/load", async (
    HttpRequest httpRequest,
    OllamaModelRequest request,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        await CreateActiveOllamaManager(
            settings,
            httpRequest.Headers.AcceptLanguage.FirstOrDefault()).LoadAsync(
                request.Model,
                cancellationToken);
        return Results.Ok(new { loaded = true });
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (HttpRequestException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapDelete("/providers/ollama/models/{model}", async (
    HttpRequest httpRequest,
    string model,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        await CreateActiveOllamaManager(
            settings,
            httpRequest.Headers.AcceptLanguage.FirstOrDefault()).DeleteAsync(
                model,
                cancellationToken);
        return Results.Ok(new { deleted = true });
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (HttpRequestException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapGet("/legal/article", async (
    HttpRequest httpRequest,
    string law,
    string article,
    BridgeSessionStore sessions,
    LegalArticleService legalArticles,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }
    try
    {
        var result = await legalArticles.SearchAsync(law, article, cancellationToken);
        return result is null ? Results.NotFound(new { error = "article_not_found" }) : Results.Ok(result);
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (Exception exception) when (
        exception is HttpRequestException or JsonException or InvalidOperationException)
    {
        return Results.Problem(
            exception.Message,
            statusCode: StatusCodes.Status502BadGateway,
            title: "Legal article service unavailable");
    }
});

app.MapGet("/settings/providers", (
    HttpRequest httpRequest,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    return sessions.TryGet(token, origin, out _)
        ? Results.Ok(settings.GetView())
        : Results.Unauthorized();
});

app.MapPut("/settings/providers/{id}", (
    HttpRequest httpRequest,
    string id,
    ProviderProfileUpdate request,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    ReloadableModelProvider provider) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        var view = settings.Upsert(request with { Id = id });
        if (string.Equals(view.ActiveProviderId, id, StringComparison.OrdinalIgnoreCase))
        {
            provider.Reload(settings.GetActiveOptions());
        }
        return Results.Ok(view);
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (PlatformNotSupportedException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status501NotImplemented);
    }
});

app.MapPost("/settings/providers/{id}/activate", (
    HttpRequest httpRequest,
    string id,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    ReloadableModelProvider provider) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        var view = settings.Activate(id);
        provider.Reload(settings.GetActiveOptions());
        return Results.Ok(view);
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
});

app.MapDelete("/settings/providers/{id}", (
    HttpRequest httpRequest,
    string id,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    ReloadableModelProvider provider) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        var view = settings.Delete(id);
        provider.Reload(settings.GetActiveOptions());
        return Results.Ok(view);
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
    catch (InvalidOperationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/settings/providers/models", async (
    HttpRequest httpRequest,
    ProviderProfileUpdate request,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        var candidate = ModelProviderFactory.Create(settings.BuildOptionsForModelFetch(request));
        var models = await candidate.FetchModelsAsync(cancellationToken);
        return Results.Ok(new { provider = candidate.ProviderType, models });
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (HttpRequestException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/settings/providers/{id}/oauth/google", async (
    HttpRequest httpRequest,
    string id,
    GoogleOAuthRequest request,
    BridgeSessionStore sessions,
    ProviderSettingsStore settings,
    ReloadableModelProvider provider,
    GoogleOAuthService oauth,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        var profile = settings.GetOptions(id);
        if (profile.Type.Trim().ToLowerInvariant() is not ("gemini" or "google"))
        {
            return Results.BadRequest(new
            {
                error = UiText.Get(request.UiLocale, "OAuthGeminiOnly"),
            });
        }
        var oauthResult = await oauth.AuthorizeAsync(request, cancellationToken);
        var view = settings.SetGoogleOAuthCredential(id, oauthResult.Credential);
        if (string.Equals(view.ActiveProviderId, id, StringComparison.OrdinalIgnoreCase))
        {
            provider.Reload(settings.GetActiveOptions());
        }
        return Results.Ok(new
        {
            providerSettings = view,
            oauthResult.HasRefreshToken,
        });
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (TimeoutException exception)
    {
        return Results.Problem(
            exception.Message,
            statusCode: StatusCodes.Status408RequestTimeout);
    }
    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
    {
        return Results.StatusCode(499);
    }
    catch (Exception exception) when (
        exception is HttpRequestException or JsonException or InvalidOperationException)
    {
        return Results.Problem(
            exception.Message,
            statusCode: StatusCodes.Status502BadGateway,
            title: UiText.Get(request.UiLocale, "OAuthFailedTitle"));
    }
});

app.MapGet("/settings/review", (
    HttpRequest httpRequest,
    BridgeSessionStore sessions,
    ReviewSettingsStore settings) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    return sessions.TryGet(token, origin, out _)
        ? Results.Ok(settings.Get())
        : Results.Unauthorized();
});

app.MapPut("/settings/review", (
    HttpRequest httpRequest,
    ReviewSettingsUpdate request,
    BridgeSessionStore sessions,
    ReviewSettingsStore settings) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        return Results.Ok(settings.Save(request));
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/settings/memories", (
    HttpRequest httpRequest,
    MemoryUpdate request,
    BridgeSessionStore sessions,
    ReviewSettingsStore settings) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        return Results.Ok(settings.AddMemory(request));
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPut("/settings/memories/{id}", (
    string id,
    HttpRequest httpRequest,
    MemoryUpdate request,
    BridgeSessionStore sessions,
    ReviewSettingsStore settings) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        return Results.Ok(settings.UpdateMemory(id, request));
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (KeyNotFoundException)
    {
        return Results.NotFound();
    }
});

app.MapPost("/settings/memories/delete", (
    HttpRequest httpRequest,
    MemoryDeleteRequest request,
    BridgeSessionStore sessions,
    ReviewSettingsStore settings) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    return sessions.TryGet(token, origin, out _)
        ? Results.Ok(settings.DeleteMemories(request.Ids))
        : Results.Unauthorized();
});

app.MapPost("/local/execute-command", async (
    HttpRequest httpRequest,
    ExecuteCommandRequest request,
    BridgeSessionStore sessions,
    ProviderSettingsStore providerSettings,
    LocalToolService localTools,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }

    try
    {
        return Results.Ok(await localTools.ExecuteCommandAsync(request, cancellationToken));
    }
    catch (LocalToolPolicyException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status403Forbidden);
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/local/run-python", async (
    HttpRequest httpRequest,
    RunPythonScriptRequest request,
    BridgeSessionStore sessions,
    LocalToolService localTools,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }

    try
    {
        return Results.Ok(await localTools.RunPythonScriptAsync(request, cancellationToken));
    }
    catch (LocalToolPolicyException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status403Forbidden);
    }
});

app.MapPost("/local/grep", async (
    HttpRequest httpRequest,
    GrepRequest request,
    BridgeSessionStore sessions,
    LocalToolService localTools,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }

    try
    {
        return Results.Ok(await localTools.GrepAsync(request, cancellationToken));
    }
    catch (LocalToolPolicyException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status403Forbidden);
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/skills/read", async (
    HttpRequest httpRequest,
    ReadSkillRequest request,
    BridgeSessionStore sessions,
    LocalToolService localTools,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }

    try
    {
        return Results.Ok(new { skillName = request.SkillName, content = await localTools.ReadSkillAsync(request, cancellationToken) });
    }
    catch (LocalToolPolicyException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status403Forbidden);
    }
});

app.MapGet("/skills", (
    HttpRequest httpRequest,
    BridgeSessionStore sessions,
    LocalToolService localTools) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    return sessions.TryGet(token, origin, out _)
        ? Results.Ok(localTools.ListSkills())
        : Results.Unauthorized();
});

app.MapPost("/skills/open-folder", (
    HttpRequest httpRequest,
    BridgeSessionStore sessions,
    LocalToolService localTools,
    ISystemFolderLauncher folderLauncher) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        folderLauncher.Open(localTools.SkillsRoot);
        return Results.Ok(new { opened = true });
    }
    catch (Exception exception) when (
        exception is IOException or UnauthorizedAccessException or
        InvalidOperationException or PlatformNotSupportedException)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status500InternalServerError);
    }
});

app.MapPost("/skills/import", (
    HttpRequest httpRequest,
    ImportSkillRequest request,
    BridgeSessionStore sessions,
    LocalToolService localTools) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        return Results.Ok(localTools.ImportSkill(request));
    }
    catch (Exception exception) when (
        exception is ArgumentException or InvalidDataException or InvalidOperationException or IOException)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapDelete("/skills/{name}", (
    HttpRequest httpRequest,
    string name,
    BridgeSessionStore sessions,
    LocalToolService localTools) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        localTools.DeleteSkill(name);
        return Results.Ok(new { skillName = name, deleted = true });
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or LocalToolPolicyException)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status403Forbidden);
    }
});

app.MapPost("/documents/compare", async (
    HttpRequest httpRequest,
    DocumentCompareRequest request,
    BridgeSessionStore sessions,
    IDocumentComparer comparer,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }

    const int maxCombinedDocumentBytes = 20 * 1024 * 1024;
    const int maxCombinedBase64Characters = 28 * 1024 * 1024;
    if (string.IsNullOrWhiteSpace(request.OriginalBase64) ||
        string.IsNullOrWhiteSpace(request.RevisedBase64))
    {
        return Results.BadRequest(new { error = "original and revised DOCX payloads are required" });
    }
    if ((long)request.OriginalBase64.Length + request.RevisedBase64.Length > maxCombinedBase64Characters)
    {
        return Results.BadRequest(new { error = "combined DOCX payload exceeds the 20 MB comparison request limit" });
    }

    try
    {
        var original = Convert.FromBase64String(request.OriginalBase64);
        var revised = Convert.FromBase64String(request.RevisedBase64);
        if ((long)original.Length + revised.Length > maxCombinedDocumentBytes)
        {
            return Results.BadRequest(new { error = "combined DOCX payload exceeds the 20 MB comparison request limit" });
        }
        await using var originalStream = new MemoryStream(original, writable: false);
        await using var revisedStream = new MemoryStream(revised, writable: false);
        return Results.Ok(await comparer.CompareAsync(
            originalStream,
            revisedStream,
            request.IgnoreCase,
            cancellationToken));
    }
    catch (FormatException)
    {
        return Results.BadRequest(new { error = "document payload must be valid base64" });
    }
    catch (InvalidDataException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/mcp/servers", async (
    HttpRequest httpRequest,
    McpServerUpdate request,
    BridgeSessionStore sessions,
    LocalToolService localTools,
    McpManager mcpManager,
    McpSettingsStore mcpSettingsStore,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }
    if (string.Equals(request.Transport, "stdio", StringComparison.OrdinalIgnoreCase) &&
        !localTools.IsExecutableAllowed(request.Command))
    {
        return Results.Problem(
            $"MCP executable is not allowed: {Path.GetFileName(request.Command)}",
            statusCode: StatusCodes.Status403Forbidden);
    }
    if (!string.Equals(request.Transport, "stdio", StringComparison.OrdinalIgnoreCase) &&
        (!Uri.TryCreate(request.Command, UriKind.Absolute, out var mcpEndpoint) ||
         (mcpEndpoint.Scheme != Uri.UriSchemeHttps &&
          !(mcpEndpoint.Host is "127.0.0.1" or "localhost" or "::1"))))
    {
        return Results.BadRequest(new { error = "remote MCP endpoints must use HTTPS (or loopback HTTP)" });
    }

    try
    {
        mcpSettingsStore.Upsert(request, mcpManager);
        var connectionRequest = mcpSettingsStore.GetRequest(request.Name);
        var tools = await mcpManager.ConnectAsync(connectionRequest, cancellationToken);
        var server = mcpSettingsStore.GetViews(mcpManager).First(view =>
            string.Equals(view.Name, request.Name, StringComparison.OrdinalIgnoreCase));
        return Results.Ok(new
        {
            serverName = request.Name,
            toolCount = tools.Count,
            tools,
            server,
        });
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (Exception exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapGet("/mcp/servers", (
    HttpRequest httpRequest,
    BridgeSessionStore sessions,
    McpSettingsStore settings,
    McpManager manager) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    return sessions.TryGet(token, origin, out _)
        ? Results.Ok(settings.GetViews(manager))
        : Results.Unauthorized();
});

app.MapPost("/mcp/servers/import", async (
    HttpRequest httpRequest,
    McpImportRequest request,
    BridgeSessionStore sessions,
    LocalToolService localTools,
    McpSettingsStore settings,
    McpManager manager,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        var imported = settings.ImportJson(request.Json, manager);
        var connected = 0;
        var errors = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in imported.Names)
        {
            var view = settings.GetViews(manager).First(server =>
                string.Equals(server.Name, name, StringComparison.OrdinalIgnoreCase));
            if (!view.Enabled) continue;
            try
            {
                var connection = settings.GetRequest(name);
                if (string.Equals(connection.Transport, "stdio", StringComparison.OrdinalIgnoreCase) &&
                    !localTools.IsExecutableAllowed(connection.Command))
                {
                    errors[name] = $"MCP executable is not allowed: {Path.GetFileName(connection.Command)}";
                    continue;
                }
                await manager.ConnectAsync(connection, cancellationToken);
                connected++;
            }
            catch (Exception exception)
            {
                errors[name] = manager.GetServerStates().FirstOrDefault(state =>
                    string.Equals(state.Name, name, StringComparison.OrdinalIgnoreCase))?.LastError
                    ?? exception.GetType().Name;
            }
        }
        return Results.Ok(new
        {
            imported.Total,
            imported.Added,
            imported.Updated,
            connected,
            errors,
            servers = settings.GetViews(manager),
        });
    }
    catch (Exception exception) when (exception is JsonException or ArgumentException)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/mcp/servers/{name}/connect", async (
    HttpRequest httpRequest,
    string name,
    BridgeSessionStore sessions,
    LocalToolService localTools,
    McpSettingsStore settings,
    McpManager manager,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        var request = settings.GetRequest(name);
        if (string.Equals(request.Transport, "stdio", StringComparison.OrdinalIgnoreCase) &&
            !localTools.IsExecutableAllowed(request.Command))
        {
            return Results.Problem(
                $"MCP executable is not allowed: {Path.GetFileName(request.Command)}",
                statusCode: StatusCodes.Status403Forbidden);
        }
        var tools = await manager.ConnectAsync(request, cancellationToken);
        return Results.Ok(new { serverName = name, toolCount = tools.Count, tools });
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
    catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or HttpRequestException)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/mcp/servers/{name}/disconnect", async (
    HttpRequest httpRequest,
    string name,
    BridgeSessionStore sessions,
    McpManager manager) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    return Results.Ok(new { serverName = name, disconnected = await manager.DisconnectAsync(name) });
});

app.MapDelete("/mcp/servers/{name}", async (
    HttpRequest httpRequest,
    string name,
    BridgeSessionStore sessions,
    McpSettingsStore settings,
    McpManager manager) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        await manager.RemoveAsync(name);
        settings.Delete(name);
        return Results.Ok(new { serverName = name, deleted = true });
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
});

app.MapPut("/mcp/servers/{name}/permissions", (
    HttpRequest httpRequest,
    string name,
    Dictionary<string, bool> permissions,
    BridgeSessionStore sessions,
    McpSettingsStore settings) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        settings.SetToolPermissions(name, permissions);
        return Results.Ok(new { serverName = name, permissions });
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
});

app.MapGet("/mcp/servers/{name}/tools", async (
    HttpRequest httpRequest,
    string name,
    BridgeSessionStore sessions,
    McpManager mcpManager,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }

    try
    {
        return Results.Ok(await mcpManager.ListToolsAsync(name, cancellationToken));
    }
    catch (InvalidOperationException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
});

app.MapPost("/mcp/servers/{name}/health", async (
    HttpRequest httpRequest,
    string name,
    BridgeSessionStore sessions,
    McpManager mcpManager,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _)) return Results.Unauthorized();
    try
    {
        return Results.Ok(await mcpManager.CheckHealthAsync(name, cancellationToken));
    }
    catch (InvalidOperationException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
    catch (Exception exception) when (exception is HttpRequestException or IOException)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/mcp/tools/call", async (
    HttpRequest httpRequest,
    McpToolCallRequest request,
    BridgeSessionStore sessions,
    McpManager mcpManager,
    McpSettingsStore mcpSettingsStore,
    CancellationToken cancellationToken) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }
    if (!mcpSettingsStore.IsToolAllowed(request.ServerName, request.ToolName))
    {
        return Results.Problem(
            $"MCP tool is not authorized: mcp__{request.ServerName}__{request.ToolName}",
            statusCode: StatusCodes.Status403Forbidden);
    }

    try
    {
        return Results.Ok(new
        {
            serverName = request.ServerName,
            toolName = request.ToolName,
            result = await mcpManager.CallToolAsync(request, cancellationToken),
        });
    }
    catch (InvalidOperationException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
});

app.MapPost("/agent/sessions", (
    HttpRequest httpRequest,
    AgentStartRequest request,
    BridgeSessionStore sessions,
    LocalToolService localTools,
    IEnumerable<IInternalToolExecutor> internalTools,
    AgentSessionManager agentSessions) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _))
    {
        return Results.Unauthorized();
    }

    var tools = (request.Tools ?? sessions.GetOfficeTools(token!))
        .Concat(internalTools.SelectMany(tool => tool.GetToolDescriptors()))
        .ToArray();
    var session = agentSessions.Create(
        providerSettings.ApplyDefaults(request with
        {
            Tools = tools,
            WritingProfile = reviewSettings.Get().WritingProfile,
        }),
        origin!);
    return Results.Ok(new AgentStartResponse(session.Id, session.Status));
});

app.MapPost("/agent/sessions/{id}/plan-confirmation", (
    HttpRequest httpRequest,
    string id,
    AgentPlanConfirmationRequest request,
    AgentSessionManager agentSessions,
    BridgeSessionStore sessions) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _) || string.IsNullOrWhiteSpace(origin))
    {
        return Results.Unauthorized();
    }

    return agentSessions.ConfirmPlan(id, origin, request)
        ? Results.Ok(new { accepted = true })
        : Results.NotFound(new { error = "plan_confirmation_not_pending" });
});

app.MapGet("/agent/sessions/{id}/events", async (
    HttpContext httpContext,
    string id,
    AgentSessionManager agentSessions,
    BridgeSessionStore sessions,
    CancellationToken cancellationToken) =>
{
    var token = httpContext.Request.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpContext.Request.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _) ||
        !agentSessions.TryGet(id, origin!, out var session))
    {
        httpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    httpContext.Response.ContentType = "application/x-ndjson";
    httpContext.Response.Headers.CacheControl = "no-cache";
    await foreach (var runtimeEvent in session.ReadEventsAsync(cancellationToken))
    {
        await httpContext.Response.WriteAsync(
            JsonSerializer.Serialize(runtimeEvent, eventJsonOptions) + "\n",
            cancellationToken);
        await httpContext.Response.Body.FlushAsync(cancellationToken);
    }
});

app.MapPost("/agent/sessions/{id}/tool-results", (
    HttpRequest httpRequest,
    string id,
    AgentToolResultRequest result,
    AgentSessionManager agentSessions,
    BridgeSessionStore sessions) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _) ||
        !agentSessions.TryGet(id, origin!, out var session))
    {
        return Results.Unauthorized();
    }

    return session.SubmitToolResult(result)
        ? Results.Ok(new { accepted = true })
        : Results.NotFound(new { error = "tool_call_not_pending" });
});

app.MapPost("/agent/sessions/{id}/permissions", (
    HttpRequest httpRequest,
    string id,
    AgentPermissionRequest request,
    AgentSessionManager agentSessions,
    BridgeSessionStore sessions) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _) || string.IsNullOrWhiteSpace(origin))
    {
        return Results.Unauthorized();
    }

    return agentSessions.SubmitPermission(id, origin, request)
        ? Results.Ok(new { accepted = true })
        : Results.NotFound(new { error = "permission_not_pending" });
});

app.MapGet("/agent/sessions/{id}/checkpoint", (
    HttpRequest httpRequest,
    string id,
    AgentSessionManager agentSessions,
    BridgeSessionStore sessions) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _) || string.IsNullOrWhiteSpace(origin))
    {
        return Results.Unauthorized();
    }
    return agentSessions.TryGetCheckpoint(id, origin, out var checkpoint)
        ? Results.Ok(checkpoint)
        : Results.NotFound(new { error = "checkpoint_not_available" });
});

app.MapGet("/agent/recoveries", (
    HttpRequest httpRequest,
    AgentSessionManager agentSessions,
    BridgeSessionStore sessions) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _) || string.IsNullOrWhiteSpace(origin))
    {
        return Results.Unauthorized();
    }
    return Results.Ok(agentSessions.ListRecoveries(origin));
});

app.MapPost("/agent/sessions/{id}/cancel", (
    HttpRequest httpRequest,
    string id,
    AgentSessionManager agentSessions,
    BridgeSessionStore sessions) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    var origin = httpRequest.Headers["Origin"].FirstOrDefault();
    if (!sessions.TryGet(token, origin, out _) ||
        !agentSessions.TryGet(id, origin!, out _))
    {
        return Results.Unauthorized();
    }

    agentSessions.Remove(id);
    return Results.Ok(new { cancelled = true });
});

app.MapGet("/events", (HttpRequest httpRequest, BridgeSessionStore sessions) =>
{
    var token = httpRequest.Headers[BridgeProtocol.SessionHeader].FirstOrDefault();
    return sessions.TryGet(token, httpRequest.Headers.Origin, out _)
        ? Results.Problem(
            "The legacy event stream has been replaced by /agent/sessions/{id}/events.",
            statusCode: StatusCodes.Status410Gone)
        : Results.Unauthorized();
});

app.Lifetime.ApplicationStarted.Register(() =>
{
    _ = Task.Run(async () =>
    {
        var manager = app.Services.GetRequiredService<McpManager>();
        var settings = app.Services.GetRequiredService<McpSettingsStore>();
        var localTools = app.Services.GetRequiredService<LocalToolService>();
        foreach (var configured in settings.GetEnabledSettings())
        {
            try
            {
                var request = settings.GetRequest(configured.Name);
                if (string.Equals(request.Transport, "stdio", StringComparison.OrdinalIgnoreCase) &&
                    !localTools.IsExecutableAllowed(request.Command))
                {
                    Console.Error.WriteLine($"Skipped disallowed MCP executable: {Path.GetFileName(request.Command)}");
                    continue;
                }
                await manager.ConnectAsync(request);
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine($"MCP auto-connect failed for {configured.Name}: {exception.Message}");
            }
        }
    });
});

static OllamaModelManager CreateActiveOllamaManager(
    ProviderSettingsStore settings,
    string? uiLocale)
{
    var profile = settings.GetActiveProfile();
    if (profile is null)
    {
        throw new NoActiveModelException();
    }
    if (!string.Equals(profile.Type, "Ollama", StringComparison.OrdinalIgnoreCase))
    {
        throw new ArgumentException(UiText.Get(uiLocale, "OllamaProviderRequired"));
    }
    return new OllamaModelManager(profile.Endpoint);
}

try
{
    app.Run();
}
finally
{
    instanceMutex.ReleaseMutex();
}

public sealed class BridgeSessionStore
{
    public const string CookieName = "WordOllama.Session";
    private readonly string _pairingCode;
    private readonly string[] _allowedOrigins;
    private readonly Dictionary<string, Session> _sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, IReadOnlyList<OfficeToolDescriptor>> _officeTools = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public BridgeSessionStore(IConfiguration configuration, IWebHostEnvironment environment)
    {
        _pairingCode = configuration["Bridge:PairingCode"]
            ?? CreatePairingCode();
        _allowedOrigins = configuration.GetSection("Bridge:AllowedOrigins")
            .Get<string[]>()
            ?? ["https://localhost:3000", "https://localhost:5173"];

        if (environment.IsDevelopment())
        {
            Console.WriteLine($"WordOllama Bridge development pairing code: {_pairingCode}");
        }
    }

    public bool IsPairingCodeValid(string code) =>
        CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(code),
            Encoding.UTF8.GetBytes(_pairingCode));

    public bool IsOriginAllowed(string? origin) =>
        !string.IsNullOrWhiteSpace(origin) && _allowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase);

    public Session Create(string origin)
    {
        var session = new Session(
            Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            origin,
            DateTimeOffset.UtcNow.AddHours(8));

        lock (_gate)
        {
            _sessions[session.Token] = session;
        }

        return session;
    }

    public bool TryGet(string? token, string? origin, out Session session)
    {
        lock (_gate)
        {
            if (token is not null &&
                _sessions.TryGetValue(token, out session!) &&
                session.ExpiresAt > DateTimeOffset.UtcNow &&
                string.Equals(session.Origin, origin, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        session = null!;
        return false;
    }

    public void RegisterOfficeTools(string token, IReadOnlyList<OfficeToolDescriptor> tools)
    {
        lock (_gate)
        {
            _officeTools[token] = tools;
        }
    }

    public IReadOnlyList<OfficeToolDescriptor> GetOfficeTools(string token)
    {
        lock (_gate)
        {
            return _officeTools.TryGetValue(token, out var tools)
                ? tools
                : Array.Empty<OfficeToolDescriptor>();
        }
    }

    private static string CreatePairingCode() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(4));

    public sealed record Session(string Token, string CsrfToken, string Origin, DateTimeOffset ExpiresAt)
    {
        public bool IsCsrfValid(string? value) =>
            !string.IsNullOrWhiteSpace(value) &&
            CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(CsrfToken),
                Encoding.UTF8.GetBytes(value));
    }
}
