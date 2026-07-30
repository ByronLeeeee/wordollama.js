using System.Security.Cryptography;
using WordOllama.Platform;

if (args.Length != 1 ||
    !string.Equals(args[0], "--allow-user-vault-test", StringComparison.Ordinal))
{
    Console.Error.WriteLine(
        "Usage: platform-secret-store-smoke --allow-user-vault-test");
    return 2;
}
if (!OperatingSystem.IsWindows() && !OperatingSystem.IsMacOS())
{
    Console.Error.WriteLine(
        "Native platform secret-store smoke supports Windows or macOS.");
    return 2;
}

var name = "WORDOLLAMA_PLATFORM_SMOKE_" + Guid.NewGuid().ToString("N");
var secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
var store = new PlatformSecretStore();
try
{
    if (store.Get(name) is not null)
    {
        throw new InvalidOperationException("Random smoke secret unexpectedly already exists.");
    }

    store.Set(name, secret);
    var loaded = store.Get(name);
    if (!string.Equals(loaded, secret, StringComparison.Ordinal))
    {
        throw new InvalidOperationException(
            "Native platform secret did not round-trip exactly.");
    }

    store.Delete(name);
    if (store.Get(name) is not null)
    {
        throw new InvalidOperationException(
            "Native platform secret still exists after deletion.");
    }

    Console.WriteLine(
        $"WordOllama.JS native secret-store set/get/delete smoke passed on " +
        $"{(OperatingSystem.IsWindows() ? "Windows" : "macOS")}.");
    return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine(
        $"Native platform secret-store smoke failed: {exception.Message}");
    return 1;
}
finally
{
    try
    {
        store.Delete(name);
    }
    catch
    {
        // Best effort after reporting the primary result. The random target is
        // unique to this process and contains no reusable credential.
    }
}
