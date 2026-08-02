using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
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
        var command = args.Length > 1 ? args[1] : "";
        var isCertificateVerification =
            string.Equals(command, "verify-certificate", StringComparison.OrdinalIgnoreCase);
        if ((isCertificateVerification && args.Length != 4) ||
            (!isCertificateVerification &&
             (args.Length != 2 ||
              (!string.Equals(command, "set", StringComparison.OrdinalIgnoreCase) &&
               !string.Equals(command, "delete", StringComparison.OrdinalIgnoreCase) &&
               !string.Equals(command, "verify", StringComparison.OrdinalIgnoreCase)))))
        {
            error.WriteLine(
                "Usage: WordOllama.DesktopBridge https-certificate-secret <set|delete|verify|verify-certificate PFX-PATH THUMBPRINT>");
            return 2;
        }

        if (isCertificateVerification)
        {
            var password = secretStore.Get(SecretName);
            if (string.IsNullOrEmpty(password))
            {
                error.WriteLine("HTTPS certificate password is missing from the platform secret store.");
                return 1;
            }
            try
            {
                using var certificate = new X509Certificate2(
                    Path.GetFullPath(args[2]),
                    password,
                    X509KeyStorageFlags.EphemeralKeySet);
                if (!certificate.HasPrivateKey ||
                    !string.Equals(
                        certificate.Thumbprint,
                        args[3],
                        StringComparison.OrdinalIgnoreCase))
                {
                    error.WriteLine("HTTPS PFX does not match the owned localhost certificate.");
                    return 1;
                }
                output.WriteLine("HTTPS PFX matches the owned localhost certificate.");
                return 0;
            }
            catch (Exception exception) when (
                exception is CryptographicException or IOException or
                UnauthorizedAccessException or ArgumentException)
            {
                error.WriteLine("HTTPS PFX could not be verified.");
                return 1;
            }
        }

        if (string.Equals(command, "verify", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrEmpty(secretStore.Get(SecretName)))
            {
                error.WriteLine("HTTPS certificate password is missing from the platform secret store.");
                return 1;
            }
            output.WriteLine("HTTPS certificate password exists in the platform secret store.");
            return 0;
        }

        if (string.Equals(command, "delete", StringComparison.OrdinalIgnoreCase))
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
