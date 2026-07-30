import {
  OfficeJsWordAdapter,
  type TrackedRevision,
  type TrackedRevisionResult,
} from "./officejs-word-adapter.ts";
import type { ReleaseTestIdentity } from "./contracts.ts";
import i18n from "./i18n.ts";

export interface RevisionHostMetadata {
  host: string;
  platform: string;
  version: string;
  language: string;
}

export interface RevisionHost {
  metadata(): RevisionHostMetadata;
  supportsChangeTracking(): boolean;
  supportsRevisionCollection(): boolean;
  prepareFixture(): Promise<string | null>;
  restoreFixtureTracking(previous: string | null): Promise<void>;
  beginTrackedChanges(): Promise<string | null>;
  restoreTrackedChanges(previous: string | null): Promise<void>;
  insertTextAtEnd(text: string): Promise<void>;
  listTrackedRevisions(): Promise<TrackedRevisionResult>;
  focusTrackedRevision(identity: string, index: number): Promise<void>;
  applyTrackedRevision(
    identity: string,
    index: number,
    action: "accept" | "reject",
  ): Promise<void>;
  applyAllTrackedRevisions(action: "accept" | "reject"): Promise<void>;
  searchText(text: string): Promise<{ count: number }>;
}

export interface RevisionHostReport {
  schemaVersion: 1;
  startedAt: string;
  finishedAt: string;
  release?: ReleaseTestIdentity;
  host: RevisionHostMetadata;
  status: "passed" | "unsupported" | "failed";
  capabilities: {
    wordApi14ChangeTracking: boolean;
    wordApiDesktop14Revisions: boolean;
  };
  initialRevisionCount: number;
  afterAcceptCount: number;
  afterRejectCount: number;
  afterAcceptAllCount: number;
  acceptedMarkerRetained: boolean;
  rejectedMarkerRemoved: boolean;
  batchMarkerRetained: boolean;
  focusVerified: boolean;
  errors: string[];
}

const ACCEPT_MARKER = "WORDOLLAMA_JS_REVISION_ACCEPT";
const REJECT_MARKER = "WORDOLLAMA_JS_REVISION_REJECT";
const BATCH_MARKER = "WORDOLLAMA_JS_REVISION_ACCEPT_ALL";

function findMarkerRevision(
  result: TrackedRevisionResult,
  marker: string,
): TrackedRevision {
  const matches = result.revisions.filter((revision) => revision.text.includes(marker));
  if (matches.length !== 1) {
    throw new Error(`expected one tracked revision for ${marker}; found ${matches.length}`);
  }
  return matches[0];
}

async function insertTrackedMarker(host: RevisionHost, marker: string): Promise<void> {
  const previous = await host.beginTrackedChanges();
  try {
    await host.insertTextAtEnd(`\n${marker}`);
  } finally {
    await host.restoreTrackedChanges(previous);
  }
}

export async function runRevisionHostMatrix(
  host: RevisionHost,
  progress?: (message: string) => void,
): Promise<RevisionHostReport> {
  const startedAt = new Date().toISOString();
  const capabilities = {
    wordApi14ChangeTracking: host.supportsChangeTracking(),
    wordApiDesktop14Revisions: host.supportsRevisionCollection(),
  };
  const report: RevisionHostReport = {
    schemaVersion: 1,
    startedAt,
    finishedAt: startedAt,
    host: host.metadata(),
    status: "failed",
    capabilities,
    initialRevisionCount: 0,
    afterAcceptCount: 0,
    afterRejectCount: 0,
    afterAcceptAllCount: 0,
    acceptedMarkerRetained: false,
    rejectedMarkerRemoved: false,
    batchMarkerRetained: false,
    focusVerified: false,
    errors: [],
  };

  if (!capabilities.wordApi14ChangeTracking || !capabilities.wordApiDesktop14Revisions) {
    report.status = "unsupported";
    report.errors.push(
      i18n.t("taskpane.diagnosticsRuntime.revisions.unsupported"),
    );
    report.finishedAt = new Date().toISOString();
    return report;
  }

  let originalTracking: string | null = null;
  try {
    progress?.(i18n.t("taskpane.diagnosticsRuntime.revisions.preparing"));
    originalTracking = await host.prepareFixture();

    progress?.(i18n.t("taskpane.diagnosticsRuntime.revisions.accept"));
    await insertTrackedMarker(host, ACCEPT_MARKER);
    const initial = await host.listTrackedRevisions();
    report.initialRevisionCount = initial.total;
    const acceptRevision = findMarkerRevision(initial, ACCEPT_MARKER);
    await host.focusTrackedRevision(acceptRevision.identity, acceptRevision.index);
    report.focusVerified = true;
    await host.applyTrackedRevision(acceptRevision.identity, acceptRevision.index, "accept");
    const afterAccept = await host.listTrackedRevisions();
    report.afterAcceptCount = afterAccept.total;
    report.acceptedMarkerRetained = (await host.searchText(ACCEPT_MARKER)).count === 1;
    if (afterAccept.total >= initial.total) {
      throw new Error("accept did not reduce the tracked revision count");
    }
    if (!report.acceptedMarkerRetained) {
      throw new Error("accepted text marker was not retained");
    }

    progress?.(i18n.t("taskpane.diagnosticsRuntime.revisions.reject"));
    await insertTrackedMarker(host, REJECT_MARKER);
    const beforeReject = await host.listTrackedRevisions();
    const rejectRevision = findMarkerRevision(beforeReject, REJECT_MARKER);
    await host.applyTrackedRevision(rejectRevision.identity, rejectRevision.index, "reject");
    const afterReject = await host.listTrackedRevisions();
    report.afterRejectCount = afterReject.total;
    report.rejectedMarkerRemoved = (await host.searchText(REJECT_MARKER)).count === 0;
    if (afterReject.total >= beforeReject.total) {
      throw new Error("reject did not reduce the tracked revision count");
    }
    if (!report.rejectedMarkerRemoved) {
      throw new Error("rejected text marker remains in the document");
    }

    progress?.(i18n.t("taskpane.diagnosticsRuntime.revisions.acceptAll"));
    await insertTrackedMarker(host, BATCH_MARKER);
    const beforeAcceptAll = await host.listTrackedRevisions();
    if (beforeAcceptAll.total < 1) {
      throw new Error("accept-all fixture did not create a tracked revision");
    }
    await host.applyAllTrackedRevisions("accept");
    const afterAcceptAll = await host.listTrackedRevisions();
    report.afterAcceptAllCount = afterAcceptAll.total;
    report.batchMarkerRetained = (await host.searchText(BATCH_MARKER)).count === 1;
    if (afterAcceptAll.total !== 0) {
      throw new Error(`accept-all left ${afterAcceptAll.total} tracked revisions`);
    }
    if (!report.batchMarkerRetained) {
      throw new Error("accept-all text marker was not retained");
    }
    report.status = "passed";
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    report.status = "failed";
  } finally {
    try {
      await host.restoreFixtureTracking(originalTracking);
    } catch (error) {
      report.errors.push(
        i18n.t("taskpane.diagnosticsRuntime.revisions.restoreFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      report.status = "failed";
    }
    report.finishedAt = new Date().toISOString();
  }
  return report;
}

export class OfficeRevisionHost implements RevisionHost {
  private readonly word: OfficeJsWordAdapter;

  constructor(word: OfficeJsWordAdapter) {
    this.word = word;
  }

  metadata(): RevisionHostMetadata {
    const diagnostics = Office.context?.diagnostics;
    return {
      host: String(Office.context?.host ?? "Word"),
      platform: String(Office.context?.platform ?? "unknown"),
      version: String(diagnostics?.version ?? "unknown"),
      language: String(Office.context?.displayLanguage ?? "unknown"),
    };
  }

  supportsChangeTracking(): boolean {
    return Boolean(Office.context?.requirements?.isSetSupported?.("WordApi", "1.4"));
  }

  supportsRevisionCollection(): boolean {
    return this.word.supportsTool("revisions");
  }

  async prepareFixture(): Promise<string | null> {
    if (!this.supportsChangeTracking()) return null;
    return Word.run(async (context) => {
      const document = context.document;
      document.load("changeTrackingMode");
      await context.sync();
      const previous = String(document.changeTrackingMode);
      document.changeTrackingMode = Word.ChangeTrackingMode.off;
      await context.sync();
      document.body.clear();
      document.body.insertText(
        "WordOllama.JS WordApiDesktop 1.4 revision host fixture",
        Word.InsertLocation.start,
      );
      await context.sync();
      return previous;
    });
  }

  restoreFixtureTracking(previous: string | null): Promise<void> {
    return this.word.restoreTrackedChanges(previous);
  }

  beginTrackedChanges(): Promise<string | null> {
    return this.word.beginTrackedChanges();
  }

  restoreTrackedChanges(previous: string | null): Promise<void> {
    return this.word.restoreTrackedChanges(previous);
  }

  insertTextAtEnd(text: string): Promise<void> {
    return this.word.insertTextAtEnd(text);
  }

  listTrackedRevisions(): Promise<TrackedRevisionResult> {
    return this.word.listTrackedRevisions();
  }

  focusTrackedRevision(identity: string, index: number): Promise<void> {
    return this.word.focusTrackedRevision(identity, index);
  }

  applyTrackedRevision(
    identity: string,
    index: number,
    action: "accept" | "reject",
  ): Promise<void> {
    return this.word.applyTrackedRevision(identity, index, action);
  }

  applyAllTrackedRevisions(action: "accept" | "reject"): Promise<void> {
    return this.word.applyAllTrackedRevisions(action);
  }

  async searchText(text: string): Promise<{ count: number }> {
    const result = await this.word.searchText(text);
    return { count: result.count };
  }
}
