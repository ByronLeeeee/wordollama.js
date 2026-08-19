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
    public static string WelcomeTitle => Get(nameof(WelcomeTitle));
    public static string WelcomeBody => Get(nameof(WelcomeBody));
    public static string ReviewTitle => Get(nameof(ReviewTitle));
    public static string ReviewBody => Get(nameof(ReviewBody));
    public static string VersionLabel => Get(nameof(VersionLabel));
    public static string InstallLocationLabel => Get(nameof(InstallLocationLabel));
    public static string ComponentsLabel => Get(nameof(ComponentsLabel));
    public static string ComponentsValue => Get(nameof(ComponentsValue));
    public static string CertificateConsent => Get(nameof(CertificateConsent));
    public static string StartAfterInstall => Get(nameof(StartAfterInstall));
    public static string InstallingTitle => Get(nameof(InstallingTitle));
    public static string InstallingBody => Get(nameof(InstallingBody));
    public static string CompleteTitle => Get(nameof(CompleteTitle));
    public static string CompleteBody => Get(nameof(CompleteBody));
    public static string CompleteRestartWord => Get(nameof(CompleteRestartWord));
    public static string Cancelled => Get(nameof(Cancelled));
    public static string Back => Get(nameof(Back));
    public static string Next => Get(nameof(Next));
    public static string Install => Get(nameof(Install));
    public static string Finish => Get(nameof(Finish));
    public static string Cancel => Get(nameof(Cancel));

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
