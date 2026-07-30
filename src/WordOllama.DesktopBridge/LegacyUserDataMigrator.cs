namespace WordOllama.DesktopBridge;

public sealed record LegacyUserDataMigrationResult(
    int SettingsFilesCopied,
    int SkillFilesCopied,
    bool AlreadyCompleted);

public static class LegacyUserDataMigrator
{
    private const string MarkerFileName = ".legacy-user-data-migrated";
    private const int MaximumSkillFiles = 10_000;
    private const long MaximumSkillBytes = 256L * 1024 * 1024;
    private const int MaximumSkillDepth = 16;

    private static readonly string[] SettingsFileNames =
    [
        "provider-settings.json",
        "mcp-settings.json",
        "review-settings.json",
        "agent-recovery.bin",
        "ollama-server-settings.json",
    ];

    public static LegacyUserDataMigrationResult Migrate(
        string legacySettingsRoot,
        string settingsRoot,
        string legacySkillsRoot,
        string skillsRoot)
    {
        var sourceSettings = Path.GetFullPath(legacySettingsRoot);
        var targetSettings = Path.GetFullPath(settingsRoot);
        var sourceSkills = Path.GetFullPath(legacySkillsRoot);
        var targetSkills = Path.GetFullPath(skillsRoot);
        if (PathsEqual(sourceSettings, targetSettings) || PathsEqual(sourceSkills, targetSkills))
        {
            throw new InvalidOperationException("Legacy and WordOllama.JS data roots must be distinct.");
        }

        var markerPath = Path.Combine(targetSettings, MarkerFileName);
        if (File.Exists(markerPath))
        {
            return new LegacyUserDataMigrationResult(0, 0, AlreadyCompleted: true);
        }

        Directory.CreateDirectory(targetSettings);
        var settingsCopied = CopyKnownSettings(sourceSettings, targetSettings);
        var skillFilesCopied = CopySkills(sourceSkills, targetSkills);
        WriteMarker(markerPath);
        return new LegacyUserDataMigrationResult(
            settingsCopied,
            skillFilesCopied,
            AlreadyCompleted: false);
    }

    private static int CopyKnownSettings(string sourceRoot, string targetRoot)
    {
        if (!Directory.Exists(sourceRoot)) return 0;
        var copied = 0;
        foreach (var fileName in SettingsFileNames)
        {
            var source = Path.Combine(sourceRoot, fileName);
            var target = Path.Combine(targetRoot, fileName);
            if (!File.Exists(source) || File.Exists(target) || IsLink(source)) continue;
            CopyFileAtomically(source, target);
            copied++;
        }
        return copied;
    }

    private static int CopySkills(string sourceRoot, string targetRoot)
    {
        if (!Directory.Exists(sourceRoot) || IsLink(sourceRoot)) return 0;
        var sourcePrefix = EnsureTrailingSeparator(sourceRoot);
        var files = Directory.EnumerateFiles(
                sourceRoot,
                "*",
                new EnumerationOptions
                {
                    RecurseSubdirectories = true,
                    IgnoreInaccessible = true,
                    AttributesToSkip = FileAttributes.ReparsePoint,
                })
            .Select(path => new FileInfo(path))
            .Take(MaximumSkillFiles + 1)
            .ToArray();
        if (files.Length > MaximumSkillFiles)
        {
            throw new InvalidDataException(
                $"Legacy Skills migration exceeds {MaximumSkillFiles} files.");
        }

        long totalBytes = 0;
        var copied = 0;
        foreach (var file in files)
        {
            if (IsLink(file.FullName)) continue;
            totalBytes = checked(totalBytes + file.Length);
            if (totalBytes > MaximumSkillBytes)
            {
                throw new InvalidDataException(
                    $"Legacy Skills migration exceeds {MaximumSkillBytes} bytes.");
            }
            if (!file.FullName.StartsWith(sourcePrefix, PathComparison))
            {
                throw new InvalidDataException("Legacy Skill path escaped its source root.");
            }
            var relative = Path.GetRelativePath(sourceRoot, file.FullName);
            if (relative.Split(
                    [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
                    StringSplitOptions.RemoveEmptyEntries).Length > MaximumSkillDepth)
            {
                throw new InvalidDataException(
                    $"Legacy Skill path exceeds {MaximumSkillDepth} levels.");
            }
            var target = Path.GetFullPath(Path.Combine(targetRoot, relative));
            if (!target.StartsWith(EnsureTrailingSeparator(targetRoot), PathComparison))
            {
                throw new InvalidDataException("Legacy Skill target escaped the WordOllama.JS root.");
            }
            if (File.Exists(target)) continue;
            CopyFileAtomically(file.FullName, target);
            copied++;
        }
        return copied;
    }

    private static void CopyFileAtomically(string source, string target)
    {
        var parent = Path.GetDirectoryName(target)
            ?? throw new InvalidOperationException("Migration target has no parent directory.");
        Directory.CreateDirectory(parent);
        var temporary = target + ".tmp." + Guid.NewGuid().ToString("N");
        try
        {
            File.Copy(source, temporary, overwrite: false);
            RestrictUnixPermissions(temporary);
            File.Move(temporary, target, overwrite: false);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static void WriteMarker(string markerPath)
    {
        var temporary = markerPath + ".tmp." + Guid.NewGuid().ToString("N");
        try
        {
            File.WriteAllText(
                temporary,
                DateTimeOffset.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture));
            RestrictUnixPermissions(temporary);
            File.Move(temporary, markerPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static bool IsLink(string path) =>
        (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;

    private static void RestrictUnixPermissions(string path)
    {
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }

    private static bool PathsEqual(string left, string right) =>
        string.Equals(
            left.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            right.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            PathComparison);

    private static string EnsureTrailingSeparator(string path) =>
        Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)) + Path.DirectorySeparatorChar;

    private static StringComparison PathComparison =>
        OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;
}
