export function LegacyReviewWorkspace() {
  return (
    <section id="tab-review" className="tab-panel" data-panel="review" hidden>
      <section className="review-scan-section">
        <div className="review-section-heading">
          <div>
            <h2 data-i18n="taskpane.review.issueScan">Issue scan</h2>
            <strong id="issue-summary" data-i18n="taskpane.issues.empty">
              No review issues
            </strong>
          </div>
          <button
            id="clear-issues"
            className="btn btn-ghost btn-xs text-button"
            type="button"
            data-i18n="taskpane.common.clear"
          >
            Clear
          </button>
        </div>
        <div className="review-scan-actions">
        <button
          id="review-selection"
          className="btn btn-primary btn-sm"
          type="button"
          data-i18n="taskpane.issues.reviewSelection"
        >
          Review selection
        </button>
        <button
          id="review-document"
          className="btn btn-sm secondary-button"
          type="button"
          data-i18n="taskpane.issues.reviewDocument"
        >
          Review document
        </button>
        </div>
        <div id="issue-list" className="issue-list" hidden />
      </section>

      <div className="review-section-heading review-suggestion-heading">
        <h2 data-i18n="taskpane.review.suggestionReview">Suggested changes</h2>
      </div>
      <div className="review-command-bar">
        <article className="card card-border task-panel review-scope-panel">
          <div className="task-panel-heading">
            <h3 data-i18n="taskpane.review.scope">Review scope</h3>
          </div>
          <div className="review-scope-options">
            <button
              id="load-review-selection"
              className="btn btn-sm secondary-button"
              type="button"
              data-i18n="taskpane.common.loadSelection"
            >
              Load selection
            </button>
            <button
              id="load-review-paragraphs"
              className="btn btn-sm secondary-button"
              type="button"
              data-i18n="taskpane.review.loadParagraphs"
            >
              Load paragraphs
            </button>
            <button
              id="load-review-document"
              className="btn btn-sm secondary-button"
              type="button"
              data-i18n="taskpane.common.loadDocument"
            >
              Load document
            </button>
          </div>
          <div className="review-pagination">
            <button
              id="review-page-previous"
              className="btn btn-ghost btn-xs text-button"
              type="button"
              disabled
              data-i18n="taskpane.review.previous"
            >
              Previous
            </button>
            <button
              id="review-page-next"
              className="btn btn-ghost btn-xs text-button"
              type="button"
              disabled
              data-i18n="taskpane.review.next"
            >
              Next
            </button>
            <span id="review-page-status" className="muted" />
          </div>
          <p id="review-scope-status" className="muted" />
        </article>

        <article className="card card-border task-panel review-generate-panel">
          <div className="task-panel-heading">
            <h3 data-i18n="taskpane.review.generateSuggestions">
            Generate suggestions
            </h3>
          </div>
          <div className="task-primary-actions">
            <button
              id="generate-review"
              className="btn btn-primary btn-sm"
              type="button"
              data-i18n="taskpane.review.generateAll"
            >
              Generate all
            </button>
            <button
              id="cancel-review"
              className="btn btn-sm secondary-button"
              type="button"
              disabled
              data-i18n="taskpane.review.cancelGeneration"
            >
              Cancel generation
            </button>
          </div>
          <progress id="review-progress" max={100} value={0} hidden />
          <p id="review-progress-status" className="muted" />
        </article>
      </div>

      <div className="form-group task-instructions review-instructions">
        <label htmlFor="review-instruction" data-i18n="taskpane.review.customRequirements">
          Custom requirements
        </label>
        <textarea
          id="review-instruction"
          className="textarea"
          rows={3}
          placeholder="Add review priorities or writing requirements…"
          data-i18n-placeholder="taskpane.review.customRequirementsPlaceholder"
        />
      </div>

      <details id="review-batch-actions" className="collapse collapse-arrow task-options review-batch-actions" hidden>
        <summary className="collapse-title" data-i18n="taskpane.review.batchActions">Batch actions</summary>
        <div className="collapse-content action-row wrap">
          <button
            id="accept-all-suggestions"
            className="btn btn-primary btn-sm"
            type="button"
            data-i18n="taskpane.review.acceptAll"
          >
            Accept all
          </button>
          <button
            id="insert-all-suggestions"
            className="btn btn-sm secondary-button"
            type="button"
            data-i18n="taskpane.review.insertAll"
          >
            Insert all
          </button>
          <button
            id="comment-all-suggestions"
            className="btn btn-sm secondary-button"
            type="button"
            data-i18n="taskpane.review.commentAll"
          >
            Comment all
          </button>
          <button
            id="skip-all-suggestions"
            className="btn btn-ghost btn-xs text-button"
            type="button"
            data-i18n="taskpane.review.skipAll"
          >
            Skip all
          </button>
        </div>
      </details>

      <div id="suggestion-list" className="empty-panel" hidden />

      <details id="tracked-revision-panel" className="collapse collapse-arrow task-options">
        <summary className="collapse-title">
          <span data-i18n="taskpane.review.wordRevisions">Word revisions</span>{" "}
          <span id="tracked-revision-count" className="badge badge-sm count-badge">
            0
          </span>
        </summary>
        <div className="collapse-content action-row wrap">
          <button
            id="refresh-tracked-revisions"
            className="btn btn-sm"
            type="button"
            data-i18n="taskpane.review.readRevisions"
          >
            Read revisions
          </button>
          <button
            id="accept-all-tracked-revisions"
            className="btn btn-sm secondary-button"
            type="button"
            disabled
            data-i18n="taskpane.review.acceptAll"
          >
            Accept all
          </button>
          <button
            id="reject-all-tracked-revisions"
            className="btn btn-sm secondary-button"
            type="button"
            disabled
            data-i18n="taskpane.review.rejectAll"
          >
            Reject all
          </button>
        </div>
        <p id="tracked-revision-status" className="muted" />
        <div id="tracked-revision-list" className="empty-panel" />
      </details>
    </section>
  );
}

function LongDocumentReviewWorkspace() {
  return (
    <section id="tab-review" className="tab-panel review-workspace" data-panel="review" hidden>
      <header className="workflow-workspace-header review-workspace-header">
        <div>
          <h2 data-i18n="taskpane.review.workspaceTitle">Document review</h2>
          <p data-i18n="taskpane.review.workspaceSubtitle">Review an entire document or a selection containing at least three paragraphs.</p>
        </div>
      </header>

      <article className="card card-border task-panel review-setup-panel">
        <div className="task-panel-heading">
          <h3 data-i18n="taskpane.review.scope">Review scope</h3>
        </div>
        <div className="review-scope-options review-scope-options-primary">
          <button id="load-review-document" className="btn btn-primary btn-sm" type="button" data-i18n="taskpane.review.entireDocument">Entire document</button>
          <button id="load-review-selection" className="btn btn-sm" type="button" data-i18n="taskpane.review.multiParagraphSelection">Multi-paragraph selection</button>
        </div>
        <div className="review-pagination" hidden>
          <button id="review-page-previous" className="btn btn-ghost btn-xs" type="button" disabled data-i18n="taskpane.review.previous">Previous</button>
          <button id="review-page-next" className="btn btn-ghost btn-xs" type="button" disabled data-i18n="taskpane.review.next">Next</button>
          <span id="review-page-status" className="muted" />
        </div>
        <p id="review-scope-status" className="muted review-scope-status" data-i18n="taskpane.review.documentDefault" />

        <div className="form-group task-instructions review-instructions">
          <label htmlFor="review-instruction" data-i18n="taskpane.review.customRequirements">Custom requirements</label>
          <textarea id="review-instruction" className="textarea textarea-bordered" rows={3} placeholder="Add review priorities or writing requirements…" data-i18n-placeholder="taskpane.review.customRequirementsPlaceholder" />
        </div>
        <div className="review-run-actions">
          <button id="review-document" className="btn btn-primary btn-sm" type="button" data-i18n="taskpane.review.scanIssues">Scan issues</button>
          <button id="generate-review" className="btn btn-sm" type="button" data-i18n="taskpane.review.generateChanges">Generate changes</button>
          <button id="cancel-review" className="btn btn-ghost btn-sm" type="button" disabled data-i18n="taskpane.review.cancelGeneration">Cancel</button>
        </div>
        <progress id="review-progress" className="progress progress-primary" max={100} value={0} hidden />
        <p id="review-progress-status" className="muted" />
      </article>

      <section className="review-results-section">
        <div className="review-section-heading">
          <div>
            <h2 data-i18n="taskpane.review.findings">Findings</h2>
            <strong id="issue-summary" data-i18n="taskpane.issues.empty">No review issues</strong>
          </div>
          <button id="clear-issues" className="btn btn-ghost btn-xs" type="button" data-i18n="taskpane.common.clear">Clear</button>
        </div>
        <div id="issue-list" className="issue-list" hidden />
      </section>

      <section className="review-results-section">
        <div className="review-section-heading"><h2 data-i18n="taskpane.review.proposedChanges">Proposed changes</h2></div>
        <details id="review-batch-actions" className="collapse collapse-arrow task-options review-batch-actions" hidden>
          <summary className="collapse-title" data-i18n="taskpane.review.batchActions">Batch actions</summary>
          <div className="collapse-content action-row wrap">
            <button id="accept-all-suggestions" className="btn btn-primary btn-sm" type="button" data-i18n="taskpane.review.acceptAll">Accept all</button>
            <button id="insert-all-suggestions" className="btn btn-sm" type="button" data-i18n="taskpane.review.insertAll">Insert all</button>
            <button id="comment-all-suggestions" className="btn btn-sm" type="button" data-i18n="taskpane.review.commentAll">Comment all</button>
            <button id="skip-all-suggestions" className="btn btn-ghost btn-sm" type="button" data-i18n="taskpane.review.skipAll">Skip all</button>
          </div>
        </details>
        <div id="suggestion-list" className="empty-panel" hidden />
      </section>

      <details id="tracked-revision-panel" className="collapse collapse-arrow task-options review-revisions-panel">
        <summary className="collapse-title"><span data-i18n="taskpane.review.wordRevisions">Word revisions</span>{" "}<span id="tracked-revision-count" className="badge badge-sm count-badge">0</span></summary>
        <div className="collapse-content action-row wrap">
          <button id="refresh-tracked-revisions" className="btn btn-sm" type="button" data-i18n="taskpane.review.readRevisions">Read revisions</button>
          <button id="accept-all-tracked-revisions" className="btn btn-sm" type="button" disabled data-i18n="taskpane.review.acceptAll">Accept all</button>
          <button id="reject-all-tracked-revisions" className="btn btn-sm" type="button" disabled data-i18n="taskpane.review.rejectAll">Reject all</button>
        </div>
        <p id="tracked-revision-status" className="muted" />
        <div id="tracked-revision-list" className="empty-panel" />
      </details>
    </section>
  );
}

export function ReviewSurfaces() {
  return <LongDocumentReviewWorkspace />;
}
