import { ArrowLeft, Plus, Search, Settings2, WandSparkles } from "lucide-react";
import { FeatureIcon } from "./FeatureIcon";
import { WorkspaceHeader } from "./WorkspaceHeader";

function LawWorkflow() {
  return (
    <section id="law-workflow-workspace" className="text-workflow-workspace task-workspace" hidden>
      <WorkspaceHeader
        closeId="close-law-workflow"
        title={<span className="task-title"><FeatureIcon name="law-search" /><h2 data-i18n="taskpane.law.title">Legal search</h2></span>}
      />
      <div className="card card-border task-panel task-search-panel">
      <div className="form-group">
        <label htmlFor="law-name" data-i18n="taskpane.law.name">
          Law name
        </label>
        <input
          id="law-name"
          className="input input-sm"
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
          className="input input-sm"
          maxLength={40}
          placeholder="For example: 577 or Article 577"
          data-i18n-placeholder="taskpane.law.articlePlaceholder"
        />
      </div>
      <div className="task-primary-actions">
        <button id="law-search" className="btn btn-primary btn-sm" type="button" data-i18n="taskpane.law.search">
          Search
        </button>
        <button
          id="law-cancel"
          className="btn btn-sm secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>
      </div>
      <article id="law-result" className="card card-border law-result task-panel task-output-panel" hidden>
        <div className="task-panel-heading">
          <h3 id="law-result-title" />
          <span id="law-result-category" className="muted" />
        </div>
        <p id="law-result-content" />
      </article>
      <p id="law-status" className="muted" />
      <div className="task-result-actions">
        <button
          id="law-insert"
          className="btn btn-primary btn-sm"
          type="button"
          disabled
          data-i18n="taskpane.common.insertWord"
        >
          Insert into Word
        </button>
        <button
          id="law-copy"
          className="btn btn-sm secondary-button"
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
    <section id="moot-workflow-workspace" className="text-workflow-workspace task-workspace" hidden>
      <WorkspaceHeader
        closeId="close-moot-workflow"
        title={<span className="task-title"><FeatureIcon name="moot-court" /><h2 data-i18n="taskpane.moot.title">Moot court investigation</h2></span>}
      />
      <div className="form-group">
        <label htmlFor="moot-pleading-type" data-i18n="taskpane.moot.documentType">
          Document type
        </label>
        <select id="moot-pleading-type" className="select select-sm">
          <option value="indictment" data-i18n="taskpane.moot.complaint">
            Complaint
          </option>
          <option value="defense" data-i18n="taskpane.moot.defense">
            Defense
          </option>
        </select>
      </div>
      <div className="card card-border form-group task-panel">
        <div className="task-panel-heading">
          <label htmlFor="moot-source" data-i18n="taskpane.moot.source">
            Document to investigate
          </label>
          <div className="task-panel-tools">
            <button
            id="moot-load-document"
              className="btn btn-sm secondary-button"
              type="button"
              data-i18n="taskpane.common.loadDocument"
            >
              Load document
            </button>
            <button
            id="moot-load-selection"
              className="btn btn-sm secondary-button"
              type="button"
              data-i18n="taskpane.common.loadSelection"
            >
              Load selection
            </button>
          </div>
        </div>
        <textarea
          id="moot-source"
          className="textarea"
          rows={8}
          placeholder="Enter a pleading or load it from Word…"
          data-i18n-placeholder="taskpane.moot.sourcePlaceholder"
        />
      </div>
      <div className="task-primary-actions">
        <button id="moot-generate" className="btn btn-primary btn-sm" type="button" data-i18n="taskpane.moot.start">
          Start investigation
        </button>
        <button
          id="moot-cancel"
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
          <label htmlFor="moot-result" data-i18n="taskpane.moot.result">
          Investigation result
          </label>
        </div>
        <textarea id="moot-result" className="textarea" rows={10} />
        <div className="task-result-actions">
        <button
          id="moot-insert"
          className="btn btn-primary btn-sm"
          type="button"
          disabled
          data-i18n="taskpane.common.insertWord"
        >
          Insert into Word
        </button>
        <button
          id="moot-copy"
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

function CustomPromptWorkflow() {
  return (
    <section id="custom-prompt-workspace" className="text-workflow-workspace task-workspace" hidden>
      <WorkspaceHeader
        closeId="close-custom-prompt"
        title={<span className="task-title"><FeatureIcon name="custom-prompts" /><h2 data-i18n="taskpane.prompts.title">My commands</h2></span>}
      />

      <div id="custom-prompt-launcher" className="prompt-launcher">
        <div className="prompt-toolbar">
          <label className="input input-sm prompt-search">
            <Search size={15} aria-hidden="true" />
            <input
              id="custom-prompt-search"
              className="prompt-search-field"
              type="search"
              placeholder="Search commands…"
              data-i18n-placeholder="taskpane.prompts.searchPlaceholder"
            />
          </label>
          <button id="custom-prompt-new" className="btn btn-primary btn-sm btn-square" type="button" aria-label="New command" title="New command" data-i18n-aria-label="taskpane.prompts.new" data-i18n-title="taskpane.prompts.new">
            <Plus size={17} aria-hidden="true" />
          </button>
          <button id="custom-prompt-manage" className="btn btn-outline btn-sm btn-square" type="button" aria-label="Manage commands" title="Manage commands" data-i18n-aria-label="taskpane.prompts.manage" data-i18n-title="taskpane.prompts.manage">
            <Settings2 size={17} aria-hidden="true" />
          </button>
        </div>
        <div id="custom-prompt-list" className="prompt-command-list" role="list" />
        <div id="custom-prompt-empty" className="prompt-empty" hidden>
          <WandSparkles size={24} aria-hidden="true" />
          <strong id="custom-prompt-empty-title" data-i18n="taskpane.prompts.emptyTitle">No commands yet</strong>
          <span id="custom-prompt-empty-hint" data-i18n="taskpane.prompts.emptyHint">Create a command to process selected text with one click.</span>
          <button id="custom-prompt-empty-new" className="btn btn-primary btn-sm" type="button" data-i18n="taskpane.prompts.new">New command</button>
        </div>
      </div>

      <div id="custom-prompt-manager" className="prompt-manager" hidden>
        <div className="prompt-view-heading">
          <button id="custom-prompt-manage-back" className="btn btn-ghost btn-sm btn-square" type="button" aria-label="Back" data-i18n-aria-label="taskpane.common.back">
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <h3 data-i18n="taskpane.prompts.manage">Manage commands</h3>
          <button id="custom-prompt-manage-new" className="btn btn-primary btn-sm" type="button"><Plus size={15} aria-hidden="true" /><span data-i18n="taskpane.prompts.new">New command</span></button>
        </div>
        <div className="prompt-manager-toolbar">
          <label><input id="custom-prompt-select-all" className="checkbox checkbox-primary checkbox-sm" type="checkbox" /> <span data-i18n="taskpane.common.selectAll">Select all</span></label>
          <div className="prompt-manager-actions">
            <button id="custom-prompt-import" className="btn btn-outline btn-xs" type="button" data-i18n="taskpane.prompts.import">Import</button>
            <button id="custom-prompt-export" className="btn btn-outline btn-xs" type="button" data-i18n="taskpane.prompts.export">Export</button>
            <button id="custom-prompt-delete-selected" className="btn btn-error btn-outline btn-xs" type="button" disabled data-i18n="taskpane.common.delete">Delete</button>
          </div>
        </div>
        <input id="custom-prompt-import-file" type="file" accept="application/json,.json" hidden />
        <div id="custom-prompt-manage-list" className="prompt-manage-list" />
      </div>

      <div id="custom-prompt-runner" className="prompt-runner" hidden>
        <div className="prompt-view-heading">
          <button id="custom-prompt-runner-back" className="btn btn-ghost btn-sm btn-square" type="button" aria-label="Back" data-i18n-aria-label="taskpane.common.back"><ArrowLeft size={18} aria-hidden="true" /></button>
          <div className="prompt-runner-title"><h3 id="custom-prompt-running-name" /><span id="custom-prompt-source-status" className="muted" /></div>
          <button id="custom-prompt-cancel" className="btn btn-error btn-outline btn-xs" type="button" disabled data-i18n="taskpane.common.stop">Stop</button>
        </div>
        <blockquote id="custom-prompt-source-preview" className="workflow-source-preview" hidden />
        <div className="form-group prompt-result-panel">
          <label htmlFor="custom-prompt-result" data-i18n="taskpane.common.generatedResult">Generated result</label>
          <textarea id="custom-prompt-result" className="textarea" rows={10} />
        </div>
        <div className="task-result-actions">
          <button id="custom-prompt-apply" className="btn btn-primary btn-sm" type="button" disabled data-i18n="taskpane.prompts.apply">Apply to Word</button>
          <button id="custom-prompt-copy" className="btn btn-ghost btn-sm" type="button" disabled data-i18n="taskpane.image.copyResult">Copy result</button>
          <button id="custom-prompt-run" className="btn btn-ghost btn-sm" type="button" disabled data-i18n="taskpane.prompts.rerun">Run again</button>
        </div>
      </div>

      <dialog id="custom-prompt-editor" className="modal prompt-editor-modal">
        <div className="modal-box shadow-none">
          <h3 id="custom-prompt-editor-title" className="font-bold text-lg" data-i18n="taskpane.prompts.new">New command</h3>
          <div className="prompt-editor-fields">
            <label className="fieldset">
              <span className="fieldset-legend" data-i18n="taskpane.prompts.name">Command name</span>
              <input id="custom-prompt-name" className="input input-sm" maxLength={80} data-i18n-placeholder="taskpane.prompts.namePlaceholder" />
            </label>
            <label className="fieldset">
              <span className="fieldset-legend" data-i18n="taskpane.prompts.outputMode">Output mode</span>
              <select id="custom-prompt-output" className="select select-sm"><option value="TrackedChanges" data-i18n="taskpane.prompts.trackedReplace">Replace with tracked changes</option><option value="Insert" data-i18n="taskpane.text.insertBelow">Insert below</option><option value="Comment" data-i18n="taskpane.prompts.comment">Comment</option></select>
            </label>
            <label className="fieldset">
              <span className="fieldset-legend" data-i18n="taskpane.prompts.prompt">Prompt</span>
              <textarea id="custom-prompt-text" className="textarea textarea-sm" rows={7} maxLength={20_000} data-i18n-placeholder="taskpane.prompts.promptPlaceholder" />
            </label>
            <label className="label prompt-favorite-option"><input id="custom-prompt-favorite" className="checkbox checkbox-primary checkbox-sm" type="checkbox" /><span data-i18n="taskpane.prompts.favorite">Add to favorites</span></label>
          </div>
          <div className="modal-action">
            <button id="custom-prompt-save" className="btn btn-primary btn-sm" type="button" data-i18n="taskpane.common.save">Save</button>
            <button id="custom-prompt-editor-cancel" className="btn btn-outline btn-sm" type="button" data-i18n="taskpane.common.cancel">Cancel</button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop"><button data-i18n="taskpane.common.close">Close</button></form>
      </dialog>
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
