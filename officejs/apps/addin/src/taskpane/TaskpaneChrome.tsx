import { Settings } from "lucide-react";
import { FeatureIcon } from "./FeatureIcon";

export function TaskpaneChrome() {
  return (
    <>
      <header className="navbar agent-header">
        <div className="brand">
          <span className="sparkle" aria-hidden="true">
            <FeatureIcon id="surface-feature-icon" name="agent" size={16} />
          </span>
          <div className="brand-copy">
            <span className="product-edition">WordOllama.JS</span>
            <h1 id="surface-title">Agent</h1>
          </div>
        </div>
        <div className="header-actions">
          <span
            id="host-status"
            className="status"
            data-i18n="taskpane.common.connectingWord"
          >
            Connecting to Word…
          </span>
          <button
            id="agent-stop"
            className="btn btn-error btn-outline btn-xs danger-button"
            type="button"
            hidden
            data-i18n="taskpane.common.stop"
          >
            Stop
          </button>
          <button
            id="open-settings"
            className="btn btn-ghost btn-square btn-sm icon-button"
            type="button"
            aria-label="Settings"
            title="Settings"
            data-i18n-aria-label="taskpane.common.settings"
            data-i18n-title="taskpane.common.settings"
          >
            <Settings size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        id="runtime-status"
        className="runtime-strip"
        data-state="connecting"
        role="status"
        aria-live="polite"
      >
        <span className="runtime-indicator" aria-hidden="true" />
        <span
          id="runtime-status-text"
          className="runtime-strip-text"
          data-i18n="taskpane.runtime.connecting"
        >
          Connecting to local service…
        </span>
      </div>

      <section id="agent-status-bar" className="agent-status-bar" hidden>
        <span className="status-pulse" aria-hidden="true" />
        <span id="agent-status-text" data-i18n="taskpane.common.ready">
          Ready
        </span>
        <span id="agent-iteration" />
      </section>
    </>
  );
}
