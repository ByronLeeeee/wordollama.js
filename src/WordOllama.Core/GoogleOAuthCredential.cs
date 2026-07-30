using System.Text;
using System.Text.Json;

namespace WordOllama.Core;

public sealed record GoogleOAuthCredential(
    string ClientId,
    string ClientSecret,
    string RefreshToken,
    string AccessToken,
    DateTimeOffset ExpiresAt,
    string QuotaProject);

public static class GoogleOAuthCredentialCodec
{
    private const string Prefix = "wordollama-oauth-google-v1:";

    public static string Encode(GoogleOAuthCredential credential)
    {
        ArgumentNullException.ThrowIfNull(credential);
        var json = JsonSerializer.Serialize(credential, JsonOptions);
        return Prefix + Base64UrlEncode(Encoding.UTF8.GetBytes(json));
    }

    public static bool TryDecode(string? value, out GoogleOAuthCredential? credential)
    {
        credential = null;
        if (string.IsNullOrWhiteSpace(value) ||
            !value.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return false;
        }

        try
        {
            var json = Encoding.UTF8.GetString(Base64UrlDecode(value[Prefix.Length..]));
            var parsed = JsonSerializer.Deserialize<GoogleOAuthCredential>(json, JsonOptions);
            if (parsed is null ||
                string.IsNullOrWhiteSpace(parsed.ClientId) ||
                (string.IsNullOrWhiteSpace(parsed.RefreshToken) &&
                 string.IsNullOrWhiteSpace(parsed.AccessToken)))
            {
                return false;
            }
            credential = parsed;
            return true;
        }
        catch (Exception exception) when (
            exception is FormatException or JsonException or ArgumentException)
        {
            return false;
        }
    }

    public static bool IsEncodedCredential(string? value) =>
        TryDecode(value, out _);

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded += new string('=', (4 - padded.Length % 4) % 4);
        return Convert.FromBase64String(padded);
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}
