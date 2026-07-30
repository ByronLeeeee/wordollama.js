import { X } from "lucide-react";

function ComparePanel() {
  const docxAccept =
    ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return (
    <div className="settings-panel" data-settings-panel="advanced">
      <section className="settings-section compare-card">
        <h3 data-i18n="taskpane.utility.compare.title">DOCX comparison</h3>
        <label htmlFor="compare-original" data-i18n="taskpane.utility.compare.original">
          Original DOCX
        </label>
        <input
          id="compare-original"
          className="file-field"
          type="file"
          accept={docxAccept}
        />
        <label htmlFor="compare-revised" data-i18n="taskpane.utility.compare.revised">
          Revised DOCX
        </label>
        <input
          id="compare-revised"
          className="file-field"
          type="file"
          accept={docxAccept}
        />
        <label className="checkbox-row">
          <input id="compare-ignore-case" type="checkbox" />
          <span data-i18n="taskpane.utility.compare.ignoreCase">
            Ignore English letter case
          </span>
        </label>
        <div className="action-row">
          <button id="compare-run" data-i18n="taskpane.utility.compare.run">
            Compare documents
          </button>
          <button
            id="compare-copy"
            className="secondary-button"
            disabled
            data-i18n="taskpane.utility.copyJson"
          >
            Copy JSON
          </button>
        </div>
        <p id="compare-summary" />
        <div id="compare-review-list" className="empty-panel" />
        <label className="checkbox-row">
          <input id="compare-apply-confirm" type="checkbox" disabled />
          <span data-i18n="taskpane.utility.compare.confirmApply">
            I confirm the open document is a copy of the original and agree to
            apply selected items as Word revisions
          </span>
        </label>
        <button
          id="compare-apply"
          type="button"
          disabled
          data-i18n="taskpane.utility.compare.apply"
        >
          Apply selected items
        </button>
        <p id="compare-apply-status" className="muted" />
        <details>
          <summary data-i18n="taskpane.utility.compare.preview">
            Difference text preview
          </summary>
          <pre id="compare-output" />
        </details>
      </section>
    </div>
  );
}

function DiagnosticLogPanel() {
  return (
    <section className="settings-section">
      <h3 data-i18n="taskpane.utility.diagnostics.logTitle">Runtime log</h3>
      <label className="checkbox-row">
        <input id="setting-diagnostic-logging" type="checkbox" />
        <span data-i18n="taskpane.utility.diagnostics.logToggle">
          Record runtime events and errors from this task pane
        </span>
      </label>
      <div className="action-row wrap">
        <button id="save-diagnostic-settings" data-i18n="taskpane.utility.save">
          Save
        </button>
        <button
          id="copy-diagnostic-log"
          className="secondary-button"
          data-i18n="taskpane.utility.diagnostics.copyLog"
        >
          Copy log
        </button>
        <button
          id="clear-diagnostic-log"
          className="text-button"
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
    <details className="settings-section developer-section" open={open}>
      <summary data-i18n={titleKey}>{title}</summary>
      <p className="warning" data-i18n={warningKey}>
        {warning}
      </p>
      <label className="checkbox-row">
        <input id={`${kind}-confirm`} type="checkbox" />
        <span data-i18n="taskpane.utility.diagnostics.discardConfirm">
          I confirm the current document is unsaved and can be discarded
        </span>
      </label>
      <div className="action-row">
        <button id={`${kind}-run`} disabled data-i18n={runKey}>
          {runLabel}
        </button>
        <button
          id={`${kind}-copy`}
          className="secondary-button"
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
        runLabel="Run the 36-tool golden suite"
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
          className="icon-button"
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
