namespace WordOllama.Core;

public sealed record ModelProviderOptions(
    string Type,
    string Endpoint,
    string ApiKey,
    string Model,
    string ApiMode = "Auto",
    string ReasoningEffort = "Auto",
    int ThinkingBudget = 4096);

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
                apiMode: options.ApiMode,
                reasoningEffort: options.ReasoningEffort),
            "lmstudio" => new OpenAiCompatibleProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model,
                "LMStudio",
                apiMode: options.ApiMode,
                reasoningEffort: options.ReasoningEffort),
            "vllm" => new OpenAiCompatibleProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model,
                "vLLM",
                apiMode: options.ApiMode,
                reasoningEffort: options.ReasoningEffort),
            "claude" or "anthropic" => new AnthropicProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model,
                reasoningEffort: options.ReasoningEffort,
                thinkingBudget: options.ThinkingBudget),
            "gemini" or "google" => new GeminiProvider(
                options.Endpoint,
                options.ApiKey,
                options.Model,
                reasoningEffort: options.ReasoningEffort,
                thinkingBudget: options.ThinkingBudget),
            _ => throw new ArgumentException($"Unsupported model provider: {options.Type}"),
        };
}
