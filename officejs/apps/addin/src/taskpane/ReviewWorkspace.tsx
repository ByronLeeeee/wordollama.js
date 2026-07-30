function IssuesWorkspace() {
  return (
    <section id="tab-issues" className="tab-panel" data-panel="issues" hidden>
      <div className="panel-toolbar">
        <strong id="issue-summary" data-i18n="taskpane.issues.empty">
          No review issues
        </strong>
        <button
          id="clear-issues"
          className="text-button"
          type="button"
          data-i18n="taskpane.common.clear"
        >
          Clear
        </button>
      </div>
      <div className="action-row">
        <button
          id="review-selection"
          type="button"
          data-i18n="taskpane.issues.reviewSelection"
        >
          Review selection
        </button>
        <button
          id="review-document"
          className="secondary-button"
          type="button"
          data-i18n="taskpane.issues.reviewDocument"
        >
          Review document
        </button>
      </div>
      <div id="issue-list" className="empty-panel" />
    </section>
  );
}

function ReviewWorkspace() {
  return (
    <section id="tab-review" className="tab-panel" data-panel="review" hidden>
      <div className="review-grid">
        <article className="subtle-card">
          <h3 data-i18n="taskpane.review.scope">Review scope</h3>
          <div className="action-row wrap">
            <button
              id="load-review-selection"
              type="button"
              data-i18n="taskpane.common.loadSelection"
            >
              Load selection
            </button>
            <button
              id="load-review-paragraphs"
              className="secondary-button"
              type="button"
              data-i18n="taskpane.review.loadParagraphs"
            >
              Load paragraphs
            </button>
            <button
              id="load-review-document"
              className="secondary-button"
              type="button"
              data-i18n="taskpane.common.loadDocument"
            >
              Load document
            </button>
          </div>
          <div className="action-row wrap">
            <button
              id="review-page-previous"
              className="text-button"
              type="button"
              disabled
              data-i18n="taskpane.review.previous"
            >
              Previous
            </button>
            <button
              id="review-page-next"
              className="text-button"
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

        <article className="subtle-card">
          <h3 data-i18n="taskpane.review.generateSuggestions">
            Generate suggestions
          </h3>
          <div className="action-row wrap">
            <button
              id="generate-review"
              type="button"
              data-i18n="taskpane.review.generateAll"
            >
              Generate all
            </button>
            <button
              id="cancel-review"
              className="secondary-button"
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

      <div className="form-group">
        <label htmlFor="review-instruction" data-i18n="taskpane.review.customRequirements">
          Custom requirements
        </label>
        <textarea
          id="review-instruction"
          rows={3}
          placeholder="Add review priorities or writing requirements…"
          data-i18n-placeholder="taskpane.review.customRequirementsPlaceholder"
        />
      </div>

      <details className="profile-panel">
        <summary data-i18n="taskpane.review.writingProfile">Writing profile</summary>
        <textarea
          id="writing-profile"
          rows={4}
          placeholder="Record tone, formatting, and wording preferences…"
          data-i18n-placeholder="taskpane.review.writingProfilePlaceholder"
        />
        <button
          id="save-profile"
          className="secondary-button"
          type="button"
          data-i18n="taskpane.review.saveProfile"
        >
          Save profile
        </button>
      </details>

      <details id="review-batch-actions" className="profile-panel" hidden>
        <summary data-i18n="taskpane.review.batchActions">Batch actions</summary>
        <div className="action-row wrap">
          <button
            id="accept-all-suggestions"
            type="button"
            data-i18n="taskpane.review.acceptAll"
          >
            Accept all
          </button>
          <button
            id="insert-all-suggestions"
            className="secondary-button"
            type="button"
            data-i18n="taskpane.review.insertAll"
          >
            Insert all
          </button>
          <button
            id="comment-all-suggestions"
            className="secondary-button"
            type="button"
            data-i18n="taskpane.review.commentAll"
          >
            Comment all
          </button>
          <button
            id="skip-all-suggestions"
            className="text-button"
            type="button"
            data-i18n="taskpane.review.skipAll"
          >
            Skip all
          </button>
        </div>
      </details>

      <details id="tracked-revision-panel" className="profile-panel">
        <summary>
          <span data-i18n="taskpane.review.wordRevisions">Word revisions</span>{" "}
          <span id="tracked-revision-count" className="count-badge">
            0
          </span>
        </summary>
        <div className="action-row wrap">
          <button
            id="refresh-tracked-revisions"
            type="button"
            data-i18n="taskpane.review.readRevisions"
          >
            Read revisions
          </button>
          <button
            id="accept-all-tracked-revisions"
            className="secondary-button"
            type="button"
            disabled
            data-i18n="taskpane.review.acceptAll"
          >
            Accept all
          </button>
          <button
            id="reject-all-tracked-revisions"
            className="secondary-button"
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

      <div id="suggestion-list" className="empty-panel" />
    </section>
  );
}

export function ReviewSurfaces() {
  return (
    <>
      <IssuesWorkspace />
      <ReviewWorkspace />
    </>
  );
}
