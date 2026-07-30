import { WorkspaceHeader } from "./WorkspaceHeader";

function TextWorkflow() {
  return (
    <section id="text-workflow-workspace" className="text-workflow-workspace" hidden>
      <WorkspaceHeader
        closeId="close-text-workflow"
        title={
          <h2 id="text-workflow-title" data-i18n="taskpane.text.title">
            Text workflow
          </h2>
        }
      />
      <article className="subtle-card">
        <h3 data-i18n="taskpane.text.scope">Scope</h3>
        <div className="action-row wrap">
          <button
            id="workflow-load-selection"
            type="button"
            data-i18n="taskpane.common.loadSelection"
          >
            Load selection
          </button>
          <button
            id="workflow-load-document"
            className="secondary-button"
            type="button"
            data-i18n="taskpane.common.loadDocument"
          >
            Load document
          </button>
          <button
            id="workflow-clear-source"
            className="text-button"
            type="button"
            data-i18n="taskpane.text.requirementOnly"
          >
            Use requirements only
          </button>
        </div>
        <p id="workflow-source-status" className="muted" />
        <blockquote id="workflow-source-preview" className="workflow-source-preview" hidden />
      </article>
      <div className="form-group">
        <label htmlFor="workflow-instruction" data-i18n="taskpane.text.instructions">
          Instructions
        </label>
        <textarea
          id="workflow-instruction"
          rows={4}
          placeholder="Add tone, length, terminology, or formatting requirements…"
          data-i18n-placeholder="taskpane.text.instructionsPlaceholder"
        />
      </div>
      <div className="action-row">
        <button id="workflow-generate" type="button" data-i18n="taskpane.common.generate">
          Generate
        </button>
        <button
          id="workflow-cancel"
          className="secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <section id="workflow-output" className="generated-output" hidden>
        <div className="section-title-row">
          <label htmlFor="workflow-result" data-i18n="taskpane.common.generatedResult">
            Generated result
          </label>
          <button
            id="workflow-copy"
            className="text-button"
            type="button"
            data-i18n="taskpane.common.copy"
          >
            Copy
          </button>
        </div>
        <textarea id="workflow-result" rows={10} />
        <div className="action-row wrap">
          <button
            id="workflow-apply-default"
            type="button"
            data-i18n="taskpane.text.applyDefault"
          >
            Apply using default
          </button>
          <button
            id="workflow-replace"
            type="button"
            data-i18n="taskpane.text.replaceOriginal"
          >
            Replace original
          </button>
          <button
            id="workflow-insert"
            className="secondary-button"
            type="button"
            data-i18n="taskpane.text.insertBelow"
          >
            Insert below
          </button>
          <button
            id="workflow-comment"
            className="secondary-button"
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
    <section id="table-workflow-workspace" className="text-workflow-workspace" hidden>
      <WorkspaceHeader
        closeId="close-table-workflow"
        title={<h2 data-i18n="taskpane.table.title">Text to table</h2>}
      />
      <div className="form-group">
        <div className="section-title-row">
          <label htmlFor="table-source" data-i18n="taskpane.table.source">
            Source text
          </label>
          <div className="action-row wrap">
            <button
              id="table-load-selection"
              type="button"
              data-i18n="taskpane.common.loadSelection"
            >
              Load selection
            </button>
            <button
              id="table-clear"
              className="text-button"
              type="button"
              data-i18n="taskpane.common.clear"
            >
              Clear
            </button>
          </div>
        </div>
        <textarea
          id="table-source"
          rows={6}
          placeholder="Enter text or load it from the Word selection…"
          data-i18n-placeholder="taskpane.table.sourcePlaceholder"
        />
      </div>
      <div className="form-group">
        <label htmlFor="table-template" data-i18n="taskpane.table.template">
          Table template
        </label>
        <select id="table-template">
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
      </div>
      <div className="form-group">
        <label htmlFor="table-requirement" data-i18n="taskpane.table.requirements">
          Formatting and content requirements
        </label>
        <textarea
          id="table-requirement"
          rows={3}
          placeholder="Add column names, sorting, merging, or wording requirements…"
          data-i18n-placeholder="taskpane.table.requirementsPlaceholder"
        />
      </div>
      <div className="action-row">
        <button id="table-generate" type="button" data-i18n="taskpane.table.generate">
          Generate table
        </button>
        <button
          id="table-cancel"
          className="secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <section className="workflow-preview-section">
        <div className="section-title-row">
          <h3 data-i18n="taskpane.table.preview">Table preview</h3>
          <span id="table-preview-status" className="muted" />
        </div>
        <div id="table-preview" className="table-preview empty-panel" />
      </section>
      <button
        id="table-insert"
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
    <section id="markdown-workflow-workspace" className="text-workflow-workspace" hidden>
      <WorkspaceHeader
        closeId="close-markdown-workflow"
        title={<h2 data-i18n="taskpane.markdown.title">Markdown conversion</h2>}
      />
      <div className="form-group">
        <div className="section-title-row">
          <label htmlFor="markdown-source" data-i18n="taskpane.markdown.content">
            Markdown content
          </label>
          <div className="action-row wrap">
            <button
              id="markdown-paste"
              type="button"
              data-i18n="taskpane.markdown.paste"
            >
              Paste clipboard
            </button>
            <button
              id="markdown-load-selection"
              className="secondary-button"
              type="button"
              data-i18n="taskpane.common.loadSelection"
            >
              Load selection
            </button>
            <button
              id="markdown-clear"
              className="text-button"
              type="button"
              data-i18n="taskpane.common.clear"
            >
              Clear
            </button>
          </div>
        </div>
        <textarea
          id="markdown-source"
          rows={8}
          placeholder={"# Heading\n\n- List item\n- List item"}
          data-i18n-placeholder="taskpane.markdown.placeholder"
        />
      </div>
      <section className="workflow-preview-section">
        <div className="section-title-row">
          <h3 data-i18n="taskpane.markdown.preview">Conversion preview</h3>
          <span id="markdown-preview-status" className="muted" />
        </div>
        <div id="markdown-preview" className="markdown-preview empty-panel" />
      </section>
      <button
        id="markdown-insert"
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
