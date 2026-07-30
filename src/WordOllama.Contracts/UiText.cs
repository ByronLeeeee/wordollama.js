using System.Globalization;
using System.Resources;

namespace WordOllama.Contracts;

public static class UiText
{
    private static readonly ResourceManager Resources = new(
        "WordOllama.Contracts.Resources.BridgeMessages",
        typeof(UiText).Assembly);

    public static string NormalizeLocale(string? value) =>
        value?.Trim().StartsWith("zh", StringComparison.OrdinalIgnoreCase) == true
            ? "zh-CN"
            : "en-US";

    public static string Get(string? locale, string key)
    {
        var culture = CultureInfo.GetCultureInfo(NormalizeLocale(locale));
        return Resources.GetString(key, culture)
            ?? Resources.GetString(key, CultureInfo.GetCultureInfo("en-US"))
            ?? key;
    }

    public static string Format(string? locale, string key, params object?[] arguments)
    {
        var culture = CultureInfo.GetCultureInfo(NormalizeLocale(locale));
        return string.Format(culture, Get(locale, key), arguments);
    }
}
