namespace WordOllama.Core;

public sealed record ModelProviderOptions(
    string Type,
    string Endpoint,
    string ApiKey,
    string Model);

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
                "OpenAI"),
            "lmstudio" => new OpenAiCompatibleProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model,
                "LMStudio"),
            "vllm" => new OpenAiCompatibleProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model,
                "vLLM"),
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
