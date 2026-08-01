import { OfficeJsWordAdapter } from "../apps/addin/src/officejs-word-adapter.ts";
import type { DocumentDiff } from "../apps/addin/src/contracts.ts";

const operations: string[] = [];

class FakeParagraph {
  text: string;
  style = "";
  styleBuiltIn = "";

  constructor(text: string) {
    this.text = text;
  }

  insertParagraph(text: string, location: string): void {
    operations.push(`insert:${this.text}:${location}:${text}`);
  }

  insertText(text: string, location: string): void {
    operations.push(`replace:${this.text}:${location}:${text}`);
  }

  delete(): void {
    operations.push(`delete:${this.text}`);
  }
}

class FakeRange {
  text: string;

  constructor(text: string) {
    this.text = text;
  }

  insertText(text: string, location: string): void {
    operations.push(`range-replace:${this.text}:${location}:${text}`);
  }
}

const paragraphs = [
  new FakeParagraph("Contract"),
  new FakeParagraph("Remove this clause"),
  new FakeParagraph("Payment is 30 days"),
  new FakeParagraph("Risk level: low"),
  new FakeParagraph("Tail"),
];
const body = {
  paragraphs: {
    items: paragraphs,
    load: () => undefined,
  },
  insertParagraph: (text: string, location: string) => {
    operations.push(`body-insert:${location}:${text}`);
  },
  search: (text: string) => ({
    items: text === "Risk level: low" ? [new FakeRange(text)] : [],
    load: () => undefined,
  }),
};

(globalThis as unknown as { Office: unknown }).Office = {
  context: {
    requirements: {
      isSetSupported: () => true,
    },
  },
};
(globalThis as unknown as { Word: unknown }).Word = {
  InsertLocation: {
    start: "start",
    after: "after",
    replace: "replace",
  },
  run: async (callback: (context: unknown) => Promise<unknown>) => callback({
    document: { body },
    sync: async () => undefined,
  }),
};

const changes: DocumentDiff[] = [
  {
    kind: "added",
    paragraphIndex: 2,
    revisedParagraphIndex: 2,
    revised: "First insertion",
    blockType: "paragraph",
    insertAfterOriginalParagraphIndex: 1,
    insertAfterOriginalText: "Contract",
    insertAfterOriginalBlockType: "paragraph",
  },
  {
    kind: "added",
    paragraphIndex: 3,
    revisedParagraphIndex: 3,
    revised: "Second insertion",
    blockType: "paragraph",
    insertAfterOriginalParagraphIndex: 1,
    insertAfterOriginalText: "Contract",
    insertAfterOriginalBlockType: "paragraph",
  },
  {
    kind: "removed",
    paragraphIndex: 2,
    originalParagraphIndex: 2,
    original: "Remove this clause",
    blockType: "paragraph",
  },
  {
    kind: "modified",
    paragraphIndex: 5,
    originalParagraphIndex: 3,
    revisedParagraphIndex: 5,
    original: "Payment is 30 days",
    revised: "Payment is 15 business days",
    blockType: "paragraph",
    originalStyle: "Normal",
    revisedStyle: "Heading2",
  },
  {
    kind: "modified",
    paragraphIndex: 6,
    originalParagraphIndex: 4,
    revisedParagraphIndex: 6,
    original: "Risk level: low",
    revised: "Risk level: high",
    blockType: "tableCell",
  },
];

const adapter = new OfficeJsWordAdapter();
const applied = await adapter.applyCompareChangesBatch(changes);
if (applied.length !== changes.length) {
  throw new Error(`compare apply returned ${applied.length} results`);
}
const expected = [
  "insert:Contract:after:Second insertion",
  "insert:Contract:after:First insertion",
  "range-replace:Risk level: low:replace:Risk level: high",
  "replace:Payment is 30 days:replace:Payment is 15 business days",
  "delete:Remove this clause",
];
if (JSON.stringify(operations) !== JSON.stringify(expected)) {
  throw new Error(`unexpected compare apply plan: ${JSON.stringify(operations)}`);
}
if (paragraphs[2].styleBuiltIn !== "Heading2") {
  throw new Error("compare apply did not preserve revised built-in heading style");
}

let structuralChangeRejected = false;
try {
  await adapter.applyCompareChangesBatch([{
    kind: "added",
    paragraphIndex: 1,
    revised: "Unsafe cell",
    blockType: "tableCell",
    insertAfterOriginalParagraphIndex: 0,
  }]);
} catch (error) {
  // The adapter localizes this safety error from the host locale. The smoke
  // test verifies rejection itself instead of coupling CI to Chinese text.
  structuralChangeRejected = error instanceof Error && error.message.trim().length > 0;
}
if (!structuralChangeRejected) {
  throw new Error("compare apply accepted an unsafe structural table addition");
}

console.log("Office.js compare-to-revisions apply smoke passed.");
