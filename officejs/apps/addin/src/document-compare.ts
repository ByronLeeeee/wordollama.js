import type { DocumentCompareResponse, DocumentDiff } from "./contracts";
import i18n from "./i18n.ts";
import type { RuntimeClient } from "./runtime-client";
import { streamText, type TextStreamUpdate } from "./stream-text.ts";

export const MAX_COMPARE_TOTAL_BYTES = 20 * 1024 * 1024;

type ComparableFile = Pick<File, "name" | "size" | "type">;

export interface CompareReviewItem {
  id: string;
  change: DocumentDiff;
  selected: boolean;
  applicable: boolean;
  limitation: string;
}

export function validateCompareFiles(original: ComparableFile, revised: ComparableFile): void {
  for (const [label, file] of [
    [i18n.t("taskpane.utility.compare.originalLabel"), original],
    [i18n.t("taskpane.utility.compare.revisedLabel"), revised],
  ] as const) {
    if (!file.name.toLocaleLowerCase().endsWith(".docx")) {
      throw new Error(i18n.t("taskpane.utility.compare.errors.invalidDocx", { label }));
    }
    if (file.size <= 0) {
      throw new Error(i18n.t("taskpane.utility.compare.errors.emptyFile", { label }));
    }
  }
  if (original.size + revised.size > MAX_COMPARE_TOTAL_BYTES) {
    throw new Error(i18n.t("taskpane.utility.compare.errors.totalTooLarge"));
  }
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(i18n.t("taskpane.utility.compare.errors.invalidZip", { name: file.name }));
  }
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

export function formatCompareSummary(report: DocumentCompareResponse): string {
  const summary = report.summary ?? summarizeChanges(report.changes);
  return i18n.t("taskpane.utility.compare.resultSummary", { ...summary });
}

const MAX_ANALYSIS_CONTEXT_LENGTH = 80_000;
const MAX_ANALYSIS_CHANGE_TEXT_LENGTH = 900;

/**
 * Converts the deterministic DOCX diff into compact, model-readable context.
 * The UI intentionally does not expose this raw diff; it is only used to give
 * the active provider enough evidence to explain the revision.
 */
export function buildCompareAnalysisContext(
  report: DocumentCompareResponse,
  originalName: string,
  revisedName: string,
): string {
  const summary = report.summary ?? summarizeChanges(report.changes);
  const changes = report.changes.map((change, index) => {
    const location = change.originalParagraphIndex !== null && change.originalParagraphIndex !== undefined
      ? change.originalParagraphIndex
      : change.revisedParagraphIndex ?? change.paragraphIndex;
    const original = truncateAnalysisText(change.original);
    const revised = truncateAnalysisText(change.revised);
    return [
      `${index + 1}. ${change.kind} · paragraph ${location} · ${change.blockType}`,
      `Original: ${original || "(none)"}`,
      `Revised: ${revised || "(none)"}`,
    ].join("\n");
  }).join("\n\n");

  const context = [
    `Original document: ${originalName}`,
    `Revised document: ${revisedName}`,
    `Summary: added ${summary.added}, removed ${summary.removed}, modified ${summary.modified}, unchanged ${summary.unchanged}`,
    changes || "No structural changes were detected.",
  ].join("\n\n");
  return context.slice(0, MAX_ANALYSIS_CONTEXT_LENGTH);
}

export async function analyzeCompareChanges(
  runtime: Pick<RuntimeClient, "streamChat">,
  report: DocumentCompareResponse,
  originalName: string,
  revisedName: string,
  signal?: AbortSignal,
  onUpdate?: TextStreamUpdate,
): Promise<string> {
  const context = buildCompareAnalysisContext(report, originalName, revisedName);
  const result = await streamText(runtime, [
    {
      role: "system",
      content: i18n.t("taskpane.utility.compare.analysisSystem"),
    },
    {
      role: "user",
      content: i18n.t("taskpane.utility.compare.analysisPrompt", {
        context,
        interpolation: { escapeValue: false },
      }),
    },
  ], signal, onUpdate);
  if (!result) throw new Error(i18n.t("taskpane.utility.compare.analysisEmptyResult"));
  return result;
}

function truncateAnalysisText(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  if (text.length <= MAX_ANALYSIS_CHANGE_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_ANALYSIS_CHANGE_TEXT_LENGTH)}…`;
}

export function buildComparePreview(report: DocumentCompareResponse, limit = 100): string {
  const shown = report.changes.slice(0, Math.max(0, limit));
  const lines = shown.map((change) => formatChange(change));
  if (shown.length < report.changes.length) {
    lines.push(i18n.t("taskpane.utility.compare.moreChanges", {
      count: report.changes.length - shown.length,
    }));
  }
  return lines.join("\n\n") || i18n.t("taskpane.utility.compare.noChanges");
}

export function buildCompareReviewItems(report: DocumentCompareResponse): CompareReviewItem[] {
  return report.changes.map((change, index) => {
    let limitation = "";
    if (change.kind === "modified") {
      if (!change.original || change.revised === null || change.revised === undefined) {
        limitation = i18n.t("taskpane.utility.compare.limitations.missingModifiedText");
      }
    } else if (change.kind === "removed") {
      if (change.blockType === "tableCell") {
        limitation = i18n.t("taskpane.utility.compare.limitations.tableCellRemoveUnsupported");
      } else if (!change.original) {
        limitation = i18n.t("taskpane.utility.compare.limitations.removedMissingOriginal");
      }
    } else if (change.kind === "added") {
      if (change.blockType === "tableCell") {
        limitation = i18n.t("taskpane.utility.compare.limitations.tableCellAddUnsupported");
      } else if (change.insertAfterOriginalBlockType === "tableCell") {
        limitation = i18n.t("taskpane.utility.compare.limitations.tableAfterAddUnsupported");
      } else if (!change.revised) {
        limitation = i18n.t("taskpane.utility.compare.limitations.addedMissingText");
      }
      else if (change.insertAfterOriginalParagraphIndex === null ||
               change.insertAfterOriginalParagraphIndex === undefined) {
        limitation = i18n.t("taskpane.utility.compare.limitations.addedMissingAnchor");
      }
    } else {
      limitation = i18n.t("taskpane.utility.compare.limitations.unsupportedKind", {
        kind: change.kind,
      });
    }
    return {
      id: `compare-${index + 1}`,
      change,
      selected: !limitation,
      applicable: !limitation,
      limitation,
    };
  });
}

function formatChange(change: DocumentDiff): string {
  const position = change.originalParagraphIndex && change.revisedParagraphIndex
    ? `${change.originalParagraphIndex} → ${change.revisedParagraphIndex}`
    : String(change.originalParagraphIndex ?? change.revisedParagraphIndex ?? change.paragraphIndex);
  const style = formatTransition(
    change.originalStyle,
    change.revisedStyle,
    change.style,
  );
  const location = formatTransition(
    change.originalLocation,
    change.revisedLocation,
    change.location,
  );
  const context = [change.blockType, style, location].filter(Boolean).join(" · ");
  const marker = change.kind === "added" ? "+" : change.kind === "removed" ? "−" : "~";
  const body = change.kind === "added"
    ? change.revised
    : change.kind === "removed"
      ? change.original
      : `${change.original ?? ""}\n→ ${change.revised ?? ""}`;
  return i18n.t("taskpane.utility.compare.previewChange", {
    marker,
    position,
    context: context ? ` (${context})` : "",
    body: body ?? "",
    interpolation: { escapeValue: false },
  });
}

function formatTransition(
  original: string | null | undefined,
  revised: string | null | undefined,
  fallback: string | null | undefined,
): string {
  if (original && revised && original !== revised) return `${original} → ${revised}`;
  return revised || original || fallback || "";
}

function summarizeChanges(changes: DocumentDiff[]) {
  return changes.reduce((summary, change) => {
    if (change.kind === "added") summary.added++;
    else if (change.kind === "removed") summary.removed++;
    else if (change.kind === "modified") summary.modified++;
    if (change.blockType === "tableCell") summary.tableCellChanges++;
    if (change.style?.toLocaleLowerCase().startsWith("heading") || change.style?.startsWith("标题")) {
      summary.headingChanges++;
    }
    return summary;
  }, { added: 0, removed: 0, modified: 0, unchanged: 0, tableCellChanges: 0, headingChanges: 0 });
}
