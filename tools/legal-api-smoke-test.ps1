param(
    [string]$LawName,
    [string]$Article,
    [string]$ApiBase = 'https://lawapi.lslby.com'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($LawName)) {
    $LawName = [Uri]::UnescapeDataString('%E4%B8%AD%E5%8D%8E%E4%BA%BA%E6%B0%91%E5%85%B1%E5%92%8C%E5%9B%BD%E6%B0%91%E6%B3%95%E5%85%B8')
}
if ([string]::IsNullOrWhiteSpace($Article)) {
    $Article = [Uri]::UnescapeDataString('%E7%AC%AC%E4%B8%80%E6%9D%A1')
}

$uri = '{0}/api/v1/article?law={1}&article={2}' -f `
    $ApiBase.TrimEnd('/'),
    [Uri]::EscapeDataString($LawName),
    [Uri]::EscapeDataString($Article)

try {
    $response = Invoke-WebRequest -Uri $uri -UseBasicParsing
} catch {
    throw "Legal API request failed: $($_.Exception.Message)"
}

if ($response.StatusCode -ne 200) {
    throw "Legal API returned HTTP $($response.StatusCode)."
}

try {
    $payload = $response.Content | ConvertFrom-Json
} catch {
    throw 'Legal API returned invalid JSON.'
}

if ($payload.code -ne 200 -or [string]::IsNullOrWhiteSpace([string]$payload.law_name)) {
    throw 'Legal API response is missing a successful code or law_name.'
}

if ($null -eq $payload.data -or
    [string]::IsNullOrWhiteSpace([string]$payload.data.article_number) -or
    [string]::IsNullOrWhiteSpace([string]$payload.data.content)) {
    throw 'Legal API response is missing data.article_number or data.content.'
}

Write-Host "Legal API contract: OK ($($payload.law_name), $($payload.data.article_number))"
