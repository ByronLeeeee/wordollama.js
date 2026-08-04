using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using WordOllama.Core;

namespace WordOllama.Platform;

/// <summary>
/// Reads and writes secrets in the native user vault without placing the
/// secret in command-line arguments or the JSON configuration file. Bridge
/// command-line provisioning exposes only the dedicated HTTPS certificate
/// password and requires redirected standard input.
/// </summary>
public sealed class PlatformSecretStore : IMutableSecretStore
{
    public const string ProductServicePrefix = "WordOllama.JS/";
    public const string LegacyServicePrefix = "WordOllama/";

    private readonly EnvironmentSecretStore _environment = new();

    public string? Get(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        if (OperatingSystem.IsWindows())
        {
            return GetWithLegacyMigration(
                name,
                WindowsCredentialStore.Get,
                WindowsCredentialStore.Set);
        }

        if (OperatingSystem.IsMacOS())
        {
            return GetWithLegacyMigration(
                name,
                MacKeychainStore.Get,
                MacKeychainStore.Set);
        }

        if (OperatingSystem.IsLinux())
        {
            var secret = GetWithLegacyMigration(
                name,
                LinuxSecretServiceStore.Get,
                LinuxSecretServiceStore.Set);
            return secret ?? _environment.Get(name);
        }

        return _environment.Get(name);
    }

    public void Set(string name, string value)
    {
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrEmpty(value))
        {
            throw new ArgumentException("Secret name and value are required.");
        }
        if (OperatingSystem.IsWindows())
        {
            WindowsCredentialStore.Set(ProductServicePrefix + name, value);
            return;
        }
        if (OperatingSystem.IsMacOS())
        {
            MacKeychainStore.Set(ProductServicePrefix + name, value);
            return;
        }
        if (OperatingSystem.IsLinux())
        {
            LinuxSecretServiceStore.Set(ProductServicePrefix + name, value);
            return;
        }
        throw new PlatformNotSupportedException(
            "Writable secret storage requires Windows Credential Manager, macOS Keychain, or Linux Secret Service.");
    }

    public void Delete(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return;
        if (OperatingSystem.IsWindows()) WindowsCredentialStore.Delete(ProductServicePrefix + name);
        else if (OperatingSystem.IsMacOS()) MacKeychainStore.Delete(ProductServicePrefix + name);
        else if (OperatingSystem.IsLinux()) LinuxSecretServiceStore.Delete(ProductServicePrefix + name);
        else throw new PlatformNotSupportedException(
            "Writable secret storage requires Windows Credential Manager, macOS Keychain, or Linux Secret Service.");
    }

    private string? GetWithLegacyMigration(
        string name,
        Func<string, string?> get,
        Action<string, string> set)
    {
        var current = get(ProductServicePrefix + name);
        if (!string.IsNullOrWhiteSpace(current)) return current;

        var legacy = get(LegacyServicePrefix + name);
        if (!string.IsNullOrWhiteSpace(legacy))
        {
            try
            {
                set(ProductServicePrefix + name, legacy);
            }
            catch (InvalidOperationException)
            {
                // Reading an existing secret is still preferable to losing access
                // when the current vault is temporarily read-only.
            }
            return legacy;
        }
        return _environment.Get(name);
    }
}

internal static class LinuxSecretServiceStore
{
    private const string ApplicationAttribute = "WordOllama.JS";

    public static string? Get(string service)
    {
        var executable = FindSecretTool();
        if (executable is null) return null;
        var result = Run(
            executable,
            ["lookup", "application", ApplicationAttribute, "service", service],
            standardInput: null);
        return result.ExitCode switch
        {
            0 => string.IsNullOrEmpty(result.Output) ? null : result.Output.TrimEnd('\r', '\n'),
            1 => null,
            _ => throw new InvalidOperationException(
                $"Linux Secret Service lookup failed ({result.ExitCode}): {result.Error.Trim()}"),
        };
    }

    public static void Set(string service, string value)
    {
        var executable = FindSecretTool() ?? throw new PlatformNotSupportedException(
            "Linux secret storage requires the 'secret-tool' command from libsecret-tools.");
        var result = Run(
            executable,
            [
                "store",
                "--label=WordOllama.JS",
                "application",
                ApplicationAttribute,
                "service",
                service,
            ],
            value);
        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"Linux Secret Service write failed ({result.ExitCode}): {result.Error.Trim()}");
        }
    }

    public static void Delete(string service)
    {
        var executable = FindSecretTool();
        if (executable is null) return;
        var result = Run(
            executable,
            ["clear", "application", ApplicationAttribute, "service", service],
            standardInput: null);
        if (result.ExitCode is not (0 or 1))
        {
            throw new InvalidOperationException(
                $"Linux Secret Service delete failed ({result.ExitCode}): {result.Error.Trim()}");
        }
    }

    private static string? FindSecretTool()
    {
        const string standardPath = "/usr/bin/secret-tool";
        if (File.Exists(standardPath)) return standardPath;
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
                     .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var candidate = Path.Combine(directory, "secret-tool");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static SecretToolResult Run(
        string executable,
        IReadOnlyList<string> arguments,
        string? standardInput)
    {
        var startInfo = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            RedirectStandardInput = standardInput is not null,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Unable to start Linux secret-tool.");
        if (standardInput is not null)
        {
            process.StandardInput.Write(standardInput);
            process.StandardInput.Close();
        }
        var outputTask = process.StandardOutput.ReadToEndAsync();
        var errorTask = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(10_000))
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException("Linux secret-tool did not finish within 10 seconds.");
        }
        return new SecretToolResult(process.ExitCode, outputTask.GetAwaiter().GetResult(),
            errorTask.GetAwaiter().GetResult());
    }

    private sealed record SecretToolResult(int ExitCode, string Output, string Error);
}

internal static class MacKeychainStore
{
    private const string SecurityFramework = "/System/Library/Frameworks/Security.framework/Security";

    public static string? Get(string name)
    {
        var service = Encoding.UTF8.GetBytes(name);
        var account = Encoding.UTF8.GetBytes(Environment.UserName);
        var status = SecKeychainFindGenericPassword(
            IntPtr.Zero,
            service.Length,
            service,
            account.Length,
            account,
            out var passwordLength,
            out var passwordData,
            out var item);
        if (status != 0 || passwordData == IntPtr.Zero || passwordLength <= 0)
        {
            if (passwordData != IntPtr.Zero)
            {
                SecKeychainItemFreeContent(IntPtr.Zero, passwordData);
            }
            if (item != IntPtr.Zero) CFRelease(item);
            return null;
        }
        try
        {
            var value = new byte[passwordLength];
            Marshal.Copy(passwordData, value, 0, value.Length);
            return Encoding.UTF8.GetString(value);
        }
        finally
        {
            SecKeychainItemFreeContent(IntPtr.Zero, passwordData);
            if (item != IntPtr.Zero) CFRelease(item);
        }
    }

    public static void Set(string name, string value)
    {
        var service = Encoding.UTF8.GetBytes(name);
        var account = Encoding.UTF8.GetBytes(Environment.UserName);
        var secret = Encoding.UTF8.GetBytes(value);
        var status = SecKeychainFindGenericPassword(
            IntPtr.Zero, service.Length, service, account.Length, account,
            out _, out var existingData, out var item);
        if (existingData != IntPtr.Zero) SecKeychainItemFreeContent(IntPtr.Zero, existingData);
        if (status == 0 && item != IntPtr.Zero)
        {
            try
            {
                status = SecKeychainItemModifyAttributesAndData(item, IntPtr.Zero, secret.Length, secret);
            }
            finally
            {
                CFRelease(item);
            }
        }
        else
        {
            status = SecKeychainAddGenericPassword(
                IntPtr.Zero, service.Length, service, account.Length, account,
                secret.Length, secret, out var created);
            if (created != IntPtr.Zero) CFRelease(created);
        }
        if (status != 0) throw new InvalidOperationException($"macOS Keychain write failed ({status}).");
    }

    public static void Delete(string name)
    {
        var service = Encoding.UTF8.GetBytes(name);
        var account = Encoding.UTF8.GetBytes(Environment.UserName);
        var status = SecKeychainFindGenericPassword(
            IntPtr.Zero, service.Length, service, account.Length, account,
            out _, out var data, out var item);
        if (data != IntPtr.Zero) SecKeychainItemFreeContent(IntPtr.Zero, data);
        if (status != 0 || item == IntPtr.Zero) return;
        try
        {
            status = SecKeychainItemDelete(item);
            if (status != 0) throw new InvalidOperationException($"macOS Keychain delete failed ({status}).");
        }
        finally
        {
            CFRelease(item);
        }
    }

    [DllImport(SecurityFramework)]
    private static extern int SecKeychainFindGenericPassword(
        IntPtr keychain, int serviceNameLength, byte[] serviceName, int accountNameLength,
        byte[] accountName, out int passwordLength, out IntPtr passwordData, out IntPtr itemRef);

    [DllImport(SecurityFramework)]
    private static extern int SecKeychainAddGenericPassword(
        IntPtr keychain, int serviceNameLength, byte[] serviceName, int accountNameLength,
        byte[] accountName, int passwordLength, byte[] passwordData, out IntPtr itemRef);

    [DllImport(SecurityFramework)]
    private static extern int SecKeychainItemModifyAttributesAndData(
        IntPtr itemRef, IntPtr attributes, int length, byte[] data);

    [DllImport(SecurityFramework)]
    private static extern int SecKeychainItemDelete(IntPtr itemRef);

    [DllImport(SecurityFramework)]
    private static extern int SecKeychainItemFreeContent(IntPtr attributes, IntPtr data);

    [DllImport("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")]
    private static extern void CFRelease(IntPtr value);
}

internal static class WindowsCredentialStore
{
    private const uint CredentialTypeGeneric = 1;
    private const uint CredentialPersistLocalMachine = 2;

    public static string? Get(string name)
    {
        if (!CredRead(name, CredentialTypeGeneric, 0, out var pointer))
        {
            return null;
        }

        try
        {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0)
            {
                return null;
            }

            var bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.Unicode.GetString(bytes).TrimEnd('\0');
        }
        finally
        {
            CredFree(pointer);
        }
    }

    public static void Set(string name, string value)
    {
        var bytes = Encoding.Unicode.GetBytes(value);
        var blob = Marshal.AllocCoTaskMem(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var credential = new Credential
            {
                Type = CredentialTypeGeneric,
                TargetName = Marshal.StringToCoTaskMemUni(name),
                CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = blob,
                Persist = CredentialPersistLocalMachine,
                UserName = Marshal.StringToCoTaskMemUni(Environment.UserName),
            };
            try
            {
                if (!CredWrite(ref credential, 0))
                {
                    throw new InvalidOperationException($"Windows Credential Manager write failed ({Marshal.GetLastWin32Error()}).");
                }
            }
            finally
            {
                Marshal.FreeCoTaskMem(credential.TargetName);
                Marshal.FreeCoTaskMem(credential.UserName);
            }
        }
        finally
        {
            Marshal.FreeCoTaskMem(blob);
        }
    }

    public static void Delete(string name)
    {
        if (!CredDelete(name, CredentialTypeGeneric, 0))
        {
            const int ErrorNotFound = 1168;
            var error = Marshal.GetLastWin32Error();
            if (error != ErrorNotFound)
            {
                throw new InvalidOperationException($"Windows Credential Manager delete failed ({error}).");
            }
        }
    }

    [DllImport("Advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(
        string target,
        uint type,
        uint flags,
        out IntPtr credential);

    [DllImport("Advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, uint flags);

    [DllImport("Advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string targetName, uint type, uint flags);

    [DllImport("Advapi32.dll", SetLastError = true)]
    private static extern bool CredFree(IntPtr credential);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }
}
