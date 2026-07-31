import {
  ArrowDownUp,
  ClipboardCopy,
  Languages,
  Trash2,
} from "lucide-react";
import { WorkspaceHeader } from "./WorkspaceHeader";

export function TranslationWorkspace() {
  return (
    <section id="translation-workspace" className="translation-workspace" hidden>
      <WorkspaceHeader
        closeId="close-translation-workspace"
        title={
          <span className="translation-title">
            <Languages size={18} aria-hidden="true" />
            <h2 data-i18n="taskpane.translation.title">Translate</h2>
          </span>
        }
      />

      <div className="translation-language-bar">
        <label className="translation-language-select">
          <span data-i18n="taskpane.translation.sourceLanguage">Source language</span>
          <input
            id="translation-source-language"
            className="input input-sm"
            list="translation-source-language-options"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
          />
          <datalist id="translation-source-language-options" />
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
          <input
            id="translation-target-language"
            className="input input-sm"
            list="translation-target-language-options"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
          />
          <datalist id="translation-target-language-options" />
        </label>
      </div>

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

      <label className="translation-instructions">
        <span data-i18n="taskpane.translation.instructions">Terminology or style (optional)</span>
        <input
          id="translation-instructions"
          className="input input-sm"
          type="text"
          placeholder="For example: use formal legal terminology"
          data-i18n-placeholder="taskpane.translation.instructionsPlaceholder"
        />
      </label>

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
          <button
            id="translation-replace"
            className="btn btn-primary btn-sm"
            type="button"
            disabled
            data-i18n="taskpane.translation.replaceSelection"
          >
            Replace selection
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
        </div>
        <p id="translation-action-status" className="translation-status" role="status" aria-live="polite" />
      </section>
    </section>
  );
}
