using WordOllama.Core;

namespace WordOllama.DesktopBridge;

public static class HttpsCertificateSecretCommand
{
    public const string SecretName = "WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD";

    public static bool IsRequested(string[] args) =>
        args.Length > 0 &&
        string.Equals(args[0], "https-certificate-secret", StringComparison.OrdinalIgnoreCase);

    public static int Execute(
        string[] args,
        IMutableSecretStore secretStore,
        TextReader input,
        TextWriter output,
        TextWriter error,
        bool inputIsRedirected)
    {
        if (args.Length != 2 ||
            (!string.Equals(args[1], "set", StringComparison.OrdinalIgnoreCase) &&
             !string.Equals(args[1], "delete", StringComparison.OrdinalIgnoreCase) &&
             !string.Equals(args[1], "verify", StringComparison.OrdinalIgnoreCase)))
        {
            error.WriteLine(
                "Usage: WordOllama.DesktopBridge https-certificate-secret <set|delete|verify>");
            return 2;
        }

        if (string.Equals(args[1], "verify", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrEmpty(secretStore.Get(SecretName)))
            {
                error.WriteLine("HTTPS certificate password is missing from the platform secret store.");
                return 1;
            }
            output.WriteLine("HTTPS certificate password exists in the platform secret store.");
            return 0;
        }

        if (string.Equals(args[1], "delete", StringComparison.OrdinalIgnoreCase))
        {
            secretStore.Delete(SecretName);
            output.WriteLine("HTTPS certificate password removed from the platform secret store.");
            return 0;
        }

        if (!inputIsRedirected)
        {
            error.WriteLine(
                "The HTTPS certificate password must be supplied through redirected standard input.");
            return 2;
        }

        var value = input.ReadToEnd().TrimEnd('\r', '\n');
        if (string.IsNullOrEmpty(value) || value.Length > 4096)
        {
            error.WriteLine("The HTTPS certificate password must contain 1 to 4096 characters.");
            return 2;
        }

        secretStore.Set(SecretName, value);
        output.WriteLine("HTTPS certificate password saved in the platform secret store.");
        return 0;
    }
}
