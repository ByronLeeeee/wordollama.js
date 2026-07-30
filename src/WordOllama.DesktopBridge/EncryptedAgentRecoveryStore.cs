using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WordOllama.Contracts;
using WordOllama.Core;

namespace WordOllama.DesktopBridge;

public sealed class EncryptedAgentRecoveryStore : IAgentRecoveryStore
{
    private const string KeyName = "agent-recovery-key-v1";
    private const int MaximumPlaintextBytes = 24 * 1024 * 1024;
    private const int MaximumSnapshots = 10;
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("WOAR1");
    private readonly string _path;
    private readonly byte[]? _key;
    private readonly object _gate = new();
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

    public EncryptedAgentRecoveryStore(string path, IMutableSecretStore secrets)
    {
        _path = Path.GetFullPath(path);
        _key = LoadOrCreateKey(secrets);
    }

    public bool Enabled => _key is { Length: 32 };

    public IReadOnlyList<AgentRecoverySnapshot> LoadAll()
    {
        lock (_gate)
        {
            return ReadUnsafe();
        }
    }

    public void Save(AgentRecoverySnapshot snapshot)
    {
        if (!Enabled || string.IsNullOrWhiteSpace(snapshot.SessionId)) return;
        lock (_gate)
        {
            var snapshots = ReadUnsafe()
                .Where(item => !string.Equals(
                    item.SessionId,
                    snapshot.SessionId,
                    StringComparison.Ordinal))
                .Append(snapshot)
                .OrderByDescending(item => item.UpdatedAt)
                .Take(MaximumSnapshots)
                .ToArray();
            WriteUnsafe(snapshots);
        }
    }

    public void Delete(string sessionId)
    {
        if (!Enabled || string.IsNullOrWhiteSpace(sessionId)) return;
        lock (_gate)
        {
            var snapshots = ReadUnsafe()
                .Where(item => !string.Equals(item.SessionId, sessionId, StringComparison.Ordinal))
                .ToArray();
            if (snapshots.Length == 0)
            {
                if (File.Exists(_path)) File.Delete(_path);
                return;
            }
            WriteUnsafe(snapshots);
        }
    }

    private AgentRecoverySnapshot[] ReadUnsafe()
    {
        if (!Enabled || !File.Exists(_path)) return [];
        try
        {
            var length = new FileInfo(_path).Length;
            if (length < Magic.Length + 12 + 16 ||
                length > MaximumPlaintextBytes + Magic.Length + 12 + 16)
            {
                return [];
            }
            var envelope = File.ReadAllBytes(_path);
            if (envelope.Length < Magic.Length + 12 + 16 ||
                !envelope.AsSpan(0, Magic.Length).SequenceEqual(Magic))
            {
                return [];
            }
            var nonce = envelope.AsSpan(Magic.Length, 12);
            var tag = envelope.AsSpan(Magic.Length + 12, 16);
            var ciphertext = envelope.AsSpan(Magic.Length + 28);
            if (ciphertext.Length > MaximumPlaintextBytes) return [];
            var plaintext = new byte[ciphertext.Length];
            using var aes = new AesGcm(_key!, 16);
            aes.Decrypt(nonce, ciphertext, tag, plaintext, Magic);
            return (JsonSerializer.Deserialize<AgentRecoverySnapshot[]>(plaintext, _json) ?? [])
                .Where(IsValid)
                .OrderByDescending(snapshot => snapshot.UpdatedAt)
                .Take(MaximumSnapshots)
                .ToArray();
        }
        catch (CryptographicException)
        {
            return [];
        }
        catch (JsonException)
        {
            return [];
        }
        catch (IOException)
        {
            return [];
        }
        catch (UnauthorizedAccessException)
        {
            return [];
        }
    }

    private void WriteUnsafe(IReadOnlyList<AgentRecoverySnapshot> snapshots)
    {
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(snapshots, _json);
        if (plaintext.Length > MaximumPlaintextBytes)
        {
            throw new InvalidOperationException("Encrypted Agent recovery state exceeds the 24 MB safety limit.");
        }
        var nonce = RandomNumberGenerator.GetBytes(12);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(_key!, tag.Length))
        {
            aes.Encrypt(nonce, plaintext, ciphertext, tag, Magic);
        }
        var envelope = new byte[Magic.Length + nonce.Length + tag.Length + ciphertext.Length];
        Magic.CopyTo(envelope, 0);
        nonce.CopyTo(envelope, Magic.Length);
        tag.CopyTo(envelope, Magic.Length + nonce.Length);
        ciphertext.CopyTo(envelope, Magic.Length + nonce.Length + tag.Length);

        var directory = Path.GetDirectoryName(_path)
            ?? throw new InvalidOperationException("Agent recovery path has no parent directory.");
        Directory.CreateDirectory(directory);
        var temporaryPath = _path + ".tmp." + Guid.NewGuid().ToString("N");
        try
        {
            File.WriteAllBytes(temporaryPath, envelope);
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(
                    temporaryPath,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite);
            }
            File.Move(temporaryPath, _path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static byte[]? LoadOrCreateKey(IMutableSecretStore secrets)
    {
        try
        {
            var existing = secrets.Get(KeyName);
            if (!string.IsNullOrWhiteSpace(existing))
            {
                var decoded = Convert.FromBase64String(existing);
                if (decoded.Length == 32) return decoded;
                return null;
            }
            var created = RandomNumberGenerator.GetBytes(32);
            secrets.Set(KeyName, Convert.ToBase64String(created));
            return created;
        }
        catch (FormatException)
        {
            return null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
        catch (PlatformNotSupportedException)
        {
            return null;
        }
    }

    private static bool IsValid(AgentRecoverySnapshot snapshot)
    {
        if (string.IsNullOrWhiteSpace(snapshot.SessionId) ||
            snapshot.SessionId.Length > 128 ||
            string.IsNullOrWhiteSpace(snapshot.Origin) ||
            snapshot.Origin.Length > 2048 ||
            !Uri.TryCreate(snapshot.Origin, UriKind.Absolute, out var origin) ||
            origin.Scheme != Uri.UriSchemeHttps ||
            snapshot.Request is null ||
            snapshot.Messages is null ||
            snapshot.Checkpoint is null ||
            string.IsNullOrWhiteSpace(snapshot.Request.UserRequirement) ||
            snapshot.Request.UserRequirement.Length > 100_000 ||
            snapshot.Request.ImageDataUrl?.Length > 12 * 1024 * 1024 ||
            snapshot.Messages.Count > 2_000 ||
            snapshot.Iteration < 1 ||
            snapshot.Iteration > 1_000)
        {
            return false;
        }
        return snapshot.Messages.All(message =>
            message is not null &&
            !string.IsNullOrWhiteSpace(message.Role) &&
            message.Role.Length <= 32 &&
            message.Content is not null &&
            message.Content.Length <= 1_000_000 &&
            (message.ImageDataUrl?.Length ?? 0) <= 12 * 1024 * 1024);
    }
}
