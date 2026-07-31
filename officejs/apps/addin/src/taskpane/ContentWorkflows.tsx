import { ClipboardPaste, FileText, Table2, WandSparkles } from "lucide-react";
import { WorkspaceHeader } from "./WorkspaceHeader";

function TextWorkflow() {
  return (
    <section id="text-workflow-workspace" className="text-workflow-workspace task-workspace" hidden>
      <WorkspaceHeader
        closeId="close-text-workflow"
        title={
          <span className="task-title">
            <WandSparkles size={18} aria-hidden="true" />
            <h2 id="text-workflow-title" data-i18n="taskpane.text.title">
              Text workflow
            </h2>
          </span>
        }
      />
      <article className="card card-border task-panel">
        <div className="task-panel-heading">
          <h3 data-i18n="taskpane.text.scope">Scope</h3>
          <div className="task-panel-tools">
          <button
            id="workflow-load-selection"
            className="btn btn-sm secondary-button"
            type="button"
            data-i18n="taskpane.common.loadSelection"
          >
            Load selection
          </button>
          <button
            id="workflow-load-document"
            className="btn btn-sm secondary-button"
            type="button"
            data-i18n="taskpane.common.loadDocument"
          >
            Load document
          </button>
          <button
            id="workflow-clear-source"
            className="btn btn-ghost btn-xs text-button task-tertiary-action"
            type="button"
            data-i18n="taskpane.text.requirementOnly"
          >
            Use requirements only
          </button>
          </div>
        </div>
        <p id="workflow-source-status" className="task-status" />
        <blockquote id="workflow-source-preview" className="workflow-source-preview" hidden />
      </article>
      <div className="form-group task-instructions">
        <label htmlFor="workflow-instruction" data-i18n="taskpane.text.instructions">
          Instructions
        </label>
        <textarea
          id="workflow-instruction"
          className="textarea"
          rows={4}
          placeholder="Add tone, length, terminology, or formatting requirements…"
          data-i18n-placeholder="taskpane.text.instructionsPlaceholder"
        />
      </div>
      <div className="task-primary-actions">
        <button id="workflow-generate" className="btn btn-primary btn-sm" type="button" data-i18n="taskpane.common.generate">
          Generate
        </button>
        <button
          id="workflow-cancel"
          className="btn btn-sm secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <section id="workflow-output" className="card card-border generated-output task-panel task-output-panel" hidden>
        <div className="task-panel-heading">
          <label htmlFor="workflow-result" data-i18n="taskpane.common.generatedResult">
            Generated result
          </label>
          <button
            id="workflow-copy"
            className="btn btn-ghost btn-xs text-button"
            type="button"
            data-i18n="taskpane.common.copy"
          >
            Copy
          </button>
        </div>
        <textarea id="workflow-result" className="textarea" rows={10} />
        <div className="task-result-actions">
          <button
            id="workflow-apply-default"
            className="btn btn-primary btn-sm"
            type="button"
            data-i18n="taskpane.text.applyDefault"
          >
            Apply using default
          </button>
          <button
            id="workflow-replace"
            className="btn btn-sm"
            type="button"
            data-i18n="taskpane.text.replaceOriginal"
          >
            Replace original
          </button>
          <button
            id="workflow-insert"
            className="btn btn-sm secondary-button"
            type="button"
            data-i18n="taskpane.text.insertBelow"
          >
            Insert below
          </button>
          <button
            id="workflow-comment"
            className="btn btn-sm secondary-button"
            type="button"
            data-i18n="taskpane.text.addComment"
          >
            Add comment
          </button>
        </div>
      </section>
    </section>
  );
}

function TableWorkflow() {
  return (
    <section id="table-workflow-workspace" className="text-workflow-workspace task-workspace" hidden>
      <WorkspaceHeader
        closeId="close-table-workflow"
        title={<span className="task-title"><Table2 size={18} aria-hidden="true" /><h2 data-i18n="taskpane.table.title">Text to table</h2></span>}
      />
      <div className="card card-border form-group task-panel">
        <div className="task-panel-heading">
          <label htmlFor="table-source" data-i18n="taskpane.table.source">
            Source text
          </label>
          <div className="task-panel-tools">
            <button
              id="table-load-selection"
              className="btn btn-sm secondary-button"
              type="button"
              data-i18n="taskpane.common.loadSelection"
            >
              Load selection
            </button>
            <button
              id="table-clear"
              className="btn btn-ghost btn-xs text-button"
              type="button"
              data-i18n="taskpane.common.clear"
            >
              Clear
            </button>
          </div>
        </div>
        <textarea
          id="table-source"
          className="textarea"
          rows={6}
          placeholder="Enter text or load it from the Word selection…"
          data-i18n-placeholder="taskpane.table.sourcePlaceholder"
        />
      </div>
      <details className="collapse collapse-arrow task-options">
        <summary className="collapse-title" data-i18n="taskpane.table.template">Table template</summary>
        <div className="collapse-content task-options-body">
        <label htmlFor="table-template" data-i18n="taskpane.table.template">
          Table template
        </label>
        <select id="table-template" className="select select-sm">
          <option value="" data-i18n="taskpane.table.smart">
            Smart detection
          </option>
          <option
            value="Extract key fields such as item, description, owner, deadline, and notes."
            data-i18n="taskpane.table.checklist"
            data-i18n-value="taskpane.table.checklistPrompt"
          >
            Checklist
          </option>
          <option
            value="Place subjects in rows and comparable dimensions in columns, highlighting differences."
            data-i18n="taskpane.table.comparison"
            data-i18n-value="taskpane.table.comparisonPrompt"
          >
            Comparison
          </option>
          <option
            value="Extract time, event, participants, outcome, and basis."
            data-i18n="taskpane.table.timeline"
            data-i18n-value="taskpane.table.timelinePrompt"
          >
            Timeline
          </option>
        </select>
        <label htmlFor="table-requirement" data-i18n="taskpane.table.requirements">
          Formatting and content requirements
        </label>
        <textarea
          id="table-requirement"
          className="textarea"
          rows={3}
          placeholder="Add column names, sorting, merging, or wording requirements…"
          data-i18n-placeholder="taskpane.table.requirementsPlaceholder"
        />
        </div>
      </details>
      <div className="task-primary-actions">
        <button id="table-generate" className="btn btn-primary btn-sm" type="button" data-i18n="taskpane.table.generate">
          Generate table
        </button>
        <button
          id="table-cancel"
          className="btn btn-sm secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <section className="card card-border workflow-preview-section task-panel task-output-panel">
        <div className="task-panel-heading">
          <h3 data-i18n="taskpane.table.preview">Table preview</h3>
          <span id="table-preview-status" className="muted" />
        </div>
        <div id="table-preview" className="table-preview empty-panel" />
      </section>
      <button
        id="table-insert"
        className="btn btn-primary btn-sm"
        type="button"
        disabled
        data-i18n="taskpane.common.insertDocument"
      >
        Insert into document
      </button>
    </section>
  );
}

function MarkdownWorkflow() {
  return (
    <section id="markdown-workflow-workspace" className="text-workflow-workspace task-workspace" hidden>
      <WorkspaceHeader
        closeId="close-markdown-workflow"
        title={<span className="task-title"><FileText size={18} aria-hidden="true" /><h2 data-i18n="taskpane.markdown.title">Markdown conversion</h2></span>}
      />
      <div className="card card-border form-group task-panel">
        <div className="task-panel-heading">
          <label htmlFor="markdown-source" data-i18n="taskpane.markdown.content">
            Markdown content
          </label>
          <div className="task-panel-tools">
            <button
              id="markdown-paste"
              className="btn btn-sm secondary-button"
              type="button"
              data-i18n="taskpane.markdown.paste"
            >
              <ClipboardPaste size={14} aria-hidden="true" />
              Paste clipboard
            </button>
            <button
              id="markdown-load-selection"
              className="btn btn-sm secondary-button"
              type="button"
              data-i18n="taskpane.common.loadSelection"
            >
              Load selection
            </button>
            <button
              id="markdown-clear"
              className="btn btn-ghost btn-xs text-button"
              type="button"
              data-i18n="taskpane.common.clear"
            >
              Clear
            </button>
          </div>
        </div>
        <textarea
          id="markdown-source"
          className="textarea"
          rows={8}
          placeholder={"# Heading\n\n- List item\n- List item"}
          data-i18n-placeholder="taskpane.markdown.placeholder"
        />
      </div>
      <section className="card card-border workflow-preview-section task-panel task-output-panel">
        <div className="task-panel-heading">
          <h3 data-i18n="taskpane.markdown.preview">Conversion preview</h3>
          <span id="markdown-preview-status" className="muted" />
        </div>
        <div id="markdown-preview" className="markdown-preview empty-panel" />
      </section>
      <button
        id="markdown-insert"
        className="btn btn-primary btn-sm"
        type="button"
        disabled
        data-i18n="taskpane.common.insertWord"
      >
        Insert into Word
      </button>
    </section>
  );
}

export function ContentWorkflows() {
  return (
    <>
      <TextWorkflow />
      <TableWorkflow />
      <MarkdownWorkflow />
    </>
  );
}
