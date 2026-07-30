import { WorkspaceHeader } from "./WorkspaceHeader";

function LawWorkflow() {
  return (
    <section id="law-workflow-workspace" className="text-workflow-workspace" hidden>
      <WorkspaceHeader
        closeId="close-law-workflow"
        title={<h2 data-i18n="taskpane.law.title">Legal search</h2>}
      />
      <div className="form-group">
        <label htmlFor="law-name" data-i18n="taskpane.law.name">
          Law name
        </label>
        <input
          id="law-name"
          maxLength={100}
          placeholder="For example: Civil Code of the People's Republic of China"
          data-i18n-placeholder="taskpane.law.namePlaceholder"
        />
      </div>
      <div className="form-group">
        <label htmlFor="law-article" data-i18n="taskpane.law.article">
          Article number
        </label>
        <input
          id="law-article"
          maxLength={40}
          placeholder="For example: 577 or Article 577"
          data-i18n-placeholder="taskpane.law.articlePlaceholder"
        />
      </div>
      <div className="action-row">
        <button id="law-search" type="button" data-i18n="taskpane.law.search">
          Search
        </button>
        <button
          id="law-cancel"
          className="secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <article id="law-result" className="law-result subtle-card" hidden>
        <div className="section-title-row">
          <h3 id="law-result-title" />
          <span id="law-result-category" className="muted" />
        </div>
        <p id="law-result-content" />
      </article>
      <p id="law-status" className="muted" />
      <div className="action-row wrap">
        <button
          id="law-insert"
          type="button"
          disabled
          data-i18n="taskpane.common.insertWord"
        >
          Insert into Word
        </button>
        <button
          id="law-copy"
          className="secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.law.copy"
        >
          Copy article
        </button>
      </div>
    </section>
  );
}

function MootCourtWorkflow() {
  return (
    <section id="moot-workflow-workspace" className="text-workflow-workspace" hidden>
      <WorkspaceHeader
        closeId="close-moot-workflow"
        title={<h2 data-i18n="taskpane.moot.title">Moot court investigation</h2>}
      />
      <div className="form-group">
        <label htmlFor="moot-pleading-type" data-i18n="taskpane.moot.documentType">
          Document type
        </label>
        <select id="moot-pleading-type">
          <option value="indictment" data-i18n="taskpane.moot.complaint">
            Complaint
          </option>
          <option value="defense" data-i18n="taskpane.moot.defense">
            Defense
          </option>
        </select>
      </div>
      <div className="form-group">
        <div className="section-title-row">
          <label htmlFor="moot-source" data-i18n="taskpane.moot.source">
            Document to investigate
          </label>
          <div className="action-row wrap">
            <button
              id="moot-load-document"
              type="button"
              data-i18n="taskpane.common.loadDocument"
            >
              Load document
            </button>
            <button
              id="moot-load-selection"
              className="secondary-button"
              type="button"
              data-i18n="taskpane.common.loadSelection"
            >
              Load selection
            </button>
          </div>
        </div>
        <textarea
          id="moot-source"
          rows={8}
          placeholder="Enter a pleading or load it from Word…"
          data-i18n-placeholder="taskpane.moot.sourcePlaceholder"
        />
      </div>
      <div className="action-row">
        <button id="moot-generate" type="button" data-i18n="taskpane.moot.start">
          Start investigation
        </button>
        <button
          id="moot-cancel"
          className="secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <div className="form-group">
        <label htmlFor="moot-result" data-i18n="taskpane.moot.result">
          Investigation result
        </label>
        <textarea id="moot-result" rows={10} />
      </div>
      <div className="action-row wrap">
        <button
          id="moot-insert"
          type="button"
          disabled
          data-i18n="taskpane.common.insertWord"
        >
          Insert into Word
        </button>
        <button
          id="moot-copy"
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

function CustomPromptWorkflow() {
  return (
    <section id="custom-prompt-workspace" className="text-workflow-workspace" hidden>
      <WorkspaceHeader
        closeId="close-custom-prompt"
        title={<h2 data-i18n="taskpane.prompts.title">Custom prompts</h2>}
      />
      <div className="form-group">
        <label htmlFor="custom-prompt-list" data-i18n="taskpane.prompts.saved">
          Saved prompts
        </label>
        <select id="custom-prompt-list">
          <option value="" data-i18n="taskpane.prompts.newPrompt">
            New prompt…
          </option>
        </select>
      </div>
      <div className="action-row wrap">
        <button
          id="custom-prompt-new"
          className="secondary-button"
          type="button"
          data-i18n="taskpane.common.new"
        >
          New
        </button>
        <button
          id="custom-prompt-delete"
          className="text-button"
          type="button"
          disabled
          data-i18n="taskpane.common.delete"
        >
          Delete
        </button>
      </div>
      <div className="form-group">
        <label htmlFor="custom-prompt-name" data-i18n="taskpane.prompts.name">
          Action name
        </label>
        <input
          id="custom-prompt-name"
          maxLength={80}
          placeholder="For example: Convert to contract language"
          data-i18n-placeholder="taskpane.prompts.namePlaceholder"
        />
      </div>
      <div className="form-group">
        <label htmlFor="custom-prompt-output" data-i18n="taskpane.prompts.outputMode">
          Output mode
        </label>
        <select id="custom-prompt-output">
          <option value="Insert" data-i18n="taskpane.text.insertBelow">
            Insert below
          </option>
          <option value="TrackedChanges" data-i18n="taskpane.prompts.trackedReplace">
            Replace with tracked changes
          </option>
          <option value="Comment" data-i18n="taskpane.prompts.comment">
            Comment
          </option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="custom-prompt-slot" data-i18n="taskpane.prompts.ribbonSlot">
          Ribbon shortcut slot
        </label>
        <select id="custom-prompt-slot">
          <option value="" data-i18n="taskpane.prompts.unassigned">
            Unassigned
          </option>
          <option value="1">C1</option>
          <option value="2">C2</option>
          <option value="3">C3</option>
          <option value="4">C4</option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="custom-prompt-text" data-i18n="taskpane.prompts.prompt">
          Prompt
        </label>
        <textarea
          id="custom-prompt-text"
          rows={6}
          maxLength={20_000}
          placeholder="Describe how to process the current selection…"
          data-i18n-placeholder="taskpane.prompts.promptPlaceholder"
        />
      </div>
      <button
        id="custom-prompt-save"
        type="button"
        data-i18n="taskpane.prompts.save"
      >
        Save configuration
      </button>
      <hr />
      <div className="action-row wrap">
        <button
          id="custom-prompt-load-selection"
          type="button"
          data-i18n="taskpane.common.loadSelection"
        >
          Load selection
        </button>
        <span id="custom-prompt-source-status" className="muted" />
      </div>
      <blockquote
        id="custom-prompt-source-preview"
        className="workflow-source-preview"
        hidden
      />
      <div className="action-row">
        <button
          id="custom-prompt-run"
          type="button"
          disabled
          data-i18n="taskpane.prompts.run"
        >
          Run prompt
        </button>
        <button
          id="custom-prompt-cancel"
          className="secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      <div className="form-group">
        <label htmlFor="custom-prompt-result" data-i18n="taskpane.common.generatedResult">
          Generated result
        </label>
        <textarea id="custom-prompt-result" rows={8} />
      </div>
      <button
        id="custom-prompt-apply"
        type="button"
        disabled
        data-i18n="taskpane.prompts.apply"
      >
        Apply to Word using configuration
      </button>
    </section>
  );
}

export function LegalWorkflows() {
  return (
    <>
      <LawWorkflow />
      <MootCourtWorkflow />
      <CustomPromptWorkflow />
    </>
  );
}
