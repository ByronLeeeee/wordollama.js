namespace WordOllama.Core;

public interface ISecretStore
{
    string? Get(string name);
}

public interface IMutableSecretStore : ISecretStore
{
    void Set(string name, string value);
    void Delete(string name);
}

/// <summary>
/// Injection boundary for Windows Credential Manager, macOS Keychain, and Linux Secret Service.
/// Environment variables are intentionally read-only and are suitable for
/// managed deployments or a launcher that has already queried the OS vault.
/// </summary>
public sealed class EnvironmentSecretStore : ISecretStore
{
    public string? Get(string name) =>
        string.IsNullOrWhiteSpace(name) ? null : Environment.GetEnvironmentVariable(name);
}

public static class PlatformPaths
{
    public const string ProductDirectoryName = "WordOllama.JS";
    public const string LegacyProductDirectoryName = "WordOllama";

    public static string GetSettingsRoot()
    {
        return Path.Combine(GetApplicationDataRoot(), ProductDirectoryName);
    }

    public static string GetLegacySettingsRoot()
    {
        return Path.Combine(GetApplicationDataRoot(), LegacyProductDirectoryName);
    }

    public static string GetSkillsRoot()
    {
        return Path.Combine(GetSettingsRoot(), "Skills");
    }

    public static string GetLegacySkillsRoot()
    {
        if (OperatingSystem.IsWindows())
        {
            var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            if (!string.IsNullOrWhiteSpace(documents))
            {
                return Path.Combine(documents, "WordAgentSkills");
            }
        }

        return Path.Combine(GetLegacySettingsRoot(), "Skills");
    }

    private static string GetApplicationDataRoot()
    {
        var applicationData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return string.IsNullOrWhiteSpace(applicationData)
            ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            : applicationData;
    }
}
