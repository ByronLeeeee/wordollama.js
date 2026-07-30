using System.Text.Json;
using System.Text.RegularExpressions;
using WordOllama.Contracts;

namespace WordOllama.DesktopBridge;

public sealed class LegalArticleService : IDisposable
{
    private const string ApiBase = "https://lawapi.lslby.com/api/v1/article";
    private readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(30),
    };

    public async Task<LawArticleResult?> SearchAsync(
        string lawName,
        string article,
        CancellationToken cancellationToken = default)
    {
        lawName = (lawName ?? string.Empty).Trim();
        article = (article ?? string.Empty).Trim();
        if (lawName.Length is < 1 or > 100 || article.Length is < 1 or > 40)
        {
            throw new ArgumentException("Law name or article number is empty or too long.");
        }

        var normalizedArticle = FormatArticleNumber(article);
        var url = $"{ApiBase}?law={Uri.EscapeDataString(lawName)}&article={Uri.EscapeDataString(normalizedArticle)}";
        using var response = await _httpClient.GetAsync(url, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Legal article service returned {(int)response.StatusCode}.",
                null,
                response.StatusCode);
        }

        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;
        if (root.TryGetProperty("error", out var error) &&
            error.ValueKind != JsonValueKind.Null &&
            !string.IsNullOrWhiteSpace(error.ToString()))
        {
            throw new InvalidOperationException(error.ToString());
        }
        if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
        {
            return null;
        }
        return new LawArticleResult(
            ReadString(data, "law_name") ?? ReadString(root, "law_name") ?? lawName,
            ReadString(data, "article_number") ?? normalizedArticle,
            ReadString(data, "content") ?? string.Empty,
            ReadString(data, "category") ?? string.Empty);
    }

    public static string FormatArticleNumber(string input)
    {
        input = (input ?? string.Empty).Trim();
        var match = Regex.Match(input, @"\d+");
        if (match.Success && int.TryParse(match.Value, out var number) && number is >= 0 and <= 9999)
        {
            return "第" + NumberToChinese(number) + "条";
        }
        if (!input.StartsWith('第')) input = "第" + input;
        if (!input.EndsWith('条')) input += "条";
        return input;
    }

    private static string NumberToChinese(int number)
    {
        if (number == 0) return "零";
        string[] digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
        string[] units = ["", "十", "百", "千"];
        var text = number.ToString();
        var result = "";
        for (var index = 0; index < text.Length; index++)
        {
            var value = text[index] - '0';
            var unit = text.Length - 1 - index;
            if (value != 0)
            {
                result += value == 1 && unit == 1 && text.Length == 2
                    ? units[unit]
                    : digits[value] + units[unit];
            }
            else if (index < text.Length - 1 && text[index + 1] != '0')
            {
                result += digits[0];
            }
        }
        return result;
    }

    private static string? ReadString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    public void Dispose() => _httpClient.Dispose();
}
