import {
  runRevisionHostMatrix,
  type RevisionHost,
  type RevisionHostMetadata,
} from "../apps/addin/src/officejs-revision-runner.ts";
import {
  trackedRevisionIdentity,
  type TrackedRevision,
  type TrackedRevisionResult,
} from "../apps/addin/src/officejs-word-adapter.ts";
import i18n from "../apps/addin/src/i18n.ts";

await i18n.changeLanguage("zh-CN");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MockRevisionHost implements RevisionHost {
  private tracking = "Off";
  private text = "";
  private revisions: TrackedRevision[] = [];
  private nextIndex = 1;
  private readonly changeTracking: boolean;
  private readonly revisionCollection: boolean;
  focused = false;

  constructor(changeTracking = true, revisionCollection = true) {
    this.changeTracking = changeTracking;
    this.revisionCollection = revisionCollection;
  }

  metadata(): RevisionHostMetadata {
    return { host: "Word", platform: "PC", version: "test", language: "zh-CN" };
  }

  supportsChangeTracking(): boolean { return this.changeTracking; }
  supportsRevisionCollection(): boolean { return this.revisionCollection; }

  async prepareFixture(): Promise<string> {
    const previous = this.tracking;
    this.tracking = "Off";
    this.text = "fixture";
    this.revisions = [];
    return previous;
  }

  async restoreFixtureTracking(previous: string | null): Promise<void> {
    this.tracking = previous ?? "Off";
  }

  async beginTrackedChanges(): Promise<string> {
    const previous = this.tracking;
    this.tracking = "TrackAll";
    return previous;
  }

  async restoreTrackedChanges(previous: string | null): Promise<void> {
    this.tracking = previous ?? "Off";
  }

  async insertTextAtEnd(text: string): Promise<void> {
    this.text += text;
    if (this.tracking === "TrackAll") {
      const fields = {
        type: "Inserted",
        author: "Mock",
        date: "2026-07-29T00:00:00.000Z",
        formatDescription: "",
        text,
      };
      this.revisions.push({
        identity: trackedRevisionIdentity(fields),
        index: this.nextIndex++,
        ...fields,
      });
    }
  }

  async listTrackedRevisions(): Promise<TrackedRevisionResult> {
    return {
      total: this.revisions.length,
      truncated: false,
      revisions: this.revisions.map((revision) => ({ ...revision })),
    };
  }

  async focusTrackedRevision(identity: string, index: number): Promise<void> {
    this.requireRevision(identity, index);
    this.focused = true;
  }

  async applyTrackedRevision(
    identity: string,
    index: number,
    action: "accept" | "reject",
  ): Promise<void> {
    const revision = this.requireRevision(identity, index);
    if (action === "reject") this.text = this.text.replace(revision.text, "");
    this.revisions = this.revisions.filter((item) => item.index !== revision.index);
  }

  async applyAllTrackedRevisions(action: "accept" | "reject"): Promise<void> {
    if (action === "reject") {
      for (const revision of this.revisions) this.text = this.text.replace(revision.text, "");
    }
    this.revisions = [];
  }

  async searchText(text: string): Promise<{ count: number }> {
    return { count: this.text.split(text).length - 1 };
  }

  private requireRevision(identity: string, index: number): TrackedRevision {
    const revision = this.revisions.find(
      (item) => item.index === index && item.identity === identity,
    );
    if (!revision) throw new Error("revision identity changed");
    return revision;
  }
}

const supported = new MockRevisionHost();
const report = await runRevisionHostMatrix(supported);
assert(report.status === "passed", `supported revision matrix failed: ${report.errors.join("; ")}`);
assert(report.focusVerified && supported.focused, "revision focus was not verified");
assert(report.acceptedMarkerRetained, "accepted marker was not retained");
assert(report.rejectedMarkerRemoved, "rejected marker was not removed");
assert(report.batchMarkerRetained, "accept-all marker was not retained");
assert(report.afterAcceptAllCount === 0, "accept-all did not clear revisions");

const unsupported = await runRevisionHostMatrix(new MockRevisionHost(false, false));
assert(unsupported.status === "unsupported", "legacy host did not degrade explicitly");
assert(
  unsupported.errors[0]?.includes("已按设计降级"),
  "legacy host degradation message is missing",
);

console.log("Office.js revision host runner smoke passed (accept, reject, accept-all, degradation).");
