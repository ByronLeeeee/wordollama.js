using System.Drawing;

namespace WordOllama.WindowsInstaller;

internal sealed record InstallerWizardOptions(bool StartBridge);

internal sealed record InstallerWizardResult(
    bool Success,
    bool RestartWord,
    string? Error);

internal sealed class InstallerWizard : Form
{
    private readonly Func<InstallerWizardOptions, InstallerWizardResult> install;
    private readonly Panel content = new() { Dock = DockStyle.Fill, Padding = new Padding(34, 28, 34, 20) };
    private readonly Button backButton = new() { AutoSize = true, MinimumSize = new Size(92, 34) };
    private readonly Button nextButton = new() { AutoSize = true, MinimumSize = new Size(92, 34) };
    private readonly Button cancelButton = new() { AutoSize = true, MinimumSize = new Size(92, 34) };
    private readonly CheckBox consent = new() { AutoSize = true, MaximumSize = new Size(610, 0) };
    private readonly CheckBox startBridge = new() { AutoSize = true, Checked = true };
    private readonly ProgressBar progress = new() { Dock = DockStyle.Top, Height = 18, Style = ProgressBarStyle.Marquee };
    private readonly string version;
    private readonly string installRoot;
    private int page;
    private bool installing;

    public int ExitCode { get; private set; } = 2;

    public InstallerWizard(
        string version,
        string installRoot,
        Func<InstallerWizardOptions, InstallerWizardResult> install)
    {
        this.version = version;
        this.installRoot = installRoot;
        this.install = install;

        Text = InstallerText.Title;
        ClientSize = new Size(720, 480);
        MinimumSize = new Size(680, 450);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowIcon = true;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

        var header = new Panel
        {
            Dock = DockStyle.Top,
            Height = 72,
            BackColor = Color.FromArgb(37, 99, 190),
            Padding = new Padding(28, 0, 20, 0),
        };
        header.Controls.Add(new Label
        {
            Dock = DockStyle.Fill,
            ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 17F, FontStyle.Bold, GraphicsUnit.Point),
            TextAlign = ContentAlignment.MiddleLeft,
            Text = "WordOllama.JS",
        });

        var footer = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 62,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(12, 13, 20, 10),
            WrapContents = false,
        };
        backButton.Text = InstallerText.Back;
        nextButton.Text = InstallerText.Next;
        cancelButton.Text = InstallerText.Cancel;
        backButton.Click += (_, _) => { page = Math.Max(0, page - 1); RenderPage(); };
        nextButton.Click += async (_, _) => await AdvanceAsync();
        cancelButton.Click += (_, _) => Close();
        footer.Controls.Add(cancelButton);
        footer.Controls.Add(nextButton);
        footer.Controls.Add(backButton);

        Controls.Add(content);
        Controls.Add(footer);
        Controls.Add(header);
        FormClosing += (_, eventArgs) =>
        {
            if (installing) eventArgs.Cancel = true;
        };
        RenderPage();
    }

    private async Task AdvanceAsync()
    {
        if (page == 0)
        {
            page = 1;
            RenderPage();
            return;
        }
        if (page == 1)
        {
            if (!consent.Checked)
            {
                System.Media.SystemSounds.Exclamation.Play();
                consent.Focus();
                return;
            }
            page = 2;
            installing = true;
            RenderPage();
            InstallerWizardResult result;
            try
            {
                result = await Task.Run(() => install(new InstallerWizardOptions(startBridge.Checked)));
            }
            catch (Exception exception)
            {
                result = new InstallerWizardResult(false, false, exception.Message);
            }
            installing = false;
            if (!result.Success)
            {
                ExitCode = 1;
                ShowFailure(result.Error ?? InstallerText.Cancelled);
                return;
            }
            ExitCode = 0;
            page = 3;
            Tag = result.RestartWord;
            RenderPage();
            return;
        }
        if (page == 3) Close();
    }

    private void RenderPage()
    {
        content.SuspendLayout();
        content.Controls.Clear();
        backButton.Visible = page is 1;
        cancelButton.Visible = page < 2;
        nextButton.Enabled = !installing;
        nextButton.Text = page switch
        {
            1 => InstallerText.Install,
            3 => InstallerText.Finish,
            _ => InstallerText.Next,
        };
        AcceptButton = nextButton;
        CancelButton = cancelButton.Visible ? cancelButton : null;

        if (page == 0)
        {
            AddBody(InstallerText.WelcomeTitle, InstallerText.WelcomeBody);
        }
        else if (page == 1)
        {
            RenderReview();
        }
        else if (page == 2)
        {
            AddBody(InstallerText.InstallingTitle, InstallerText.InstallingBody);
            content.Controls.Add(progress);
            progress.BringToFront();
        }
        else
        {
            var body = InstallerText.CompleteBody;
            if (Tag is true) body += Environment.NewLine + Environment.NewLine + InstallerText.CompleteRestartWord;
            AddBody(InstallerText.CompleteTitle, body);
        }
        content.ResumeLayout(performLayout: true);
    }

    private void RenderReview()
    {
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 8,
            AutoScroll = true,
        };
        layout.RowStyles.Clear();
        layout.Controls.Add(Heading(InstallerText.ReviewTitle));
        layout.Controls.Add(Paragraph(InstallerText.ReviewBody));
        layout.Controls.Add(Detail(InstallerText.VersionLabel, version));
        layout.Controls.Add(Detail(InstallerText.InstallLocationLabel, installRoot));
        layout.Controls.Add(Detail(InstallerText.ComponentsLabel, InstallerText.ComponentsValue));
        consent.Text = InstallerText.CertificateConsent;
        consent.Margin = new Padding(0, 14, 0, 8);
        layout.Controls.Add(consent);
        startBridge.Text = InstallerText.StartAfterInstall;
        startBridge.Margin = new Padding(0, 4, 0, 0);
        layout.Controls.Add(startBridge);
        content.Controls.Add(layout);
    }

    private void AddBody(string title, string body)
    {
        var bodyLabel = Paragraph(body);
        bodyLabel.Dock = DockStyle.Fill;
        var titleLabel = Heading(title);
        titleLabel.Dock = DockStyle.Top;
        content.Controls.Add(bodyLabel);
        content.Controls.Add(titleLabel);
    }

    private static Label Heading(string text) => new()
    {
        AutoSize = true,
        Font = new Font("Segoe UI Semibold", 17F, FontStyle.Bold, GraphicsUnit.Point),
        ForeColor = Color.FromArgb(25, 34, 50),
        Margin = new Padding(0, 0, 0, 14),
        Text = text,
    };

    private static Label Paragraph(string text) => new()
    {
        AutoSize = true,
        MaximumSize = new Size(620, 0),
        Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point),
        ForeColor = Color.FromArgb(74, 85, 104),
        Margin = new Padding(0, 0, 0, 16),
        Text = text,
    };

    private static Control Detail(string label, string value)
    {
        var panel = new TableLayoutPanel
        {
            AutoSize = true,
            ColumnCount = 1,
            Dock = DockStyle.Top,
            Margin = new Padding(0, 5, 0, 8),
        };
        panel.Controls.Add(new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 9F, FontStyle.Bold, GraphicsUnit.Point),
            Text = label,
        });
        panel.Controls.Add(new Label
        {
            AutoSize = true,
            MaximumSize = new Size(620, 0),
            ForeColor = Color.FromArgb(74, 85, 104),
            Text = value,
        });
        return panel;
    }

    private void ShowFailure(string detail)
    {
        MessageBox.Show(
            this,
            InstallerText.Failed(detail),
            InstallerText.Title,
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
        page = 1;
        RenderPage();
    }
}
