import {
  MAX_COMPARE_TOTAL_BYTES,
  buildComparePreview,
  buildCompareReviewItems,
  fileToBase64,
  formatCompareSummary,
  validateCompareFiles,
} from "../apps/addin/src/document-compare.ts";
import type { DocumentCompareResponse } from "../apps/addin/src/contracts.ts";
import i18n from "../apps/addin/src/i18n.ts";

const file = (name: string, size: number) => ({ name, size, type: "application/octet-stream" }) as File;
await i18n.changeLanguage("zh-CN");
validateCompareFiles(file("original.docx", 1024), file("revised.DOCX", 2048));

let rejected = false;
try {
  validateCompareFiles(file("original.doc", 1024), file("revised.docx", 2048));
} catch (error) {
  rejected = String(error).includes(".docx");
}
if (!rejected) throw new Error("non-DOCX compare input was accepted");

rejected = false;
try {
  validateCompareFiles(
    file("original.docx", MAX_COMPARE_TOTAL_BYTES),
    file("revised.docx", 1),
  );
} catch (error) {
  rejected = String(error).includes("20 MB");
}
if (!rejected) throw new Error("oversized Base64 compare request was accepted");

const report: DocumentCompareResponse = {
  originalParagraphCount: 3,
  revisedParagraphCount: 4,
  isApproximate: true,
  algorithm: "structural-lcs-v2",
  summary: {
    added: 1,
    removed: 0,
    modified: 1,
    unchanged: 2,
    tableCellChanges: 1,
    headingChanges: 0,
  },
  changes: [
    {
      kind: "added",
      paragraphIndex: 2,
      revisedParagraphIndex: 2,
      revised: "Inserted",
      blockType: "paragraph",
      location: "paragraph:2",
    },
    {
      kind: "modified",
      paragraphIndex: 4,
      originalParagraphIndex: 3,
      revisedParagraphIndex: 4,
      original: "Risk: low",
      revised: "Risk: high",
      blockType: "tableCell",
      location: "table:1/row:1/cell:1/paragraph:1",
      originalStyle: "Normal",
      revisedStyle: "RiskCell",
      originalLocation: "table:1/row:1/cell:1/paragraph:1",
      revisedLocation: "table:2/row:1/cell:1/paragraph:1",
    },
  ],
};

const summary = formatCompareSummary(report);
if (!summary.includes("新增 1") || !summary.includes("表格单元格 1")) {
  throw new Error(`unexpected compare summary: ${summary}`);
}
const preview = buildComparePreview(report, 1);
if (!preview.includes("+ 段落 2") || !preview.includes("另有 1 项")) {
  throw new Error(`unexpected compare preview: ${preview}`);
}
const structuralPreview = buildComparePreview(report);
if (!structuralPreview.includes("Normal → RiskCell") ||
    !structuralPreview.includes("table:1/row:1/cell:1/paragraph:1 → table:2/row:1/cell:1/paragraph:1")) {
  throw new Error(`compare preview lost original/revised structure: ${structuralPreview}`);
}
const reviewItems = buildCompareReviewItems(report);
if (reviewItems[0].applicable || !reviewItems[1].applicable || !reviewItems[1].selected) {
  throw new Error("compare review applicability did not reject an unanchored addition");
}

const applicationReport: DocumentCompareResponse = {
  originalParagraphCount: 2,
  revisedParagraphCount: 4,
  isApproximate: true,
  changes: [
    {
      kind: "added",
      paragraphIndex: 2,
      revisedParagraphIndex: 2,
      revised: "Safe inserted paragraph",
      blockType: "paragraph",
      insertAfterOriginalParagraphIndex: 1,
      insertAfterOriginalText: "Anchor paragraph",
      insertAfterOriginalBlockType: "paragraph",
    },
    {
      kind: "added",
      paragraphIndex: 3,
      revisedParagraphIndex: 3,
      revised: "New table cell",
      blockType: "tableCell",
      insertAfterOriginalParagraphIndex: 1,
      insertAfterOriginalText: "Anchor paragraph",
      insertAfterOriginalBlockType: "paragraph",
    },
    {
      kind: "removed",
      paragraphIndex: 2,
      originalParagraphIndex: 2,
      original: "Old table cell",
      blockType: "tableCell",
    },
  ],
};
const applicationItems = buildCompareReviewItems(applicationReport);
if (!applicationItems[0].applicable ||
    applicationItems[1].applicable ||
    applicationItems[2].applicable ||
    !applicationItems[1].limitation.includes("表格") ||
    !applicationItems[2].limitation.includes("表格")) {
  throw new Error("compare review did not separate safe text operations from structural table changes");
}

const zipFixture = {
  name: "fixture.docx",
  arrayBuffer: async () => Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer,
} as File;
if (await fileToBase64(zipFixture) !== "UEsDBA==") {
  throw new Error("DOCX Base64 encoding failed");
}

const invalidFixture = {
  name: "invalid.docx",
  arrayBuffer: async () => Uint8Array.from([0x00, 0x01, 0x02, 0x03]).buffer,
} as File;
rejected = false;
try {
  await fileToBase64(invalidFixture);
} catch (error) {
  rejected = String(error).includes("DOCX/ZIP");
}
if (!rejected) throw new Error("invalid DOCX signature was accepted");

await i18n.changeLanguage("en-US");
const englishSummary = formatCompareSummary(report);
if (!englishSummary.includes("Added 1") || !englishSummary.includes("table cells 1")) {
  throw new Error(`English compare summary was not localized: ${englishSummary}`);
}

console.log("Office.js document compare UI smoke passed.");
