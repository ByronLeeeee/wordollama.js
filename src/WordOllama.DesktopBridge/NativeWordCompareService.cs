using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using WordOllama.Contracts;

namespace WordOllama.DesktopBridge;

public sealed class NativeWordCompareService
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    public bool IsAvailable => OperatingSystem.IsWindows() &&
        Type.GetTypeFromProgID("Word.Application") is not null;

    public async Task<NativeWordCompareResponse> CompareAsync(
        byte[] original,
        byte[] revised,
        CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsWindows() || !IsAvailable)
        {
            return new(false, Reason: "Microsoft Word desktop automation is not available on this system.");
        }

        return await CompareWindowsAsync(original, revised, cancellationToken);
    }

    [SupportedOSPlatform("windows")]
    private async Task<NativeWordCompareResponse> CompareWindowsAsync(
        byte[] original,
        byte[] revised,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return await RunStaAsync(() => CompareOnStaThread(original, revised), cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    [SupportedOSPlatform("windows")]
    private static Task<NativeWordCompareResponse> RunStaAsync(
        Func<NativeWordCompareResponse> action,
        CancellationToken cancellationToken)
    {
        var completion = new TaskCompletionSource<NativeWordCompareResponse>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                completion.TrySetResult(action());
            }
            catch (OperationCanceledException)
            {
                completion.TrySetCanceled(cancellationToken);
            }
            catch (Exception exception)
            {
                completion.TrySetException(exception);
            }
        })
        {
            IsBackground = true,
            Name = "WordOllama.NativeWordCompare",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task;
    }

    [SupportedOSPlatform("windows")]
    private static NativeWordCompareResponse CompareOnStaThread(byte[] original, byte[] revised)
    {
        var workRoot = Path.Combine(
            Path.GetTempPath(),
            "WordOllama.JS",
            "native-compare",
            Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workRoot);
        var originalPath = Path.Combine(workRoot, "original.docx");
        var revisedPath = Path.Combine(workRoot, "revised.docx");
        var outputPath = Path.Combine(workRoot, "WordOllama-native-comparison.docx");
        File.WriteAllBytes(originalPath, original);
        File.WriteAllBytes(revisedPath, revised);

        object? application = null;
        object? originalDocument = null;
        object? revisedDocument = null;
        object? comparisonDocument = null;
        try
        {
            var wordType = Type.GetTypeFromProgID("Word.Application")
                ?? throw new PlatformNotSupportedException("Microsoft Word is not installed.");
            application = Activator.CreateInstance(wordType)
                ?? throw new InvalidOperationException("Microsoft Word could not be started.");
            dynamic word = application;
            word.Visible = false;
            word.DisplayAlerts = 0;
            word.AutomationSecurity = 3;
            originalDocument = word.Documents.Open(originalPath, ReadOnly: true, AddToRecentFiles: false);
            revisedDocument = word.Documents.Open(revisedPath, ReadOnly: true, AddToRecentFiles: false);
            comparisonDocument = word.CompareDocuments(originalDocument, revisedDocument);
            ((dynamic)comparisonDocument).SaveAs2(outputPath, 16, AddToRecentFiles: false);
            CloseComDocument(comparisonDocument);
            comparisonDocument = null;
            CloseComDocument(originalDocument);
            originalDocument = null;
            CloseComDocument(revisedDocument);
            revisedDocument = null;
            word.Quit(false);
            ReleaseComObject(application);
            application = null;

            return new(
                true,
                Path.GetFileName(outputPath),
                Convert.ToBase64String(File.ReadAllBytes(outputPath)));
        }
        finally
        {
            CloseComDocument(comparisonDocument);
            CloseComDocument(originalDocument);
            CloseComDocument(revisedDocument);
            if (application is not null)
            {
                try { ((dynamic)application).Quit(false); } catch { }
                ReleaseComObject(application);
            }
            try { Directory.Delete(workRoot, recursive: true); } catch { }
        }
    }

    [SupportedOSPlatform("windows")]
    private static void CloseComDocument(object? document)
    {
        if (document is null) return;
        try { ((dynamic)document).Close(false); } catch { }
        ReleaseComObject(document);
    }

    [SupportedOSPlatform("windows")]
    private static void ReleaseComObject(object value)
    {
        if (Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value);
    }
}
