import { FileText, Upload, X } from "lucide-react";
import { FeatureIcon } from "./FeatureIcon";

function ComparePanel() {
  const docxAccept =
    ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return (
    <div className="settings-panel" data-settings-panel="advanced">
      <section className="settings-section compare-card">
        <div className="compare-heading">
          <div className="compare-heading-icon" aria-hidden="true">
            <FeatureIcon name="compare" size={16} />
          </div>
          <div>
            <h3 data-i18n="taskpane.utility.compare.title">AI document revision analysis</h3>
            <p className="muted" data-i18n="taskpane.utility.compare.description">
              Upload the original and revised DOCX files. AI will focus on what changed and why it matters.
            </p>
          </div>
        </div>

        <div className="file-picker-grid">
          <div className="file-picker-card">
            <div className="file-picker-heading">
              <span className="file-picker-icon" aria-hidden="true"><FileText size={16} /></span>
              <span className="file-picker-label" data-i18n="taskpane.utility.compare.original">Original DOCX</span>
            </div>
            <input
              id="compare-original"
              className="file-picker-input"
              type="file"
              accept={docxAccept}
            />
            <label htmlFor="compare-original" className="file-picker-trigger">
              <Upload size={14} aria-hidden="true" />
              <span data-i18n="taskpane.utility.compare.chooseFile">Choose file</span>
            </label>
            <span id="compare-original-name" className="file-picker-name" data-i18n="taskpane.utility.compare.originalEmpty">
              No original file selected
            </span>
          </div>

          <div className="file-picker-card">
            <div className="file-picker-heading">
              <span className="file-picker-icon" aria-hidden="true"><FileText size={16} /></span>
              <span className="file-picker-label" data-i18n="taskpane.utility.compare.revised">Revised DOCX</span>
            </div>
            <input
              id="compare-revised"
              className="file-picker-input"
              type="file"
              accept={docxAccept}
            />
            <label htmlFor="compare-revised" className="file-picker-trigger">
              <Upload size={14} aria-hidden="true" />
              <span data-i18n="taskpane.utility.compare.chooseFile">Choose file</span>
            </label>
            <span id="compare-revised-name" className="file-picker-name" data-i18n="taskpane.utility.compare.revisedEmpty">
              No revised file selected
            </span>
          </div>
        </div>

        <div className="action-row compare-actions">
          <button id="compare-run" className="btn btn-primary btn-sm" data-i18n="taskpane.utility.compare.run">
            Analyze revisions
          </button>
          <button id="compare-native-word" className="btn btn-sm" data-i18n="taskpane.utility.compare.nativeWord">
            Word native comparison
          </button>
        </div>
        <p id="compare-summary" />
        <div className="compare-analysis-shell">
          <div className="section-title-row">
            <h3 data-i18n="taskpane.utility.compare.analysisTitle">AI analysis</h3>
            <span id="compare-analysis-status" className="muted" />
          </div>
          <article
            id="compare-analysis"
            className="compare-analysis empty-panel"
            aria-live="polite"
            data-i18n="taskpane.utility.compare.analysisEmpty"
          >
            Select two DOCX files to begin.
          </article>
        </div>
      </section>
    </div>
  );
}

function DiagnosticLogPanel() {
  return (
    <section className="settings-section">
      <h3 data-i18n="taskpane.utility.diagnostics.logTitle">Runtime log</h3>
      <label className="checkbox-row">
        <input id="setting-diagnostic-logging" className="checkbox checkbox-primary checkbox-sm" type="checkbox" />
        <span data-i18n="taskpane.utility.diagnostics.logToggle">
          Record runtime events and errors from this task pane
        </span>
      </label>
      <div className="action-row wrap">
        <button id="save-diagnostic-settings" className="btn btn-primary btn-sm" data-i18n="taskpane.utility.save">
          Save
        </button>
        <button
          id="copy-diagnostic-log"
          className="btn btn-sm secondary-button"
          data-i18n="taskpane.utility.diagnostics.copyLog"
        >
          Copy log
        </button>
        <button
          id="clear-diagnostic-log"
          className="btn btn-ghost btn-xs text-button"
          data-i18n="taskpane.utility.diagnostics.clearLog"
        >
          Clear log
        </button>
      </div>
      <p id="diagnostic-settings-status" />
    </section>
  );
}

function AcceptancePanel({
  kind,
  titleKey,
  title,
  warningKey,
  warning,
  runKey,
  runLabel,
  open,
}: {
  kind: "golden" | "long-document" | "revision-host";
  titleKey: string;
  title: string;
  warningKey: string;
  warning: string;
  runKey: string;
  runLabel: string;
  open?: boolean;
}) {
  return (
    <details className="collapse collapse-arrow settings-section developer-section" open={open}>
      <summary className="collapse-title" data-i18n={titleKey}>{title}</summary>
      <p className="warning" data-i18n={warningKey}>
        {warning}
      </p>
      <label className="checkbox-row">
        <input id={`${kind}-confirm`} className="checkbox checkbox-primary checkbox-sm" type="checkbox" />
        <span data-i18n="taskpane.utility.diagnostics.discardConfirm">
          I confirm the current document is unsaved and can be discarded
        </span>
      </label>
      <div className="action-row">
        <button id={`${kind}-run`} className="btn btn-primary btn-sm" disabled data-i18n={runKey}>
          {runLabel}
        </button>
        <button
          id={`${kind}-copy`}
          className="btn btn-sm secondary-button"
          disabled
          data-i18n="taskpane.utility.diagnostics.copyReport"
        >
          Copy JSON report
        </button>
      </div>
      <p
        id={`${kind}-summary`}
        data-i18n="taskpane.utility.diagnostics.notRun"
      >
        Not run
      </p>
      <pre id={`${kind}-output`} />
    </details>
  );
}

function DiagnosticsPanel() {
  return (
    <div className="settings-panel" data-settings-panel="diagnostics">
      <DiagnosticLogPanel />
      <AcceptancePanel
        kind="golden"
        titleKey="taskpane.utility.diagnostics.goldenTitle"
        title="Office.js tool acceptance"
        warningKey="taskpane.utility.diagnostics.blankWarning"
        warning="Run only in an unsaved blank document that can be discarded."
        runKey="taskpane.utility.diagnostics.runGolden"
        runLabel="Run the 38-tool golden suite"
        open
      />
      <AcceptancePanel
        kind="long-document"
        titleKey="taskpane.utility.diagnostics.longTitle"
        title="Long document and stable-anchor acceptance"
        warningKey="taskpane.utility.diagnostics.longWarning"
        warning="This replaces the document with 1,000- and 5,000-paragraph fixtures. Run only in an unsaved blank document that can be discarded."
        runKey="taskpane.utility.diagnostics.runLong"
        runLabel="Run 1,000/5,000-paragraph acceptance"
      />
      <AcceptancePanel
        kind="revision-host"
        titleKey="taskpane.utility.diagnostics.revisionTitle"
        title="Word revision API acceptance"
        warningKey="taskpane.utility.diagnostics.revisionWarning"
        warning="This replaces the document and creates, locates, accepts, and rejects test revisions. Run only in an unsaved blank document that can be discarded."
        runKey="taskpane.utility.diagnostics.runRevision"
        runLabel="Run revision API acceptance"
      />
    </div>
  );
}

export function UtilityDialog() {
  return (
    <dialog id="settings-dialog" className="settings-dialog">
      <div className="dialog-header">
        <div className="settings-brand">
          <span className="settings-brand-mark" aria-hidden="true">
            W
          </span>
          <div>
            <h2 id="dialog-title">WordOllama.JS</h2>
            <span className="muted" data-i18n="taskpane.utility.subtitle">
              Diagnostics and document tools
            </span>
          </div>
        </div>
        <button
          id="close-settings"
          className="btn btn-ghost btn-square btn-sm icon-button"
          type="button"
          aria-label="Close"
          data-i18n-aria-label="taskpane.common.close"
        >
          <X size={17} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <ComparePanel />
      <DiagnosticsPanel />
    </dialog>
  );
}
