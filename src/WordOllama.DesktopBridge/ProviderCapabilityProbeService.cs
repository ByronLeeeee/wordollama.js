using System.Diagnostics;
using System.Text.Json;
using WordOllama.Contracts;
using WordOllama.Core;

namespace WordOllama.DesktopBridge;

public sealed class ProviderCapabilityProbeService
{
    private readonly ProviderSettingsStore _settings;

    public ProviderCapabilityProbeService(ProviderSettingsStore settings)
    {
        _settings = settings;
    }

    public async Task<ProviderCapabilityProbeResponse> ProbeAsync(
        string profileId,
        CancellationToken cancellationToken = default)
    {
        var profile = _settings.GetView().Profiles.FirstOrDefault(item => item.Id == profileId)
            ?? throw new KeyNotFoundException($"Provider profile was not found: {profileId}");
        var provider = ModelProviderFactory.Create(_settings.GetOptions(profileId));
        var errors = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var models = false;
        var chat = false;
        var streaming = false;
        var toolCalling = false;
        var stopwatch = Stopwatch.StartNew();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));

        try { _ = await provider.FetchModelsAsync(timeout.Token); models = true; }
        catch (Exception exception) when (exception is not OperationCanceledException) { errors["models"] = Bound(exception.Message); }

        try
        {
            var response = await provider.ChatAsync(new ProviderChatRequest(
                [new ChatMessage("user", "Reply with exactly: OK")],
                ProviderProfileId: profileId), timeout.Token);
            chat = !string.IsNullOrWhiteSpace(response.Content);
            if (!chat) errors["chat"] = "Provider returned an empty chat response.";
        }
        catch (Exception exception) when (exception is not OperationCanceledException) { errors["chat"] = Bound(exception.Message); }

        try
        {
            var echo = new OfficeToolDescriptor(
                "capability_echo",
                "Return the supplied value. Call this tool now.",
                false,
                JsonSerializer.SerializeToElement(new
                {
                    type = "object",
                    properties = new { value = new { type = "string" } },
                    required = new[] { "value" },
                }));
            var response = await provider.ChatAsync(new ProviderChatRequest(
                [new ChatMessage("user", "Call capability_echo with value 'ok'. Do not answer normally.")],
                Tools: [echo], ProviderProfileId: profileId), timeout.Token);
            toolCalling = response.ToolCalls?.Any(call => call.Name == "capability_echo") == true;
            if (!toolCalling) errors["toolCalling"] = "The request succeeded, but the model did not produce a native tool call.";
        }
        catch (Exception exception) when (exception is not OperationCanceledException) { errors["toolCalling"] = Bound(exception.Message); }

        try
        {
            await foreach (var chunk in provider.ChatStreamAsync(new ProviderChatRequest(
                [new ChatMessage("user", "Reply with OK")], ProviderProfileId: profileId), timeout.Token))
            {
                if (!string.IsNullOrEmpty(chunk.Delta) || chunk.Done) { streaming = true; break; }
            }
            if (!streaming) errors["streaming"] = "The stream produced no content or completion event.";
        }
        catch (Exception exception) when (exception is not OperationCanceledException) { errors["streaming"] = Bound(exception.Message); }

        stopwatch.Stop();
        return new ProviderCapabilityProbeResponse(
            profileId, models, chat, streaming, toolCalling,
            profile.SupportsVision, profile.SupportsJsonOutput,
            stopwatch.ElapsedMilliseconds, errors);
    }

    private static string Bound(string value) => value.Length <= 500 ? value : value[..500] + "…";
}
