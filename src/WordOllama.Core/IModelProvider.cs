using WordOllama.Contracts;

namespace WordOllama.Core;

public interface IModelProvider
{
    string ProviderType { get; }

    Task<ProviderChatResponse> ChatAsync(
        ProviderChatRequest request,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<string>> FetchModelsAsync(
        CancellationToken cancellationToken = default);

    async IAsyncEnumerable<ProviderChatChunk> ChatStreamAsync(
        ProviderChatRequest request,
        [System.Runtime.CompilerServices.EnumeratorCancellation]
        CancellationToken cancellationToken = default)
    {
        var response = await ChatAsync(request, cancellationToken);
        yield return new ProviderChatChunk(
            response.Provider,
            response.Model,
            response.Content,
            Done: true,
            response.ToolCalls);
    }
}
