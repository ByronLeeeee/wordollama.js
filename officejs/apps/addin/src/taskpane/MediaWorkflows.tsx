import { WorkspaceHeader } from "./WorkspaceHeader";

function HtmlAppWorkflow() {
  return (
    <section id="html-workflow-workspace" className="text-workflow-workspace" hidden>
      <WorkspaceHeader
        closeId="close-html-workflow"
        title={<h2 data-i18n="taskpane.html.title">HTML app</h2>}
      />
      <div className="form-group">
        <label htmlFor="html-app-prompt" data-i18n="taskpane.html.requirements">
          App requirements
        </label>
        <textarea
          id="html-app-prompt"
          rows={4}
          placeholder="Describe the page, interactions, and visual requirements…"
          data-i18n-placeholder="taskpane.html.requirementsPlaceholder"
        />
      </div>
      <div className="action-row">
        <button
          id="html-app-generate"
          type="button"
          data-i18n="taskpane.common.startGenerating"
        >
          Start generating
        </button>
        <button
          id="html-app-cancel"
          className="secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <div className="form-group">
        <label htmlFor="html-app-code" data-i18n="taskpane.html.code">
          HTML code
        </label>
        <textarea
          id="html-app-code"
          className="code-editor"
          rows={10}
          spellCheck={false}
        />
      </div>
      <div className="action-row wrap">
        <button
          id="html-app-preview"
          type="button"
          disabled
          data-i18n="taskpane.html.runPreview"
        >
          Run preview
        </button>
        <button
          id="html-app-download"
          className="secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.html.export"
        >
          Export .html
        </button>
      </div>
      <section id="html-preview-section" className="workflow-preview-section" hidden>
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
      <section className="workflow-preview-section">
        <div className="section-title-row">
          <h3 data-i18n="taskpane.html.library">App library</h3>
          <span id="html-library-status" className="muted" />
        </div>
        <select id="html-app-library">
          <option value="" data-i18n="taskpane.html.selectSaved">
            Select a saved app…
          </option>
        </select>
        <label htmlFor="html-app-name" data-i18n="taskpane.html.name">
          App name
        </label>
        <input
          id="html-app-name"
          maxLength={80}
          placeholder="For example: Contract term calculator"
          data-i18n-placeholder="taskpane.html.namePlaceholder"
        />
        <div className="action-row wrap">
          <button
            id="html-app-save"
            type="button"
            disabled
            data-i18n="taskpane.html.save"
          >
            Save / overwrite
          </button>
          <button
            id="html-app-delete"
            className="text-button"
            type="button"
            disabled
            data-i18n="taskpane.common.delete"
          >
            Delete
          </button>
        </div>
      </section>
    </section>
  );
}

function ImageWorkflow() {
  return (
    <section id="image-workflow-workspace" className="text-workflow-workspace" hidden>
      <WorkspaceHeader
        closeId="close-image-workflow"
        title={<h2 data-i18n="taskpane.image.title">Image understanding</h2>}
      />
      <div className="form-group">
        <label htmlFor="image-file" data-i18n="taskpane.image.select">
          Select image
        </label>
        <input
          id="image-file"
          className="file-field"
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
      <div className="form-group">
        <label htmlFor="image-prompt" data-i18n="taskpane.image.requirements">
          Analysis requirements
        </label>
        <textarea
          id="image-prompt"
          rows={3}
          placeholder="For example: Extract the table and explain anomalous data…"
          data-i18n-placeholder="taskpane.image.requirementsPlaceholder"
        />
      </div>
      <div className="action-row">
        <button
          id="image-analyze"
          type="button"
          disabled
          data-i18n="taskpane.image.start"
        >
          Start analysis
        </button>
        <button
          id="image-cancel"
          className="secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <div className="form-group">
        <label htmlFor="image-result" data-i18n="taskpane.image.result">
          Analysis result
        </label>
        <textarea id="image-result" rows={8} />
      </div>
      <div className="action-row wrap">
        <button
          id="image-insert"
          type="button"
          disabled
          data-i18n="taskpane.common.insertWord"
        >
          Insert into Word
        </button>
        <button
          id="image-copy"
          className="secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.image.copyResult"
        >
          Copy result
        </button>
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
