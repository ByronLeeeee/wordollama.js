using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace WordOllama.DesktopBridge;

internal static class WpsRegistrationCommand
{
    private const string CommandName = "wps-registration";
    private const string AddinName = "WordOllama.JS";
    private const string DefaultAddinUrl = "https://localhost:37421/wps-addin/";

    public static bool IsRequested(string[] args) =>
        args.Length > 0 && string.Equals(args[0], CommandName, StringComparison.Ordinal);

    public static int Execute(
        string[] args,
        TextWriter output,
        TextWriter error)
    {
        try
        {
            if (args.Length < 2 || args[1] is not ("install" or "uninstall"))
            {
                WriteUsage(error);
                return 2;
            }

            var path = DefaultPublishPath();
            var addinUrl = DefaultAddinUrl;
            for (var index = 2; index < args.Length; index++)
            {
                switch (args[index])
                {
                    case "--path" when index + 1 < args.Length:
                        path = Path.GetFullPath(args[++index]);
                        break;
                    case "--url" when index + 1 < args.Length:
                        addinUrl = ValidateAddinUrl(args[++index]);
                        break;
                    default:
                        WriteUsage(error);
                        return 2;
                }
            }

            if (args[1] == "install")
            {
                Register(path, addinUrl);
                output.WriteLine($"Registered {AddinName} for WPS at {path}");
            }
            else
            {
                Unregister(path);
                output.WriteLine($"Removed {AddinName} WPS registration from {path}");
            }
            return 0;
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or
            InvalidDataException or XmlException or ArgumentException or
            PlatformNotSupportedException)
        {
            error.WriteLine($"WPS registration failed: {exception.Message}");
            return 1;
        }
    }

    private static string DefaultPublishPath()
    {
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrWhiteSpace(userProfile))
        {
            throw new PlatformNotSupportedException("The current user profile could not be resolved.");
        }

        if (OperatingSystem.IsWindows())
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appData, "kingsoft", "wps", "jsaddons", "publish.xml");
        }
        if (OperatingSystem.IsMacOS())
        {
            return Path.Combine(
                userProfile,
                "Library",
                "Containers",
                "com.kingsoft.wpsoffice.mac",
                "Data",
                ".kingsoft",
                "wps",
                "jsaddons",
                "publish.xml");
        }
        if (OperatingSystem.IsLinux())
        {
            return Path.Combine(
                userProfile,
                ".local",
                "share",
                "Kingsoft",
                "wps",
                "jsaddons",
                "publish.xml");
        }
        throw new PlatformNotSupportedException("WPS registration supports Windows, macOS, and Linux.");
    }

    private static string ValidateAddinUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps &&
             !(OperatingSystem.IsLinux() && uri.Scheme == Uri.UriSchemeHttp)) ||
            !uri.IsLoopback ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment))
        {
            throw new ArgumentException(
                "The WPS add-in URL must use loopback HTTPS; Linux also permits loopback HTTP.");
        }
        return uri.AbsoluteUri.TrimEnd('/') + "/";
    }

    private static void Register(string path, string addinUrl)
    {
        var document = ReadPublishDocument(path);
        var root = document.Root!;
        RemoveOwnedEntries(root);
        var ns = root.Name.Namespace;
        root.Add(new XElement(
            ns + "jspluginonline",
            new XAttribute("name", AddinName),
            new XAttribute("type", "wps"),
            new XAttribute("url", addinUrl),
            new XAttribute("enable", "enable_dev"),
            new XAttribute("install", "null"),
            new XAttribute("customDomain", "")));
        WriteAtomic(path, document);
    }

    private static void Unregister(string path)
    {
        if (!File.Exists(path)) return;
        var document = ReadPublishDocument(path);
        var root = document.Root!;
        var before = root.Elements().Count();
        RemoveOwnedEntries(root);
        if (root.Elements().Count() == before) return;
        WriteAtomic(path, document);
    }

    private static XDocument ReadPublishDocument(string path)
    {
        if (!File.Exists(path))
        {
            return new XDocument(new XDeclaration("1.0", "utf-8", null), new XElement("jsplugins"));
        }

        try
        {
            var document = XDocument.Load(path, LoadOptions.PreserveWhitespace);
            if (!string.Equals(
                    document.Root?.Name.LocalName,
                    "jsplugins",
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(
                    "The existing WPS publish.xml has an unexpected root element and was preserved unchanged.");
            }
            return document;
        }
        catch (XmlException exception)
        {
            throw new InvalidDataException(
                "The existing WPS publish.xml is invalid and was preserved unchanged.",
                exception);
        }
    }

    private static void RemoveOwnedEntries(XElement root)
    {
        root.Elements()
            .Where(element =>
                element.Name.LocalName is "jspluginonline" or "jsplugin" &&
                string.Equals(
                    element.Attribute("name")?.Value,
                    AddinName,
                    StringComparison.OrdinalIgnoreCase))
            .Remove();
    }

    private static void WriteAtomic(string path, XDocument document)
    {
        var directory = Path.GetDirectoryName(path);
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new InvalidDataException("The WPS publish.xml path has no parent directory.");
        }
        Directory.CreateDirectory(directory);

        var backupPath = path + ".wordollama-backup";
        if (File.Exists(path) && !File.Exists(backupPath))
        {
            File.Copy(path, backupPath, overwrite: false);
        }

        var temporaryPath = Path.Combine(
            directory,
            $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var writer = XmlWriter.Create(
                temporaryPath,
                new XmlWriterSettings
                {
                    Encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
                    Indent = true,
                    OmitXmlDeclaration = false,
                }))
            {
                document.Save(writer);
            }

            if (!OperatingSystem.IsWindows() && File.Exists(path))
            {
                File.SetUnixFileMode(temporaryPath, File.GetUnixFileMode(path));
            }
            File.Move(temporaryPath, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static void WriteUsage(TextWriter writer) => writer.WriteLine(
        "Usage: WordOllama.DesktopBridge wps-registration install|uninstall " +
        "[--path <publish.xml>] [--url <https://localhost/...>]");
}
