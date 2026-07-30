using System.Diagnostics;

namespace WordOllama.DesktopBridge;

public interface ISystemFolderLauncher
{
    void Open(string directory);
}

public sealed class SystemFolderLauncher : ISystemFolderLauncher
{
    public void Open(string directory)
    {
        var fullPath = Path.GetFullPath(directory);
        Directory.CreateDirectory(fullPath);

        ProcessStartInfo startInfo;
        if (OperatingSystem.IsWindows())
        {
            startInfo = new ProcessStartInfo
            {
                FileName = fullPath,
                UseShellExecute = true,
            };
        }
        else if (OperatingSystem.IsMacOS())
        {
            startInfo = new ProcessStartInfo
            {
                FileName = "/usr/bin/open",
                UseShellExecute = false,
            };
            startInfo.ArgumentList.Add(fullPath);
        }
        else
        {
            throw new PlatformNotSupportedException("Opening the Skill directory is supported on Windows and macOS.");
        }

        if (Process.Start(startInfo) is null)
        {
            throw new InvalidOperationException("The operating system did not open the Skill directory.");
        }
    }
}
