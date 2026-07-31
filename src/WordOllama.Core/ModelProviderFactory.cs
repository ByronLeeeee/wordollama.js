namespace WordOllama.Core;

public sealed record ModelProviderOptions(
    string Type,
    string Endpoint,
    string ApiKey,
    string Model,
    string ApiMode = "Auto");

public static class ModelProviderFactory
{
    public static IModelProvider Create(ModelProviderOptions options) =>
        options.Type.Trim().ToLowerInvariant() switch
        {
            "ollama" => new OllamaProvider(options.Endpoint, options.Model),
            "openai" => new OpenAiCompatibleProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model,
                "OpenAI",
                apiMode: options.ApiMode),
            "lmstudio" => new OpenAiCompatibleProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model,
                "LMStudio",
                apiMode: options.ApiMode),
            "vllm" => new OpenAiCompatibleProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model,
                "vLLM",
                apiMode: options.ApiMode),
            "claude" or "anthropic" => new AnthropicProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model),
            "gemini" or "google" => new GeminiProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model),
            _ => throw new ArgumentException($"Unsupported model provider: {options.Type}"),
        };
}
