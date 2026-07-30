using WordOllama.Contracts;

namespace WordOllama.Core;

public interface IAgentRecoveryStore
{
    IReadOnlyList<AgentRecoverySnapshot> LoadAll();
    void Save(AgentRecoverySnapshot snapshot);
    void Delete(string sessionId);
}

public sealed class NullAgentRecoveryStore : IAgentRecoveryStore
{
    public IReadOnlyList<AgentRecoverySnapshot> LoadAll() => [];
    public void Save(AgentRecoverySnapshot snapshot) { }
    public void Delete(string sessionId) { }
}
