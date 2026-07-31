import { Code2, Image as ImageIcon } from "lucide-react";
import { WorkspaceHeader } from "./WorkspaceHeader";

function HtmlAppWorkflow() {
  return (
    <section id="html-workflow-workspace" className="text-workflow-workspace task-workspace" hidden>
      <WorkspaceHeader
        closeId="close-html-workflow"
        title={<span className="task-title"><Code2 size={18} aria-hidden="true" /><h2 data-i18n="taskpane.html.title">HTML app</h2></span>}
      />
      <div className="card card-border form-group task-panel">
        <label htmlFor="html-app-prompt" data-i18n="taskpane.html.requirements">
          App requirements
        </label>
        <textarea
          id="html-app-prompt"
          className="textarea"
          rows={4}
          placeholder="Describe the page, interactions, and visual requirements…"
          data-i18n-placeholder="taskpane.html.requirementsPlaceholder"
        />
      </div>
      <div className="task-primary-actions">
        <button
          id="html-app-generate"
          className="btn btn-primary btn-sm"
          type="button"
          data-i18n="taskpane.common.startGenerating"
        >
          Start generating
        </button>
        <button
          id="html-app-cancel"
          className="btn btn-sm secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <div className="card card-border form-group task-panel task-output-panel">
        <div className="task-panel-heading">
          <label htmlFor="html-app-code" data-i18n="taskpane.html.code">
          HTML code
          </label>
        </div>
        <textarea
          id="html-app-code"
          className="textarea code-editor"
          rows={10}
          spellCheck={false}
        />
      </div>
      <div className="action-row wrap">
        <button
          id="html-app-preview"
          className="btn btn-primary btn-sm"
          type="button"
          disabled
          data-i18n="taskpane.html.runPreview"
        >
          Run preview
        </button>
        <button
          id="html-app-download"
          className="btn btn-sm secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.html.export"
        >
          Export .html
        </button>
      </div>
      <section id="html-preview-section" className="card card-border workflow-preview-section task-panel" hidden>
        <div className="section-title-row">
          <h3 data-i18n="taskpane.common.preview">Preview</h3>
        </div>
        <iframe
          id="html-app-frame"
          className="html-app-frame"
          sandbox="allow-scripts"
          title="HTML app preview"
          data-i18n-title="taskpane.html.previewTitle"
        />
      </section>
      <details className="collapse collapse-arrow task-options">
        <summary className="collapse-title" data-i18n="taskpane.html.library">App library</summary>
        <section className="collapse-content task-options-body">
        <div className="section-title-row">
          <h3 data-i18n="taskpane.html.library">App library</h3>
          <span id="html-library-status" className="muted" />
        </div>
        <select id="html-app-library" className="select select-sm">
          <option value="" data-i18n="taskpane.html.selectSaved">
            Select a saved app…
          </option>
        </select>
        <label htmlFor="html-app-name" data-i18n="taskpane.html.name">
          App name
        </label>
        <input
          id="html-app-name"
          className="input input-sm"
          maxLength={80}
          placeholder="For example: Contract term calculator"
          data-i18n-placeholder="taskpane.html.namePlaceholder"
        />
        <div className="action-row wrap">
          <button
            id="html-app-save"
            className="btn btn-primary btn-sm"
            type="button"
            disabled
            data-i18n="taskpane.html.save"
          >
            Save / overwrite
          </button>
          <button
            id="html-app-delete"
            className="btn btn-ghost btn-xs text-button"
            type="button"
            disabled
            data-i18n="taskpane.common.delete"
          >
            Delete
          </button>
        </div>
        </section>
      </details>
    </section>
  );
}

function ImageWorkflow() {
  return (
    <section id="image-workflow-workspace" className="text-workflow-workspace task-workspace" hidden>
      <WorkspaceHeader
        closeId="close-image-workflow"
        title={<span className="task-title"><ImageIcon size={18} aria-hidden="true" /><h2 data-i18n="taskpane.image.title">Image understanding</h2></span>}
      />
      <div className="form-group task-upload-control">
        <label htmlFor="image-file" data-i18n="taskpane.image.select">
          Select image
        </label>
        <input
          id="image-file"
          className="file-input file-input-sm file-field"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
        />
      </div>
      <div id="image-preview-card" className="image-preview-card empty-panel">
        <span id="image-empty-state" data-i18n="taskpane.image.preview">
          Image preview
        </span>
        <img
          id="image-preview"
          alt="Image selected for analysis"
          data-i18n-alt="taskpane.image.previewAlt"
          hidden
        />
      </div>
      <p id="image-file-status" className="muted" />
      <div className="form-group task-instructions">
        <label htmlFor="image-prompt" data-i18n="taskpane.image.requirements">
          Analysis requirements
        </label>
        <textarea
          id="image-prompt"
          className="textarea"
          rows={3}
          placeholder="For example: Extract the table and explain anomalous data…"
          data-i18n-placeholder="taskpane.image.requirementsPlaceholder"
        />
      </div>
      <div className="task-primary-actions">
        <button
          id="image-analyze"
          className="btn btn-primary btn-sm"
          type="button"
          disabled
          data-i18n="taskpane.image.start"
        >
          Start analysis
        </button>
        <button
          id="image-cancel"
          className="btn btn-sm secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <div className="card card-border form-group task-panel task-output-panel">
        <div className="task-panel-heading">
          <label htmlFor="image-result" data-i18n="taskpane.image.result">
          Analysis result
          </label>
        </div>
        <textarea id="image-result" className="textarea" rows={8} />
        <div className="task-result-actions">
        <button
          id="image-insert"
          className="btn btn-primary btn-sm"
          type="button"
          disabled
          data-i18n="taskpane.common.insertWord"
        >
          Insert into Word
        </button>
        <button
          id="image-copy"
          className="btn btn-sm secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.image.copyResult"
        >
          Copy result
        </button>
        </div>
      </div>
    </section>
  );
}

export function MediaWorkflows() {
  return (
    <>
      <HtmlAppWorkflow />
      <ImageWorkflow />
    </>
  );
}
