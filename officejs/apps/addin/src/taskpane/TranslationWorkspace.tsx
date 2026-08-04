import {
  ArrowDownUp,
  ClipboardCopy,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { FeatureIcon } from "./FeatureIcon";

export function TranslationWorkspace() {
  return (
    <section id="translation-workspace" className="translation-workspace" hidden>
      <WorkspaceHeader
        closeId="close-translation-workspace"
        title={
          <span className="translation-title">
            <FeatureIcon name="translate" />
            <h2 data-i18n="taskpane.translation.title">Translate</h2>
          </span>
        }
      />

      <div className="translation-language-bar">
        <label className="translation-language-select">
          <span data-i18n="taskpane.translation.sourceLanguage">Source language</span>
          <div className="translation-language-combobox">
            <input
              id="translation-source-language"
              className="input input-sm"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="translation-source-language-options"
              aria-expanded="false"
            />
            <div id="translation-source-language-options" className="translation-language-options" role="listbox" hidden />
          </div>
        </label>
        <button
          id="translation-swap-languages"
          className="btn btn-square btn-sm translation-swap-button"
          type="button"
          aria-label="Swap languages"
          title="Swap languages"
          data-i18n-aria-label="taskpane.translation.swap"
          data-i18n-title="taskpane.translation.swap"
        >
          <ArrowDownUp size={18} aria-hidden="true" />
        </button>
        <label className="translation-language-select">
          <span data-i18n="taskpane.translation.targetLanguage">Target language</span>
          <div className="translation-language-combobox">
            <input
              id="translation-target-language"
              className="input input-sm"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="translation-target-language-options"
              aria-expanded="false"
            />
            <div id="translation-target-language-options" className="translation-language-options" role="listbox" hidden />
          </div>
        </label>
      </div>

      <section className="translation-instructions">
        <div className="translation-instructions-heading">
          <span data-i18n="taskpane.translation.instructions">Terminology or style (optional)</span>
          <button id="translation-manage-prompts" className="btn btn-ghost btn-xs" type="button" data-i18n="taskpane.text.managePrompts">Manage</button>
        </div>
        <select id="translation-prompt-select" className="select select-bordered select-sm" aria-label="Translation prompt" data-i18n-aria-label="taskpane.translation.promptPreset" />
        <input
          id="translation-instructions"
          className="input input-sm"
          type="text"
          placeholder="For example: use formal legal terminology"
          data-i18n-placeholder="taskpane.translation.instructionsPlaceholder"
          data-prompt-enhance
        />
      </section>

      <section className="card card-border translation-panel">
        <div className="translation-panel-heading">
          <label htmlFor="translation-source" data-i18n="taskpane.translation.sourceText">
            Source text
          </label>
          <div className="translation-panel-tools">
            <span id="translation-source-count">0</span>
            <button
              id="translation-load-selection"
              className="btn btn-sm secondary-button translation-load-button"
              type="button"
              data-i18n="taskpane.translation.loadSelection"
            >
              Load selection
            </button>
            <button
              id="translation-clear"
              className="btn btn-ghost btn-square btn-sm icon-button"
              type="button"
              aria-label="Clear"
              title="Clear"
              data-i18n-aria-label="taskpane.common.clear"
              data-i18n-title="taskpane.common.clear"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
        <textarea
          id="translation-source"
          className="textarea"
          rows={5}
          placeholder="Enter text or select text in Word…"
          data-i18n-placeholder="taskpane.translation.sourcePlaceholder"
        />
        <p id="translation-selection-status" className="translation-status" />
      </section>

      <div className="translation-primary-actions">
        <button id="translation-run" className="btn btn-primary btn-sm" type="button" data-i18n="taskpane.translation.translate">
          Translate
        </button>
        <button
          id="translation-cancel"
          className="btn btn-sm secondary-button"
          type="button"
          disabled
          data-i18n="taskpane.common.cancel"
        >
          Cancel
        </button>
      </div>

      <section className="card card-border translation-panel translation-output-panel">
        <div className="translation-panel-heading">
          <label htmlFor="translation-result" data-i18n="taskpane.translation.result">
            Translation
          </label>
          <div className="translation-panel-tools">
            <span id="translation-result-count">0</span>
            <button
              id="translation-copy"
              className="btn btn-ghost btn-xs text-button translation-copy-button"
              type="button"
              disabled
            >
              <ClipboardCopy size={14} aria-hidden="true" />
              <span data-i18n="taskpane.common.copy">Copy</span>
            </button>
          </div>
        </div>
        <textarea
          id="translation-result"
          className="textarea"
          rows={5}
          placeholder="The translation appears here and remains editable…"
          data-i18n-placeholder="taskpane.translation.resultPlaceholder"
        />
        <div className="translation-result-actions">
          <button id="translation-retry" className="btn btn-ghost btn-sm" type="button" disabled>
            <RotateCcw size={14} aria-hidden="true" />
            <span data-i18n="taskpane.text.retry">Retry</span>
          </button>
          <button
            id="translation-insert"
            className="btn btn-sm secondary-button"
            type="button"
            disabled
            data-i18n="taskpane.translation.insertBelow"
          >
            Insert below
          </button>
          <button
            id="translation-replace"
            className="btn btn-sm secondary-button"
            type="button"
            disabled
            data-i18n="taskpane.translation.replaceSelection"
          >
            Replace selection
          </button>
          <button
            id="translation-precise-revision"
            className="btn btn-primary btn-sm"
            type="button"
            disabled
            data-i18n="taskpane.text.preciseRevision"
          >
            Precise revision
          </button>
        </div>
        <p id="translation-action-status" className="translation-status" role="status" aria-live="polite" />
      </section>
      <dialog id="translation-prompt-dialog" className="modal workflow-prompt-dialog">
        <div className="modal-box shadow-none">
          <h3 className="text-lg font-bold" data-i18n="taskpane.translation.myPrompts">My translation prompts</h3>
          <p className="text-sm text-base-content/60" data-i18n="taskpane.text.myPromptsHint">Save multiple prompts for this tool.</p>
          <ul id="translation-prompt-list" className="list bg-base-100 rounded-box workflow-prompt-list" />
          <div className="divider" />
          <label className="form-control"><span className="label-text" data-i18n="taskpane.text.promptName">Name</span><input id="translation-prompt-name" className="input input-bordered input-sm" type="text" /></label>
          <label className="form-control"><span className="label-text" data-i18n="taskpane.text.promptContent">Prompt content</span><textarea id="translation-prompt-content" className="textarea textarea-bordered" rows={5} data-prompt-enhance /></label>
          <div className="modal-action">
            <button id="translation-prompt-create" className="btn btn-primary btn-sm" type="button"><Plus size={14} aria-hidden="true" /><span data-i18n="taskpane.common.save">Save</span></button>
            <button id="translation-prompt-close" className="btn btn-ghost btn-sm" type="button" data-i18n="taskpane.common.close">Close</button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop"><button data-i18n="taskpane.common.close">Close</button></form>
      </dialog>
    </section>
  );
}
