using System.Text.Json;
using WordOllama.Contracts;

namespace WordOllama.Core;

public interface IInternalToolExecutor
{
    IReadOnlyList<OfficeToolDescriptor> GetToolDescriptors();
    bool IsKnownTool(string name);
    bool RequiresConfirmation(string name) =>
        name is "execute_command" or "run_python_script" or "http_request";
    Task<string> ExecuteAsync(
        string name,
        JsonElement arguments,
        CancellationToken cancellationToken = default);
}
