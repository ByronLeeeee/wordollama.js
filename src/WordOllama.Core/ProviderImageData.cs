namespace WordOllama.Core;

internal sealed record ProviderImageData(string MediaType, string Base64Data);

internal static class ProviderImageDataParser
{
    private const int MaxBase64Length = 12_000_000;
    private static readonly HashSet<string> AllowedMediaTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
    };

    public static ProviderImageData? Parse(string? dataUrl)
    {
        if (string.IsNullOrWhiteSpace(dataUrl))
        {
            return null;
        }

        var separator = dataUrl.IndexOf(',');
        if (separator <= 5 || !dataUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Image must be a base64 data URL.");
        }

        var metadata = dataUrl[5..separator];
        var segments = metadata.Split(';', StringSplitOptions.RemoveEmptyEntries);
        var mediaType = segments.FirstOrDefault() ?? string.Empty;
        if (!AllowedMediaTypes.Contains(mediaType) ||
            !segments.Skip(1).Any(segment => string.Equals(segment, "base64", StringComparison.OrdinalIgnoreCase)))
        {
            throw new ArgumentException("Only base64 PNG, JPEG, WebP, or GIF images are supported.");
        }

        var data = dataUrl[(separator + 1)..];
        if (data.Length == 0 || data.Length > MaxBase64Length)
        {
            throw new ArgumentException("Image payload is empty or exceeds the size limit.");
        }
        try
        {
            Convert.FromBase64String(data);
        }
        catch (FormatException exception)
        {
            throw new ArgumentException("Image payload is not valid base64.", exception);
        }
        return new ProviderImageData(mediaType.ToLowerInvariant(), data);
    }
}
