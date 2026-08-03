import { ArrowUp, ImagePlus, Target } from "lucide-react";
import { FeatureIcon } from "./FeatureIcon";

export function AgentWorkspace() {
  return (
    <>
      <nav
        className="tabs tabs-border main-tabs"
        aria-label="Agent workspace"
        data-i18n-aria-label="taskpane.agent.workspace"
      >
        <button
          className="tab tab-active tab-button active"
          type="button"
          data-tab="chat"
          data-i18n="taskpane.agent.chat"
        >
          Chat
        </button>
        <button
          className="tab tab-button"
          type="button"
          data-tab="review"
        >
          <span data-i18n="taskpane.agent.review">Review</span>{" "}
          <span id="issue-count" className="badge badge-sm count-badge">
            0
          </span>
        </button>
      </nav>

      <section id="tab-chat" className="tab-panel active" data-panel="chat">
        <aside id="workflow-banner" className="alert alert-info workflow-banner" hidden>
          <strong id="workflow-title" />
        </aside>
        <aside id="agent-recovery" className="alert alert-info workflow-banner" hidden>
          <strong data-i18n="taskpane.agent.recoveryFound">
            Unfinished Agent task found
          </strong>
          <p id="agent-recovery-detail" />
          <div className="action-row">
            <button
              id="resume-agent-session"
              className="btn btn-primary btn-sm"
              type="button"
              data-i18n="taskpane.agent.resume"
            >
              Resume
            </button>
            <button
              id="discard-agent-session"
              className="btn btn-sm secondary-button"
              type="button"
              data-i18n="taskpane.agent.discard"
            >
              Discard
            </button>
          </div>
        </aside>

        <div id="agent-output" className="chat-thread" aria-live="polite">
          <div id="empty-chat-state" className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <FeatureIcon name="agent" size={22} />
            </span>
            <h2>WordOllama.JS Agent</h2>
            <p className="muted" data-i18n="taskpane.agent.emptyHint">
              Enter an instruction below, or use the menu to invoke tools
            </p>
            <div className="agent-empty-actions">
              <button className="btn btn-sm agent-example-button" type="button" data-agent-example-key="taskpane.agent.examples.summarize" data-i18n="taskpane.agent.examples.summarize">
                Summarize the selection
              </button>
              <button className="btn btn-sm agent-example-button" type="button" data-agent-example-key="taskpane.agent.examples.polish" data-i18n="taskpane.agent.examples.polish">
                Polish the selection
              </button>
              <button id="agent-empty-setup" className="btn btn-ghost btn-sm" type="button" data-i18n="taskpane.agent.configureModel">
                Configure a model
              </button>
            </div>
          </div>
        </div>

        <div className="composer">
          <input
            id="agent-image-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
          />
          <div id="agent-image-preview" className="agent-image-preview" hidden>
            <img
              id="agent-image-preview-img"
              alt="Image to send"
              data-i18n-alt="taskpane.agent.imageAlt"
            />
            <button
              id="agent-image-remove"
              className="btn btn-ghost btn-xs text-button"
              type="button"
              data-i18n="taskpane.agent.removeImage"
            >
              Remove image
            </button>
          </div>
          <div className="composer-toolbar">
            <button
              id="attach-image"
              className="btn btn-ghost btn-square btn-sm icon-button"
              type="button"
              aria-label="Add image"
              title="Add image"
              data-i18n-aria-label="taskpane.agent.addImage"
              data-i18n-title="taskpane.agent.addImage"
            >
              <ImagePlus size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              id="toggle-agent-goal"
              className="btn btn-ghost btn-sm goal-toggle"
              type="button"
              aria-expanded="false"
              aria-controls="agent-goal-row"
            >
              <Target size={15} strokeWidth={2} aria-hidden="true" />
              <span data-i18n="taskpane.agent.goal">Goal</span>
            </button>
          </div>
          <div id="agent-goal-row" className="agent-goal-row" hidden>
            <input
              id="agent-goal"
              className="input input-sm"
              type="text"
              maxLength={500}
              placeholder="Define an outcome that may take multiple steps…"
              data-i18n-placeholder="taskpane.agent.goalPlaceholder"
              aria-label="Agent goal"
              data-i18n-aria-label="taskpane.agent.goal"
            />
          </div>
          <div
            id="command-menu"
            className="command-menu"
            role="listbox"
            aria-label="Agent commands"
            data-i18n-aria-label="taskpane.agent.commands"
            hidden
          />
          <div className="composer-row">
            <textarea
              id="agent-requirement"
              className="textarea"
              rows={2}
              placeholder="Enter an instruction, or type / for quick actions…"
              aria-label="Agent instruction"
              data-i18n-placeholder="taskpane.agent.instructionPlaceholder"
              data-i18n-aria-label="taskpane.agent.instruction"
            />
            <button
              id="agent-run"
              className="btn btn-primary btn-square btn-sm send-button"
              type="button"
              aria-label="Send"
              data-i18n-aria-label="taskpane.agent.send"
            >
              <ArrowUp size={17} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
