using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using WordOllama.Contracts;
using WordOllama.Core;

namespace WordOllama.DesktopBridge;

public sealed record GoogleOAuthRequest(
    string? ClientId,
    string? ClientSecret,
    string? QuotaProject,
    string UiLocale = "en-US");

public sealed record GoogleOAuthResult(
    GoogleOAuthCredential Credential,
    bool HasRefreshToken);

public sealed partial class GoogleOAuthService
{
    private const string AuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    private const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    private const string Scope =
        "https://www.googleapis.com/auth/cloud-platform " +
        "https://www.googleapis.com/auth/generative-language.retriever";
    private readonly HttpClient _httpClient;
    private readonly Action<string> _openBrowser;

    public GoogleOAuthService(
        HttpClient? httpClient = null,
        Action<string>? openBrowser = null)
    {
        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        _openBrowser = openBrowser ?? OpenSystemBrowser;
    }

    public async Task<GoogleOAuthResult> AuthorizeAsync(
        GoogleOAuthRequest request,
        CancellationToken cancellationToken = default)
    {
        var clientId = request.ClientId?.Trim() ?? string.Empty;
        var clientSecret = request.ClientSecret?.Trim() ?? string.Empty;
        var quotaProject = request.QuotaProject?.Trim() ?? string.Empty;
        var uiLocale = UiText.NormalizeLocale(request.UiLocale);
        if (clientId.Length is < 3 or > 512)
        {
            throw new ArgumentException(UiText.Get(uiLocale, "OAuthClientIdInvalid"));
        }
        if (clientSecret.Length > 1024)
        {
            throw new ArgumentException(UiText.Get(uiLocale, "OAuthClientSecretTooLong"));
        }
        if (quotaProject.Length > 128 ||
            (quotaProject.Length > 0 && !ProjectIdPattern().IsMatch(quotaProject)))
        {
            throw new ArgumentException(UiText.Get(uiLocale, "OAuthProjectInvalid"));
        }

        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var redirectUri = $"http://127.0.0.1:{port}/callback/";
        var state = Base64Url(RandomNumberGenerator.GetBytes(32));
        var verifier = Base64Url(RandomNumberGenerator.GetBytes(64));
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var authorizationUrl = BuildAuthorizationUrl(
            clientId,
            redirectUri,
            state,
            challenge);

        try
        {
            _openBrowser(authorizationUrl);
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException(
                UiText.Get(uiLocale, "OAuthBrowserOpenFailed"),
                exception);
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(3));
        IReadOnlyDictionary<string, string> callback;
        try
        {
            callback = await ReceiveCallbackAsync(listener, state, uiLocale, timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException(UiText.Get(uiLocale, "OAuthTimeout"));
        }

        callback.TryGetValue("state", out var callbackState);
        callback.TryGetValue("code", out var code);
        callback.TryGetValue("error", out var callbackError);
        var validState = CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(state),
            Encoding.UTF8.GetBytes(callbackState ?? string.Empty));
        var success = validState &&
                      string.IsNullOrWhiteSpace(callbackError) &&
                      !string.IsNullOrWhiteSpace(code);
        if (!validState)
        {
            throw new InvalidOperationException(UiText.Get(uiLocale, "OAuthStateMismatch"));
        }
        if (!string.IsNullOrWhiteSpace(callbackError))
        {
            throw new InvalidOperationException(
                UiText.Format(uiLocale, "OAuthNotCompleted", callbackError));
        }
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new InvalidOperationException(UiText.Get(uiLocale, "OAuthCodeMissing"));
        }

        var fields = new List<KeyValuePair<string, string>>
        {
            new("code", code),
            new("client_id", clientId),
            new("redirect_uri", redirectUri),
            new("grant_type", "authorization_code"),
            new("code_verifier", verifier),
        };
        if (!string.IsNullOrWhiteSpace(clientSecret))
        {
            fields.Add(new("client_secret", clientSecret));
        }

        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, TokenEndpoint)
        {
            Content = new FormUrlEncodedContent(fields),
        };
        using var tokenResponse = await _httpClient.SendAsync(tokenRequest, timeout.Token);
        var tokenBody = await tokenResponse.Content.ReadAsStringAsync(timeout.Token);
        if (!tokenResponse.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                UiText.Format(
                    uiLocale,
                    "OAuthTokenExchangeFailed",
                    (int)tokenResponse.StatusCode,
                    Truncate(tokenBody)),
                null,
                tokenResponse.StatusCode);
        }

        using var tokenDocument = JsonDocument.Parse(tokenBody);
        var accessToken = tokenDocument.RootElement.GetProperty("access_token").GetString()
            ?? throw new JsonException(UiText.Get(uiLocale, "OAuthAccessTokenMissing"));
        var refreshToken = tokenDocument.RootElement.TryGetProperty("refresh_token", out var refreshValue)
            ? refreshValue.GetString() ?? string.Empty
            : string.Empty;
        var expiresIn = tokenDocument.RootElement.TryGetProperty("expires_in", out var expiresValue) &&
                        expiresValue.TryGetInt32(out var parsedExpires)
            ? parsedExpires
            : 3600;
        var credential = new GoogleOAuthCredential(
            clientId,
            clientSecret,
            refreshToken,
            accessToken,
            DateTimeOffset.UtcNow.AddSeconds(Math.Max(60, expiresIn)),
            quotaProject);
        return new GoogleOAuthResult(credential, !string.IsNullOrWhiteSpace(refreshToken));
    }

    private static string BuildAuthorizationUrl(
        string clientId,
        string redirectUri,
        string state,
        string challenge)
    {
        var parameters = new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["redirect_uri"] = redirectUri,
            ["response_type"] = "code",
            ["scope"] = Scope,
            ["state"] = state,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
            ["access_type"] = "offline",
            ["prompt"] = "consent",
        };
        return AuthorizationEndpoint + "?" + string.Join(
            "&",
            parameters.Select(pair =>
                $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));
    }

    private static async Task<IReadOnlyDictionary<string, string>> ReceiveCallbackAsync(
        TcpListener listener,
        string expectedState,
        string uiLocale,
        CancellationToken cancellationToken)
    {
        using var client = await listener.AcceptTcpClientAsync(cancellationToken);
        if (client.Client.RemoteEndPoint is not IPEndPoint remote || !IPAddress.IsLoopback(remote.Address))
        {
            throw new InvalidOperationException(
                UiText.Get(uiLocale, "OAuthCallbackNotLoopback"));
        }
        await using var stream = client.GetStream();
        using var reader = new StreamReader(
            stream,
            Encoding.ASCII,
            detectEncodingFromByteOrderMarks: false,
            bufferSize: 4096,
            leaveOpen: true);
        var requestLine = await reader.ReadLineAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(requestLine) || requestLine.Length > 4096)
        {
            throw new InvalidOperationException(
                UiText.Get(uiLocale, "OAuthRequestLineInvalid"));
        }
        var requestParts = requestLine.Split(' ', 3);
        if (requestParts.Length != 3 ||
            requestParts[0] != "GET" ||
            !Uri.TryCreate("http://127.0.0.1" + requestParts[1], UriKind.Absolute, out var callbackUri) ||
            callbackUri.AbsolutePath != "/callback/")
        {
            throw new InvalidOperationException(UiText.Get(uiLocale, "OAuthRequestInvalid"));
        }
        for (var index = 0; index < 100; index++)
        {
            var header = await reader.ReadLineAsync(cancellationToken);
            if (header is null || header.Length > 8192)
            {
                throw new InvalidOperationException(UiText.Get(uiLocale, "OAuthHeadersInvalid"));
            }
            if (header.Length == 0) break;
            if (index == 99)
            {
                throw new InvalidOperationException(UiText.Get(uiLocale, "OAuthTooManyHeaders"));
            }
        }

        var query = ParseQuery(callbackUri.Query);
        query.TryGetValue("state", out var state);
        query.TryGetValue("code", out var code);
        query.TryGetValue("error", out var error);
        var validState = CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expectedState),
            Encoding.UTF8.GetBytes(state ?? string.Empty));
        var success = validState &&
                      !string.IsNullOrWhiteSpace(code) &&
                      string.IsNullOrWhiteSpace(error);
        var successText = UiText.Get(uiLocale, "OAuthComplete");
        var failureText = UiText.Get(uiLocale, "OAuthIncomplete");
        var text = success ? successText : failureText;
        var html = $"<!doctype html><html lang=\"{uiLocale}\"><meta charset=\"utf-8\"><title>WordOllama OAuth</title><body><h2>{text}</h2></body></html>";
        var body = Encoding.UTF8.GetBytes(html);
        var status = success ? "200 OK" : "400 Bad Request";
        var headers = Encoding.ASCII.GetBytes(
            $"HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {body.Length}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n");
        await stream.WriteAsync(headers, cancellationToken);
        await stream.WriteAsync(body, cancellationToken);
        await stream.FlushAsync(cancellationToken);
        return query;
    }

    private static void OpenSystemBrowser(string url)
    {
        _ = Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true,
        }) ?? throw new InvalidOperationException("Unable to open the system browser for Google OAuth.");
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static Dictionary<string, string> ParseQuery(string query) =>
        query.TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .ToDictionary(
                part => Uri.UnescapeDataString(part[0].Replace("+", " ", StringComparison.Ordinal)),
                part => Uri.UnescapeDataString(
                    (part.Length > 1 ? part[1] : string.Empty).Replace("+", " ", StringComparison.Ordinal)),
                StringComparer.Ordinal);

    private static string Truncate(string value) =>
        value.Length <= 500 ? value : value[..500] + "...";

    [GeneratedRegex("^[a-z][a-z0-9-]{4,61}[a-z0-9]$", RegexOptions.CultureInvariant)]
    private static partial Regex ProjectIdPattern();
}
