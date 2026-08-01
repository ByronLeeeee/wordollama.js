using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using WordOllama.Contracts;

namespace WordOllama.Core;

public static class SafeWebFetcher
{
    private const int MaximumRedirects = 5;
    private const int MaximumBytes = 1_048_576;
    private const int MaximumTextCharacters = 120_000;
    private static readonly Regex HiddenHtml = new("<(script|style|noscript)[^>]*>[\\s\\S]*?</\\1>", RegexOptions.IgnoreCase | RegexOptions.Compiled, TimeSpan.FromSeconds(1));
    private static readonly Regex HtmlTags = new("<[^>]+>", RegexOptions.Compiled, TimeSpan.FromSeconds(1));
    private static readonly Regex Whitespace = new("[ \\t\\f\\v]+", RegexOptions.Compiled, TimeSpan.FromSeconds(1));
    private static readonly HashSet<string> AllowedMediaTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "text/html", "text/plain", "text/markdown", "text/xml",
        "application/json", "application/xml", "application/xhtml+xml",
    };

    public static async Task<FetchUrlToolResponse> FetchAsync(
        FetchUrlToolRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var current))
        {
            throw new LocalToolPolicyException("fetch_url requires an absolute URL.");
        }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(request.TimeoutSeconds, 1, 60)));

        for (var redirect = 0; redirect <= MaximumRedirects; redirect++)
        {
            ValidateUri(current);
            var addresses = await ResolvePublicAddressesAsync(current, timeout.Token);
            using var handler = CreatePinnedHandler(addresses);
            using var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
            using var message = new HttpRequestMessage(HttpMethod.Get, current);
            message.Headers.Accept.ParseAdd("text/html, text/plain, text/markdown, application/json, application/xml;q=0.9");
            message.Headers.UserAgent.ParseAdd("WordOllama.JS/1.0 safe-fetch");
            using var response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeout.Token);

            if (IsRedirect(response.StatusCode))
            {
                if (redirect == MaximumRedirects || response.Headers.Location is null)
                {
                    throw new LocalToolPolicyException("fetch_url exceeded the redirect limit.");
                }
                current = response.Headers.Location.IsAbsoluteUri
                    ? response.Headers.Location
                    : new Uri(current, response.Headers.Location);
                continue;
            }

            var mediaType = response.Content.Headers.ContentType?.MediaType ?? "application/octet-stream";
            if (!AllowedMediaTypes.Contains(mediaType))
            {
                throw new LocalToolPolicyException($"fetch_url rejected MIME type '{mediaType}'.");
            }
            if (response.Content.Headers.ContentLength is > MaximumBytes)
            {
                throw new LocalToolPolicyException("fetch_url response is larger than 1 MiB.");
            }

            var bytes = await ReadLimitedAsync(await response.Content.ReadAsStreamAsync(timeout.Token), timeout.Token);
            var charset = response.Content.Headers.ContentType?.CharSet;
            Encoding encoding;
            try { encoding = string.IsNullOrWhiteSpace(charset) ? Encoding.UTF8 : Encoding.GetEncoding(charset); }
            catch (ArgumentException) { encoding = Encoding.UTF8; }
            var raw = encoding.GetString(bytes);
            var title = mediaType.Contains("html", StringComparison.OrdinalIgnoreCase)
                ? ExtractTitle(raw)
                : string.Empty;
            var text = mediaType.Contains("html", StringComparison.OrdinalIgnoreCase)
                ? ExtractHtmlText(raw)
                : raw;
            if (text.Length > MaximumTextCharacters) text = text[..MaximumTextCharacters];
            return new FetchUrlToolResponse(
                current.ToString(),
                (int)response.StatusCode,
                mediaType,
                title,
                text,
                bytes.Length,
                DateTimeOffset.UtcNow);
        }
        throw new LocalToolPolicyException("fetch_url could not complete the request.");
    }

    private static void ValidateUri(Uri uri)
    {
        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrWhiteSpace(uri.Host) ||
            !string.IsNullOrWhiteSpace(uri.UserInfo) ||
            uri.Port is < 1 or > 65535)
        {
            throw new LocalToolPolicyException("fetch_url only permits credential-free absolute HTTPS URLs.");
        }
    }

    private static async Task<IPAddress[]> ResolvePublicAddressesAsync(Uri uri, CancellationToken cancellationToken)
    {
        IPAddress[] addresses;
        if (IPAddress.TryParse(uri.DnsSafeHost, out var literal)) addresses = [literal];
        else addresses = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, cancellationToken);
        if (addresses.Length == 0 || addresses.Any(IsPrivateOrSpecial))
        {
            throw new LocalToolPolicyException("fetch_url blocks loopback, private, link-local and special network addresses.");
        }
        return addresses;
    }

    private static SocketsHttpHandler CreatePinnedHandler(IReadOnlyList<IPAddress> addresses) => new()
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli,
        ConnectCallback = async (context, cancellationToken) =>
        {
            Exception? last = null;
            foreach (var address in addresses)
            {
                var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
                try
                {
                    await socket.ConnectAsync(address, context.DnsEndPoint.Port, cancellationToken);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch (Exception exception) when (exception is SocketException or OperationCanceledException)
                {
                    socket.Dispose();
                    last = exception;
                }
            }
            throw last ?? new SocketException((int)SocketError.HostUnreachable);
        },
    };

    private static bool IsPrivateOrSpecial(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any) ||
            address.Equals(IPAddress.None) || address.Equals(IPAddress.IPv6None) || address.IsIPv6Multicast ||
            address.IsIPv6LinkLocal || address.IsIPv6SiteLocal)
        {
            return true;
        }
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return bytes[0] is 0 or 10 or 127 ||
                   bytes[0] == 169 && bytes[1] == 254 ||
                   bytes[0] == 172 && bytes[1] is >= 16 and <= 31 ||
                   bytes[0] == 192 && bytes[1] == 168 ||
                   bytes[0] >= 224;
        }
        return (bytes[0] & 0xfe) == 0xfc || bytes.All(value => value == 0);
    }

    private static bool IsRedirect(HttpStatusCode status) => (int)status is 301 or 302 or 303 or 307 or 308;

    private static async Task<byte[]> ReadLimitedAsync(Stream stream, CancellationToken cancellationToken)
    {
        using var output = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read == 0) return output.ToArray();
            if (output.Length + read > MaximumBytes) throw new LocalToolPolicyException("fetch_url response is larger than 1 MiB.");
            output.Write(buffer, 0, read);
        }
    }

    private static string ExtractTitle(string html)
    {
        var match = Regex.Match(html, "<title[^>]*>(?<title>[\\s\\S]*?)</title>", RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1));
        return match.Success ? CleanText(match.Groups["title"].Value).Trim() : string.Empty;
    }

    private static string ExtractHtmlText(string html) => CleanText(HtmlTags.Replace(HiddenHtml.Replace(html, " "), "\n"));

    private static string CleanText(string value) =>
        Regex.Replace(Whitespace.Replace(WebUtility.HtmlDecode(value), " "), "(?:\\r?\\n\\s*){3,}", "\n\n").Trim();
}
