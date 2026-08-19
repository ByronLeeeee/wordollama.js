using System.Globalization;
using System.Resources;

namespace WordOllama.WindowsInstaller;

internal static class InstallerText
{
    private static readonly ResourceManager Resources = new(
        "WordOllama.WindowsInstaller.Resources.InstallerMessages",
        typeof(InstallerText).Assembly);

    public static string Title => Get(nameof(Title));
    public static string Installed => Get(nameof(Installed));
    public static string Removed => Get(nameof(Removed));
    public static string RolledBack => Get(nameof(RolledBack));
    public static string CertificateTrustPrompt(string thumbprint, DateTime expiresAt) =>
        string.Format(
            CultureInfo.CurrentUICulture,
            Get(nameof(CertificateTrustPrompt)),
            thumbprint,
            expiresAt);
    public static string RestartWord => Get(nameof(RestartWord));
    public static string CloseWpsPrompt => Get(nameof(CloseWpsPrompt));
    public static string CloseWpsFailed => Get(nameof(CloseWpsFailed));
    public static string InstallPrompt(string version, string installRoot) =>
        string.Format(
            CultureInfo.CurrentUICulture,
            Get(nameof(InstallPrompt)),
            version,
            installRoot);

    public static string Failed(string detail) =>
        string.Format(
            CultureInfo.CurrentUICulture,
            Get("Failed"),
            detail);

    private static string Get(string key) =>
        Resources.GetString(key, CultureInfo.CurrentUICulture)
        ?? Resources.GetString(key, CultureInfo.InvariantCulture)
        ?? key;
}
