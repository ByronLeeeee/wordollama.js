using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace WordOllama.DesktopBridge;

public sealed record OllamaServerSettingsView(
    string Platform,
    string ModelsPath,
    string Host,
    string KeepAlive,
    int ContextLength,
    int MaxLoadedModels,
    int NumParallel,
    int MaxQueue,
    bool RestartRequired);

public sealed record OllamaServerSettingsUpdate(
    string? ModelsPath,
    string? Host,
    string? KeepAlive,
    int ContextLength,
    int MaxLoadedModels,
    int NumParallel,
    int MaxQueue);

public sealed class OllamaServerSettingsStore
{
    private static readonly string[] VariableNames =
    [
        "OLLAMA_MODELS",
        "OLLAMA_HOST",
        "OLLAMA_KEEP_ALIVE",
        "OLLAMA_CONTEXT_LENGTH",
        "OLLAMA_MAX_LOADED_MODELS",
        "OLLAMA_NUM_PARALLEL",
        "OLLAMA_MAX_QUEUE",
    ];

    private readonly string _path;
    private readonly Action<IReadOnlyDictionary<string, string>>? _applyOverride;
    private readonly object _gate = new();
    private OllamaServerSettingsUpdate _settings;

    public OllamaServerSettingsStore(
        string path,
        Action<IReadOnlyDictionary<string, string>>? applyOverride = null)
    {
        _path = Path.GetFullPath(path);
        _applyOverride = applyOverride;
        _settings = Load();
    }

    public OllamaServerSettingsView Get()
    {
        lock (_gate) return ToView(_settings);
    }

    public OllamaServerSettingsView SaveAndApply(OllamaServerSettingsUpdate update)
    {
        var validated = Validate(update);
        lock (_gate)
        {
            Apply(validated);
            Persist(validated);
            _settings = validated;
            return ToView(validated);
        }
    }

    public void ReapplyForCurrentLoginSession()
    {
        if (!OperatingSystem.IsMacOS()) return;
        lock (_gate)
        {
            try
            {
                Apply(_settings);
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine($"Unable to reapply persisted Ollama launchctl settings: {exception.Message}");
            }
        }
    }

    private void Apply(OllamaServerSettingsUpdate settings)
    {
        var values = ToVariables(settings);
        if (_applyOverride is not null)
        {
            _applyOverride(values);
            return;
        }
        if (OperatingSystem.IsWindows())
        {
            foreach (var name in VariableNames)
            {
                values.TryGetValue(name, out var value);
                Environment.SetEnvironmentVariable(
                    name,
                    string.IsNullOrWhiteSpace(value) ? null : value,
                    EnvironmentVariableTarget.User);
            }
            return;
        }

        if (OperatingSystem.IsMacOS())
        {
            foreach (var name in VariableNames)
            {
                values.TryGetValue(name, out var value);
                RunLaunchCtl(string.IsNullOrWhiteSpace(value)
                    ? ["unsetenv", name]
                    : ["setenv", name, value]);
            }
            return;
        }

        throw new PlatformNotSupportedException("Ollama server settings are supported on Windows and macOS.");
    }

    private static void RunLaunchCtl(IReadOnlyList<string> arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "/bin/launchctl",
            UseShellExecute = false,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Unable to start launchctl.");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        if (!process.WaitForExit(10_000))
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException("launchctl did not finish within 10 seconds.");
        }
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"launchctl failed ({process.ExitCode}): {(string.IsNullOrWhiteSpace(stderr) ? stdout : stderr).Trim()}");
        }
    }

    private void Persist(OllamaServerSettingsUpdate settings)
    {
        var directory = Path.GetDirectoryName(_path)
            ?? throw new InvalidOperationException("Ollama settings path has no parent directory.");
        Directory.CreateDirectory(directory);
        var temporary = _path + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(settings, JsonOptions));
        File.Move(temporary, _path, overwrite: true);
    }

    private OllamaServerSettingsUpdate Load()
    {
        if (File.Exists(_path))
        {
            try
            {
                return Validate(JsonSerializer.Deserialize<OllamaServerSettingsUpdate>(
                    File.ReadAllText(_path), JsonOptions)
                    ?? Empty());
            }
            catch (JsonException exception)
            {
                throw new InvalidDataException("Ollama server settings JSON is invalid.", exception);
            }
        }

        if (OperatingSystem.IsWindows())
        {
            string Read(string name) =>
                Environment.GetEnvironmentVariable(name, EnvironmentVariableTarget.User) ?? string.Empty;
            return Validate(new OllamaServerSettingsUpdate(
                Read("OLLAMA_MODELS"),
                Read("OLLAMA_HOST"),
                Read("OLLAMA_KEEP_ALIVE"),
                ParsePositive(Read("OLLAMA_CONTEXT_LENGTH")),
                ParsePositive(Read("OLLAMA_MAX_LOADED_MODELS")),
                ParsePositive(Read("OLLAMA_NUM_PARALLEL")),
                ParsePositive(Read("OLLAMA_MAX_QUEUE"))));
        }
        return Empty();
    }

    private static OllamaServerSettingsUpdate Validate(OllamaServerSettingsUpdate update)
    {
        var modelsPath = update.ModelsPath?.Trim() ?? string.Empty;
        if (modelsPath.Length > 1024 || (modelsPath.Length > 0 && !Path.IsPathFullyQualified(modelsPath)))
        {
            throw new ArgumentException("Ollama models path must be an absolute path of at most 1024 characters.");
        }

        var host = update.Host?.Trim() ?? string.Empty;
        if (host.Length > 255 ||
            (host.Length > 0 && (!Uri.TryCreate($"http://{host}", UriKind.Absolute, out var hostUri) ||
                                 hostUri.Port is < 1 or > 65535 ||
                                 hostUri.AbsolutePath != "/" ||
                                 hostUri.UserInfo.Length > 0 ||
                                 hostUri.Query.Length > 0 ||
                                 hostUri.Fragment.Length > 0)))
        {
            throw new ArgumentException("Ollama host must be empty or a host:port value such as 127.0.0.1:11434.");
        }

        var keepAlive = update.KeepAlive?.Trim() ?? string.Empty;
        if (keepAlive.Length > 32 ||
            (keepAlive.Length > 0 && !Regex.IsMatch(keepAlive, @"^-?\d+(?:\.\d+)?(?:ms|s|m|h)?$", RegexOptions.CultureInvariant)))
        {
            throw new ArgumentException("Ollama keep-alive must be a duration or number such as 5m, 0, or -1.");
        }

        ValidateRange(update.ContextLength, 0, 10_000_000, "context length");
        ValidateRange(update.MaxLoadedModels, 0, 128, "max loaded models");
        ValidateRange(update.NumParallel, 0, 128, "parallel requests");
        ValidateRange(update.MaxQueue, 0, 100_000, "max queue");
        return update with { ModelsPath = modelsPath, Host = host, KeepAlive = keepAlive };
    }

    private static Dictionary<string, string> ToVariables(OllamaServerSettingsUpdate settings) => new()
    {
        ["OLLAMA_MODELS"] = settings.ModelsPath ?? string.Empty,
        ["OLLAMA_HOST"] = settings.Host ?? string.Empty,
        ["OLLAMA_KEEP_ALIVE"] = settings.KeepAlive ?? string.Empty,
        ["OLLAMA_CONTEXT_LENGTH"] = FormatPositive(settings.ContextLength),
        ["OLLAMA_MAX_LOADED_MODELS"] = FormatPositive(settings.MaxLoadedModels),
        ["OLLAMA_NUM_PARALLEL"] = FormatPositive(settings.NumParallel),
        ["OLLAMA_MAX_QUEUE"] = FormatPositive(settings.MaxQueue),
    };

    private static OllamaServerSettingsView ToView(OllamaServerSettingsUpdate settings) => new(
        OperatingSystem.IsWindows() ? "Windows" : OperatingSystem.IsMacOS() ? "macOS" : "Unsupported",
        settings.ModelsPath ?? string.Empty,
        settings.Host ?? string.Empty,
        settings.KeepAlive ?? string.Empty,
        settings.ContextLength,
        settings.MaxLoadedModels,
        settings.NumParallel,
        settings.MaxQueue,
        true);

    private static OllamaServerSettingsUpdate Empty() => new("", "", "", 0, 0, 0, 0);
    private static int ParsePositive(string value) => int.TryParse(value, out var parsed) && parsed > 0 ? parsed : 0;
    private static string FormatPositive(int value) => value > 0 ? value.ToString(System.Globalization.CultureInfo.InvariantCulture) : string.Empty;
    private static void ValidateRange(int value, int min, int max, string name)
    {
        if (value < min || value > max) throw new ArgumentException($"Ollama {name} must be between {min} and {max}.");
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };
}
