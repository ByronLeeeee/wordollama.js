import i18n from "./i18n.ts";
import {
  OfficeJsWordAdapter,
  type AskHumanHandler,
  type DocumentOverview,
  type ParagraphResult,
  type SearchResult,
  type TrackedRevisionResult,
  type WordSelection,
  markdownNoteToPlainText,
  trackedRevisionIdentity,
} from "./officejs-word-adapter.ts";
import type { DocumentDiff } from "./contracts.ts";
import type { ReviewAnchor } from "./review-anchor.ts";
import { resolveReviewAnchorIndex, reviewDocumentFingerprint } from "./review-anchor.ts";
import { buildTextRevisionHunks } from "./text-revision-diff.ts";
import { resolveWpsApplication, type WpsApplication } from "./wps-host.ts";

const WPS_SUPPORTED_TOOLS = new Set([
  "get_selection", "search_text", "get_doc_overview", "insert_text_at_end",
  "read_paragraphs", "read_large_chunk", "build_semantic_map", "read_comments",
  "read_bookmarks", "apply_style", "replace_paragraph", "insert_at_cursor",
  "add_comment", "find_replace", "format_paragraph", "format_text",
  "insert_page_break", "read_table", "insert_table", "table_insert_row",
  "table_set_cell", "edit_table_structure", "format_table", "get_document_outline", "read_clause", "extract_definitions",
  "check_cross_references", "insert_clause_after", "highlight_risk",
  "apply_legal_format", "validate_citation", "format_list", "page_setup",
  "header_footer", "update_toc", "replace_exact_text", "insert_image",
  "revisions", "ask_human",
]);

const PARAGRAPH_ALIGNMENT: Record<string, number> = {
  left: 0,
  centered: 1,
  center: 1,
  right: 2,
  justified: 3,
  justify: 3,
};

const HIGHLIGHT_COLORS: Record<string, number> = {
  yellow: 7,
  brightgreen: 4,
  turquoise: 3,
  pink: 5,
  blue: 2,
  red: 6,
  darkblue: 9,
  teal: 10,
  green: 11,
  violet: 12,
  darkred: 13,
  darkyellow: 14,
  gray50: 15,
  gray25: 16,
  black: 1,
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\r\u0007/gu, "\n").replace(/\r/gu, "\n");
}

function paragraphTexts(application: WpsApplication): string[] {
  const contentText = application.ActiveDocument?.Content?.Text;
  if (typeof contentText === "string") {
    // Crossing the WPS JS/native boundary once per paragraph can freeze the
    // task pane for large documents. Content.Text preserves paragraph marks
    // (and table cell end markers), which cleanText normalizes consistently.
    return cleanText(contentText).split("\n");
  }
  const paragraphs = application.ActiveDocument?.Paragraphs;
  const count = Number(paragraphs?.Count ?? 0);
  if (count > 0 && typeof paragraphs?.Item === "function") {
    const values: string[] = [];
    for (let index = 1; index <= count; index += 1) {
      values.push(cleanText(paragraphs.Item(index)?.Range?.Text).replace(/\n+$/gu, ""));
    }
    return values;
  }
  return cleanText(application.ActiveDocument?.Content?.Text).split("\n");
}

function unsupported(feature: string): never {
  throw new Error(i18n.t("taskpane.wordAdapter.errors.wpsFeatureUnsupported", { feature }));
}

function requireCollectionItem(collection: any, index: number, label: string): any {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  const item = collection?.Item?.(index);
  if (!item) throw new Error(`${label} ${index} is out of range`);
  return item;
}

function rangeText(range: any): string {
  return cleanText(range?.Text).replace(/\n+$/gu, "");
}

function setRangeText(range: any, text: string): void {
  if (!range) unsupported("range text");
  range.Text = text;
}

function isSafeTextSelection(selection: any): boolean {
  if (!selection) return false;
  const selectionType = Number(selection.Type);
  // wdSelectionNormal = 2. Unknown is allowed for older WPS builds that do
  // not expose Selection.Type, but known block/table selections are not.
  if (Number.isFinite(selectionType) && selectionType !== 2) return false;
  if (Number(selection.Comments?.Count ?? 0) > 0) return false;
  try {
    // wdWithinTable = 12. Typing over a table selection can produce an
    // unpredictable result in WPS, so table text is edited via Cell.Range.
    if (typeof selection.Information === "function" && selection.Information(12)) return false;
  } catch {
    return false;
  }
  return true;
}

function replaceCurrentSelectionByTyping(
  application: WpsApplication,
  text: string,
  deleteExisting = true,
): boolean {
  const selection = application.Selection;
  if (!isSafeTextSelection(selection) ||
      typeof selection.Delete !== "function" || typeof selection.TypeText !== "function") {
    return false;
  }
  if (deleteExisting) selection.Delete();
  if (text) selection.TypeText(text);
  return true;
}

function replaceRangeByTyping(
  application: WpsApplication,
  range: any,
  text: string,
  deleteExisting = true,
): boolean {
  if (!range || typeof range.Select !== "function") return false;
  range.Select();
  return replaceCurrentSelectionByTyping(application, text, deleteExisting);
}

function insertAtRange(application: WpsApplication, range: any, text: string): boolean {
  if (!range || !text) return Boolean(range);
  // WPS can ignore Selection.TypeText for some collapsed/native selection
  // states. Range insertion is the documented text insertion path and is
  // recorded as an insertion revision while TrackRevisions is enabled.
  if (typeof range.InsertBefore === "function") {
    range.InsertBefore(text);
    return true;
  }
  if (typeof range.Select !== "function") return false;
  range.Select();
  return replaceCurrentSelectionByTyping(application, text, false);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function revisionDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return String(value ?? "");
}

function temporaryFilePath(application: WpsApplication, extension: string): string {
  const fileSystem = application.FileSystem;
  const root = String(
    application.Env?.GetTempPath?.() ?? fileSystem?.tmpdir?.() ?? "",
  );
  if (!root) unsupported("temporary files");
  const separator = /[\\/]$/u.test(root) ? "" : root.includes("\\") ? "\\" : "/";
  return `${root}${separator}wordollama-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
}

async function removeTemporaryFile(application: WpsApplication, path: string): Promise<void> {
  const fileSystem = application.FileSystem;
  try {
    if (typeof fileSystem?.Remove === "function") await Promise.resolve(fileSystem.Remove(path));
    else if (typeof fileSystem?.unlinkSync === "function") fileSystem.unlinkSync(path);
  } catch {
    // The image/document is already embedded. A locked temporary file can be
    // reclaimed by the operating system later without failing the Word action.
  }
}

function styleName(value: any): string {
  if (typeof value === "string") return value;
  return String(value?.NameLocal ?? value?.Name ?? "");
}

const CSS_COLOR_NAMES: Record<string, string> = {
  aqua: "00ffff", black: "000000", blue: "0000ff", fuchsia: "ff00ff",
  gray: "808080", green: "008000", grey: "808080", lime: "00ff00",
  maroon: "800000", navy: "000080", olive: "808000", orange: "ffa500",
  purple: "800080", red: "ff0000", silver: "c0c0c0", teal: "008080",
  white: "ffffff", yellow: "ffff00",
};

function cssColorToWps(value: string): number {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "automatic" || normalized === "auto") return -16777216;
  const named = CSS_COLOR_NAMES[normalized];
  const shortHex = /^#([0-9a-f]{3})$/iu.exec(normalized)?.[1];
  const fullHex = /^#([0-9a-f]{6})$/iu.exec(normalized)?.[1]
    ?? (shortHex ? shortHex.split("").map((part) => `${part}${part}`).join("") : named);
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/iu.exec(normalized);
  if (!fullHex && !rgb) {
    throw new Error("color must be #RGB, #RRGGBB, rgb(r,g,b), or a standard color name");
  }
  const red = rgb ? Number(rgb[1]) : Number.parseInt(fullHex!.slice(0, 2), 16);
  const green = rgb ? Number(rgb[2]) : Number.parseInt(fullHex!.slice(2, 4), 16);
  const blue = rgb ? Number(rgb[3]) : Number.parseInt(fullHex!.slice(4, 6), 16);
  if ([red, green, blue].some((part) => part < 0 || part > 255)) {
    throw new Error("rgb color components must be between 0 and 255");
  }
  return red | (green << 8) | (blue << 16);
}

function applyNamedStyleToHtmlRoot(html: string, style: string): string {
  const safeStyle = style.trim().replace(/["'<>]/gu, "");
  if (!safeStyle) return html;
  const root = /^(\s*<[a-z][a-z0-9:-]*\b)([^>]*)(>)/iu.exec(html);
  if (!root) return html;
  let attributes = root[2];
  if (/\sstyle\s*=/iu.test(attributes)) {
    attributes = attributes.replace(
      /(\sstyle\s*=\s*["'])/iu,
      `$1mso-style-name: '${safeStyle}'; `,
    );
  } else {
    attributes += ` style="mso-style-name: '${safeStyle}'"`;
  }
  return `${root[1]}${attributes}${root[3]}${html.slice(root[0].length)}`;
}

function insertTextAtHtmlRoot(html: string, text: string): string {
  const openingTag = /^\s*<[a-z][a-z0-9:-]*\b[^>]*>/iu.exec(html);
  if (!openingTag) return `${escapeHtml(text)}${html}`;
  return `${html.slice(0, openingTag[0].length)}${escapeHtml(text)}${html.slice(openingTag[0].length)}`;
}

function findTextRange(document: any, text: string): any | null {
  const range = document?.Content?.Duplicate;
  const find = range?.Find;
  if (!range || typeof find?.Execute !== "function") return null;
  try { find.ClearFormatting?.(); } catch { /* optional WPS API */ }
  return find.Execute(text) ? range : null;
}

function borderWidthToWps(points: number): number {
  if (!Number.isFinite(points) || points <= 0) throw new Error("border_width must be greater than 0");
  const supported = [
    { points: 0.25, value: 2 }, { points: 0.5, value: 4 },
    { points: 0.75, value: 6 }, { points: 1, value: 8 },
    { points: 1.5, value: 12 }, { points: 2.25, value: 18 },
    { points: 3, value: 24 }, { points: 4.5, value: 36 },
    { points: 6, value: 48 },
  ];
  return supported.reduce((nearest, candidate) =>
    Math.abs(candidate.points - points) < Math.abs(nearest.points - points) ? candidate : nearest).value;
}

export class WpsWordAdapter extends OfficeJsWordAdapter {
  private activeUndoSnapshot: { token: string; maximumCharacters: number; documentName: string } | null = null;
  private completedUndoSnapshots = new Map<string, { documentName: string; afterXml: string }>();

  constructor(askHumanHandler?: AskHumanHandler) {
    super(askHumanHandler);
  }

  private application(): WpsApplication {
    return resolveWpsApplication() ?? unsupported("WPS host");
  }

  override supportsTool(name: string): boolean {
    if (!WPS_SUPPORTED_TOOLS.has(name)) return false;
    const application = resolveWpsApplication();
    const document = application?.ActiveDocument;
    if (!application || !document) return false;
    const selection = application.Selection;
    switch (name) {
      case "validate_citation":
      case "ask_human":
        return true;
      case "get_selection":
        return Boolean(selection);
      case "search_text":
      case "get_doc_overview":
      case "read_paragraphs":
      case "read_large_chunk":
      case "build_semantic_map":
      case "read_clause":
      case "extract_definitions":
      case "check_cross_references":
        return Boolean(document.Content || document.Paragraphs);
      case "insert_text_at_end":
        return typeof document.Content?.InsertAfter === "function";
      case "read_comments":
        return typeof document.Comments?.Item === "function";
      case "read_bookmarks":
        return typeof document.Bookmarks?.Item === "function";
      case "apply_style":
      case "replace_paragraph":
      case "format_paragraph":
      case "get_document_outline":
      case "insert_clause_after":
      case "apply_legal_format":
        return typeof document.Paragraphs?.Item === "function";
      case "insert_at_cursor":
        return Boolean(selection && (typeof selection.TypeText === "function" || "Text" in selection));
      case "add_comment":
        return typeof document.Comments?.Add === "function";
      case "find_replace":
      case "replace_exact_text":
        return Boolean(document.Content || document.Paragraphs);
      case "format_text":
        return Boolean(selection?.Font);
      case "insert_page_break":
        return typeof selection?.InsertBreak === "function";
      case "read_table":
      case "table_insert_row":
      case "table_set_cell":
      case "edit_table_structure":
      case "format_table":
        return typeof document.Tables?.Item === "function";
      case "insert_table":
        return typeof document.Tables?.Add === "function";
      case "highlight_risk":
        return typeof document.Range === "function" && Boolean(document.Content);
      case "format_list":
        return Boolean(selection?.Range?.ListFormat);
      case "page_setup":
        return Boolean(document.PageSetup);
      case "header_footer":
        return typeof document.Sections?.Item === "function";
      case "update_toc":
        return Boolean(document.TablesOfContents &&
          (typeof document.TablesOfContents.Item === "function" ||
           typeof document.TablesOfContents.Add === "function"));
      case "insert_image":
        return typeof document.InlineShapes?.AddPicture === "function" &&
          typeof application.FileSystem?.writeAsBinaryString === "function" &&
          Boolean(application.Env?.GetTempPath || application.FileSystem?.tmpdir);
      case "revisions":
        return "TrackRevisions" in document && typeof document.Revisions?.Item === "function";
      default:
        return false;
    }
  }

  override async captureDocumentSnapshot(maximumCharacters = 8_000_000): Promise<string | null> {
    const application = this.application();
    const document = application.ActiveDocument;
    const undoRecord = (application as any).UndoRecord;
    const xml = document?.WordOpenXML;
    if (!document || typeof xml !== "string" || xml.length > maximumCharacters ||
        typeof undoRecord?.StartCustomRecord !== "function" ||
        typeof undoRecord?.EndCustomRecord !== "function" ||
        typeof document.Undo !== "function" || undoRecord.IsRecordingCustomRecord ||
        Number(undoRecord.CustomRecordLevel ?? 0) > 0) {
      return null;
    }
    this.completedUndoSnapshots.clear();
    const token = `wps-undo:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    undoRecord.StartCustomRecord("WordOllama.JS Agent");
    this.activeUndoSnapshot = {
      token,
      maximumCharacters,
      documentName: String(document.FullName ?? ""),
    };
    return token;
  }

  override async finalizeDocumentSnapshot(snapshot: string | null): Promise<string | null> {
    const active = this.activeUndoSnapshot;
    if (!snapshot || !active || active.token !== snapshot) return snapshot;
    const application = this.application();
    const document = application.ActiveDocument;
    try {
      (application as any).UndoRecord.EndCustomRecord();
    } finally {
      this.activeUndoSnapshot = null;
    }
    const afterXml = document?.WordOpenXML;
    if (typeof afterXml !== "string" || afterXml.length > active.maximumCharacters) return null;
    this.completedUndoSnapshots.set(snapshot, {
      documentName: active.documentName,
      afterXml,
    });
    return snapshot;
  }

  override async restoreDocumentSnapshot(snapshot: string): Promise<void> {
    const completed = this.completedUndoSnapshots.get(snapshot);
    const document = this.application().ActiveDocument;
    if (!completed || !document || String(document.FullName ?? "") !== completed.documentName ||
        document.WordOpenXML !== completed.afterXml || typeof document.Undo !== "function") {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.snapshotUnavailable"));
    }
    const undone = await Promise.resolve(document.Undo(1));
    if (undone === false) throw new Error(i18n.t("taskpane.wordAdapter.errors.snapshotUnavailable"));
    this.completedUndoSnapshots.delete(snapshot);
  }

  override async beginTrackedChanges(): Promise<string | null> {
    const document = this.application().ActiveDocument;
    if (!document || !("TrackRevisions" in document)) return null;
    const previous = document.TrackRevisions ? "true" : "false";
    document.TrackRevisions = true;
    return previous;
  }

  override async restoreTrackedChanges(previous: string | null): Promise<void> {
    if (previous === null) return;
    const document = this.application().ActiveDocument;
    if (document && "TrackRevisions" in document) {
      document.TrackRevisions = previous === "true";
    }
  }

  override async listTrackedRevisions(limit = 200): Promise<TrackedRevisionResult> {
    const revisions = this.application().ActiveDocument?.Revisions;
    if (!revisions || typeof revisions.Item !== "function") unsupported("revisions");
    const total = Number(revisions.Count ?? 0);
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 200));
    const visible = Math.min(total, boundedLimit);
    const result: TrackedRevisionResult["revisions"] = [];
    for (let index = 1; index <= visible; index += 1) {
      const revision = revisions.Item(index);
      const fields = {
        type: String(revision?.Type ?? ""),
        author: String(revision?.Author ?? ""),
        date: revisionDate(revision?.Date),
        formatDescription: String(revision?.FormatDescription ?? ""),
        text: cleanText(revision?.Range?.Text),
      };
      result.push({ identity: trackedRevisionIdentity(fields), index, ...fields });
    }
    return { total, truncated: total > visible, revisions: result };
  }

  override async focusTrackedRevision(identity: string, index: number): Promise<void> {
    await this.performWpsRevisionAction(identity, index, "focus");
  }

  override async applyTrackedRevision(
    identity: string,
    index: number,
    action: "accept" | "reject",
  ): Promise<void> {
    await this.performWpsRevisionAction(identity, index, action);
  }

  override async applyAllTrackedRevisions(action: "accept" | "reject"): Promise<void> {
    const document = this.application().ActiveDocument;
    const revisions = document?.Revisions;
    if (!revisions) unsupported("revisions");
    if (action === "accept") {
      if (typeof revisions.AcceptAll === "function") revisions.AcceptAll();
      else if (typeof document.AcceptAllRevisions === "function") document.AcceptAllRevisions();
      else unsupported("accept all revisions");
    } else if (typeof revisions.RejectAll === "function") revisions.RejectAll();
    else if (typeof document.RejectAllRevisions === "function") document.RejectAllRevisions();
    else unsupported("reject all revisions");
  }

  private async performWpsRevisionAction(
    identity: string,
    index: number,
    action: "focus" | "accept" | "reject",
  ): Promise<void> {
    if (!identity || !Number.isInteger(index) || index < 1) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.safeRevisionUnsupported"));
    }
    const revisions = this.application().ActiveDocument?.Revisions;
    if (!revisions || typeof revisions.Item !== "function" || index > Number(revisions.Count ?? 0)) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.revisionListChanged"));
    }
    const revision = revisions.Item(index);
    const currentIdentity = trackedRevisionIdentity({
      type: String(revision?.Type ?? ""),
      author: String(revision?.Author ?? ""),
      date: revisionDate(revision?.Date),
      formatDescription: String(revision?.FormatDescription ?? ""),
      text: cleanText(revision?.Range?.Text),
    });
    if (currentIdentity !== identity) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.targetRevisionChanged"));
    }
    if (action === "focus") {
      if (typeof revision?.Range?.Select !== "function") unsupported("focus revision");
      revision.Range.Select();
    } else if (action === "accept") {
      if (typeof revision?.Accept !== "function") unsupported("accept revision");
      revision.Accept();
    } else {
      if (typeof revision?.Reject !== "function") unsupported("reject revision");
      revision.Reject();
    }
  }

  override async getSelection(): Promise<WordSelection> {
    const application = this.application();
    return {
      text: cleanText(application.Selection?.Text),
      documentUrl: String(application.ActiveDocument?.FullName ?? "") || undefined,
    };
  }

  override async replaceSelection(text: string): Promise<void> {
    const application = this.application();
    const selection = application.Selection;
    if (!selection) unsupported("replace selection");
    if (!replaceCurrentSelectionByTyping(application, text)) {
      if (application.ActiveDocument?.TrackRevisions && !isSafeTextSelection(selection)) {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.safeRevisionUnsupported"));
      }
      selection.Text = text;
    }
  }

  override async applyPreciseRevision(original: string, revised: string): Promise<boolean> {
    const application = this.application();
    const selection = application.Selection;
    if (!selection || cleanText(selection.Text) !== cleanText(original)) return false;
    if (!isSafeTextSelection(selection)) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.safeRevisionUnsupported"));
    }
    const hunks = buildTextRevisionHunks(original, revised);
    if (!hunks.length) return true;
    const previousTrackingMode = await this.beginTrackedChanges();
    if (previousTrackingMode === null) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.safeRevisionUnsupported"));
    }
    try {
      const selectionStart = Number(selection.Range?.Start);
      const document = application.ActiveDocument;
      if (!Number.isFinite(selectionStart) || typeof document?.Range !== "function") {
        await this.replaceSelection(revised);
        return false;
      }
      const targets = hunks.map((hunk) => {
        const start = selectionStart + hunk.originalStart;
        const range = document.Range(start, start + hunk.originalText.length);
        return { hunk, start, valid: range && cleanText(range.Text) === cleanText(hunk.originalText) };
      });
      const canApplyPrecisely = targets.every(({ valid }) => valid);
      if (!canApplyPrecisely ||
          typeof selection.Delete !== "function" ||
          typeof selection.TypeText !== "function") {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.safeRevisionUnsupported"));
      }
      for (const { hunk, start } of [...targets].reverse()) {
        // WPS can drop TypeText at a collapsed selection, leaving only deletion
        // revisions. Insert the revised text through a native Range first, then
        // delete the now-shifted original text as a separate tracked change.
        if (hunk.revisedText) {
          const insertionPoint = document.Range(start, start);
          if (!insertAtRange(application, insertionPoint, hunk.revisedText)) {
            throw new Error(i18n.t("taskpane.wordAdapter.errors.safeRevisionUnsupported"));
          }
          const insertedRange = document.Range(start, start + hunk.revisedText.length);
          if (cleanText(insertedRange?.Text) !== cleanText(hunk.revisedText)) {
            throw new Error(i18n.t("taskpane.wordAdapter.errors.safeRevisionUnsupported"));
          }
        }
        if (hunk.originalText) {
          const deletionStart = start + hunk.revisedText.length;
          const deletionRange = document.Range(
            deletionStart,
            deletionStart + hunk.originalText.length,
          );
          if (cleanText(deletionRange?.Text) !== cleanText(hunk.originalText) ||
              !replaceRangeByTyping(application, deletionRange, "", true)) {
            throw new Error(i18n.t("taskpane.wordAdapter.errors.safeRevisionUnsupported"));
          }
        }
      }
      return true;
    } finally {
      await this.restoreTrackedChanges(previousTrackingMode);
    }
  }

  override async searchText(keyword: string): Promise<SearchResult> {
    const normalized = keyword.trim();
    if (!normalized) return { keyword, count: 0, matches: [], locations: [] };
    const paragraphs = paragraphTexts(this.application());
    const locations: SearchResult["locations"] = [];
    for (let index = 0; index < paragraphs.length; index += 1) {
      const text = paragraphs[index];
      let offset = 0;
      while ((offset = text.indexOf(normalized, offset)) >= 0) {
        locations.push({
          paragraph: index + 1,
          text: normalized,
          context: text.slice(Math.max(0, offset - 80), offset + normalized.length + 80),
        });
        offset += Math.max(1, normalized.length);
      }
    }
    return {
      keyword,
      count: locations.length,
      matches: locations.map((item) => item.context),
      locations,
    };
  }

  override async getDocumentOverview(): Promise<DocumentOverview> {
    const paragraphs = paragraphTexts(this.application());
    return { paragraphCount: paragraphs.length, preview: paragraphs.slice(0, 20) };
  }

  override async insertTextAtEnd(text: string): Promise<void> {
    const content = this.application().ActiveDocument?.Content;
    if (typeof content?.InsertAfter !== "function") unsupported("insert at document end");
    content.InsertAfter(text);
  }

  override async readParagraphs(start: number, end: number): Promise<ParagraphResult> {
    const paragraphs = paragraphTexts(this.application());
    if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start) {
      throw new Error("start and end must be positive paragraph indexes");
    }
    if (start > paragraphs.length) {
      throw new Error(`paragraph ${start} is out of range (total ${paragraphs.length})`);
    }
    const boundedStart = start;
    const boundedEnd = Math.min(paragraphs.length, end);
    return {
      start: boundedStart,
      end: boundedEnd,
      paragraphs: paragraphs.slice(boundedStart - 1, boundedEnd),
    };
  }

  override async readLargeChunk(startParagraph: number): Promise<ParagraphResult> {
    return this.readParagraphs(startParagraph, startParagraph + 50);
  }

  override async buildSemanticMap(): Promise<{ paragraphCount: number; entries: Array<{ start: number; end: number; summary: string }> }> {
    const paragraphs = paragraphTexts(this.application());
    const entries = [];
    for (let offset = 0; offset < paragraphs.length; offset += 25) {
      const end = Math.min(paragraphs.length, offset + 25);
      entries.push({ start: offset + 1, end, summary: paragraphs.slice(offset, end).join(" ").slice(0, 240) });
    }
    return { paragraphCount: paragraphs.length, entries };
  }

  override async replaceParagraph(paragraphIndex: number, text: string): Promise<void> {
    const application = this.application();
    const paragraph = application.ActiveDocument?.Paragraphs?.Item?.(paragraphIndex);
    if (!paragraph?.Range) unsupported("replace paragraph");
    if (application.ActiveDocument?.TrackRevisions) {
      if (replaceRangeByTyping(application, paragraph.Range, `${text}\r`)) return;
      throw new Error(i18n.t("taskpane.wordAdapter.errors.safeRevisionUnsupported"));
    }
    paragraph.Range.Text = `${text}\r`;
  }

  override async insertAfterParagraph(paragraphIndex: number, text: string): Promise<void> {
    const range = this.application().ActiveDocument?.Paragraphs?.Item?.(paragraphIndex)?.Range;
    if (typeof range?.InsertAfter !== "function") unsupported("insert after paragraph");
    range.InsertAfter(`${text}\r`);
  }

  override async insertAfterSelection(text: string): Promise<void> {
    const selection = this.application().Selection;
    if (typeof selection?.InsertAfter !== "function") unsupported("insert after selection");
    selection.InsertAfter(text);
  }

  override async insertAtCursor(text: string): Promise<void> {
    const selection = this.application().Selection;
    if (typeof selection?.TypeText === "function") selection.TypeText(text);
    else if (typeof selection?.InsertAfter === "function") selection.InsertAfter(text);
    else unsupported("insert at cursor");
  }

  override async addComment(text: string): Promise<void> {
    const application = this.application();
    const comments = application.ActiveDocument?.Comments;
    if (typeof comments?.Add !== "function") unsupported("comments");
    comments.Add(application.Selection?.Range, text);
  }

  override async readComments(): Promise<Array<{ author: string; content: string; resolved: boolean }>> {
    const comments = this.application().ActiveDocument?.Comments;
    const result: Array<{ author: string; content: string; resolved: boolean }> = [];
    for (let index = 1; index <= Number(comments?.Count ?? 0); index += 1) {
      const comment = comments.Item(index);
      result.push({
        author: String(comment?.Author ?? ""),
        content: cleanText(comment?.Range?.Text ?? comment?.Content),
        resolved: false,
      });
    }
    return result;
  }

  override async readBookmarks(): Promise<Array<{ name: string; start: number; end: number; text: string }>> {
    const bookmarks = this.application().ActiveDocument?.Bookmarks;
    const result: Array<{ name: string; start: number; end: number; text: string }> = [];
    for (let index = 1; index <= Number(bookmarks?.Count ?? 0); index += 1) {
      const bookmark = bookmarks.Item(index);
      result.push({
        name: String(bookmark?.Name ?? ""),
        start: Number(bookmark?.Start ?? bookmark?.Range?.Start ?? 0),
        end: Number(bookmark?.End ?? bookmark?.Range?.End ?? 0),
        text: rangeText(bookmark?.Range),
      });
    }
    return result;
  }

  override async applyStyle(paragraphIndex: number, requestedStyle: string): Promise<void> {
    if (!requestedStyle.trim()) throw new Error("style_name is required");
    const paragraph = requireCollectionItem(
      this.application().ActiveDocument?.Paragraphs,
      paragraphIndex,
      "paragraph",
    );
    paragraph.Style = requestedStyle.trim();
  }

  override async findReplace(find: string, replace: string): Promise<{ count: number }> {
    const count = (await this.searchText(find)).count;
    const finder = this.application().ActiveDocument?.Content?.Find;
    if (!finder || typeof finder.Execute !== "function") unsupported("find and replace");
    finder.ClearFormatting?.();
    finder.Replacement?.ClearFormatting?.();
    finder.Text = find;
    finder.Replacement.Text = replace;
    finder.Execute(null, null, null, null, null, null, null, null, null, null, 2);
    return { count };
  }

  override async formatParagraph(
    paragraphIndex: number,
    alignment?: string,
    spaceBefore?: number,
    spaceAfter?: number,
  ): Promise<void> {
    const paragraph = requireCollectionItem(
      this.application().ActiveDocument?.Paragraphs,
      paragraphIndex,
      "paragraph",
    );
    const format = paragraph.Format ?? paragraph.Range?.ParagraphFormat ?? paragraph;
    if (alignment) {
      const value = PARAGRAPH_ALIGNMENT[alignment.toLocaleLowerCase()];
      if (value === undefined) throw new Error("alignment must be Left, Centered, Right or Justified");
      format.Alignment = value;
    }
    if (typeof spaceBefore === "number") format.SpaceBefore = spaceBefore;
    if (typeof spaceAfter === "number") format.SpaceAfter = spaceAfter;
  }

  override async formatText(options: { bold?: boolean; italic?: boolean; underline?: boolean; fontName?: string; fontSize?: number; color?: string }): Promise<void> {
    const font = this.application().Selection?.Font;
    if (!font) unsupported("text formatting");
    if (options.bold !== undefined) font.Bold = options.bold ? 1 : 0;
    if (options.italic !== undefined) font.Italic = options.italic ? 1 : 0;
    if (options.underline !== undefined) font.Underline = options.underline ? 1 : 0;
    if (options.fontName) font.Name = options.fontName;
    if (options.fontSize) font.Size = options.fontSize;
    if (options.color) font.Color = cssColorToWps(options.color);
  }

  override async insertPageBreak(): Promise<void> {
    const selection = this.application().Selection;
    if (typeof selection?.InsertBreak !== "function") unsupported("page break");
    selection.InsertBreak();
  }

  override async readTable(tableIndex: number): Promise<{ tableIndex: number; rows: string[][] }> {
    const table = requireCollectionItem(this.application().ActiveDocument?.Tables, tableIndex, "table");
    const rows: string[][] = [];
    const rowCount = Number(table.Rows?.Count ?? 0);
    const columnCount = Number(table.Columns?.Count ?? 0);
    for (let row = 1; row <= rowCount; row += 1) {
      const values: string[] = [];
      for (let column = 1; column <= columnCount; column += 1) {
        values.push(rangeText(table.Cell(row, column)?.Range));
      }
      rows.push(values);
    }
    return { tableIndex, rows };
  }

  override async insertTable(rows: number, columns: number, headerRow?: string[]): Promise<void> {
    if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1) {
      throw new Error("rows and columns must be positive integers");
    }
    const document = this.application().ActiveDocument;
    const range = document?.Content?.Duplicate ?? document?.Content;
    if (!range || typeof document?.Tables?.Add !== "function") unsupported("insert table");
    range.Collapse?.(0);
    const table = document.Tables.Add(range, rows, columns);
    for (let column = 1; column <= Math.min(columns, headerRow?.length ?? 0); column += 1) {
      setRangeText(table.Cell(1, column)?.Range, String(headerRow?.[column - 1] ?? ""));
    }
  }

  override async insertStructuredTable(headers: string[], rows: string[][]): Promise<void> {
    if (!headers.length) throw new Error("headers must not be empty");
    const document = this.application().ActiveDocument;
    const range = this.application().Selection?.Range;
    if (!range || typeof document?.Tables?.Add !== "function") unsupported("insert structured table");
    range.Text = "";
    const table = document.Tables.Add(range, rows.length + 1, headers.length);
    const values = [headers, ...rows];
    for (let row = 1; row <= values.length; row += 1) {
      for (let column = 1; column <= headers.length; column += 1) {
        setRangeText(table.Cell(row, column)?.Range, String(values[row - 1]?.[column - 1] ?? ""));
      }
    }
    if (table.Rows?.Item?.(1)?.Range?.Font) table.Rows.Item(1).Range.Font.Bold = 1;
    table.Columns?.AutoFit?.();
  }

  override async insertTableRow(tableIndex: number, afterRow?: number): Promise<void> {
    const table = requireCollectionItem(this.application().ActiveDocument?.Tables, tableIndex, "table");
    if (typeof table.Rows?.Add !== "function") unsupported("insert table row");
    const rowCount = Number(table.Rows.Count ?? 0);
    if (typeof afterRow === "number") {
      if (!Number.isInteger(afterRow) || afterRow < 1 || afterRow > rowCount) {
        throw new Error(`row ${afterRow} is out of range`);
      }
      if (afterRow < rowCount) table.Rows.Add(table.Rows.Item(afterRow + 1));
      else table.Rows.Add();
    } else {
      table.Rows.Add();
    }
  }

  override async setTableCell(
    tableIndex: number,
    rowIndex: number,
    columnIndex: number,
    text: string,
  ): Promise<void> {
    const table = requireCollectionItem(this.application().ActiveDocument?.Tables, tableIndex, "table");
    if (!Number.isInteger(rowIndex) || rowIndex < 1 || !Number.isInteger(columnIndex) || columnIndex < 1) {
      throw new Error("row and column must be positive integers");
    }
    const cell = table.Cell?.(rowIndex, columnIndex);
    if (!cell?.Range) throw new Error(`table cell ${rowIndex},${columnIndex} is out of range`);
    setRangeText(cell.Range, text);
  }

  override async focusToolTarget(name: string, args: Record<string, unknown>): Promise<boolean> {
    const application = this.application();
    const paragraphIndex = Number(args.paragraph_index ?? 0);
    const tableIndex = Number(args.table_index ?? 0);
    const row = Number(args.row ?? 0);
    const column = Number(args.column ?? 0);
    const searchText = String(args.keyword ?? args.find ?? args.anchor ?? "").trim();
    if (Number.isInteger(paragraphIndex) && paragraphIndex > 0) {
      const paragraph = application.ActiveDocument?.Paragraphs?.Item?.(paragraphIndex);
      if (!paragraph?.Range?.Select) return false;
      paragraph.Range.Select();
      return true;
    }
    if (Number.isInteger(tableIndex) && tableIndex > 0) {
      const table = application.ActiveDocument?.Tables?.Item?.(tableIndex);
      const range = row > 0 && column > 0 ? table?.Cell?.(row, column)?.Range : table?.Range;
      if (!range?.Select) return false;
      range.Select();
      return true;
    }
    if (searchText) {
      const range = application.ActiveDocument?.Content?.Duplicate;
      const find = range?.Find;
      if (!range || !find || typeof find.Execute !== "function") return false;
      if (!find.Execute(searchText.slice(0, 200))) return false;
      range.Select?.();
      return true;
    }
    return false;
  }

  override async editTableStructure(
    tableIndex: number,
    action: string,
    options: { row?: number; column?: number; endRow?: number; endColumn?: number; count?: number } = {},
  ): Promise<void> {
    const table = requireCollectionItem(this.application().ActiveDocument?.Tables, tableIndex, "table");
    const row = Math.max(1, Math.trunc(options.row ?? 1));
    const column = Math.max(1, Math.trunc(options.column ?? 1));
    const count = Math.max(1, Math.trunc(options.count ?? 1));
    switch (action.toLocaleLowerCase()) {
      case "insert_row":
        if (row > Number(table.Rows?.Count ?? 0) || typeof table.Rows?.Add !== "function") {
          throw new Error(`table row ${row} is out of range`);
        }
        for (let index = 0; index < count; index += 1) {
          const before = row < Number(table.Rows.Count) ? table.Rows.Item?.(row + 1) : undefined;
          if (before) table.Rows.Add(before);
          else table.Rows.Add();
        }
        break;
      case "delete_row":
        if (row + count - 1 > Number(table.Rows?.Count ?? 0) || typeof table.Rows?.Item !== "function") {
          throw new Error(`table rows ${row}-${row + count - 1} are out of range`);
        }
        for (let index = 0; index < count; index += 1) {
          const target = table.Rows.Item(row);
          if (typeof target?.Delete !== "function") unsupported("delete table row");
          target.Delete();
        }
        break;
      case "insert_column":
        if (column > Number(table.Columns?.Count ?? 0) || typeof table.Columns?.Add !== "function") {
          throw new Error(`table column ${column} is out of range`);
        }
        for (let index = 0; index < count; index += 1) {
          const before = column < Number(table.Columns.Count) ? table.Columns.Item?.(column + 1) : undefined;
          if (before) table.Columns.Add(before);
          else table.Columns.Add();
        }
        break;
      case "delete_column":
        if (column + count - 1 > Number(table.Columns?.Count ?? 0) || typeof table.Columns?.Item !== "function") {
          throw new Error(`table columns ${column}-${column + count - 1} are out of range`);
        }
        for (let index = 0; index < count; index += 1) {
          const target = table.Columns.Item(column);
          if (typeof target?.Delete !== "function") unsupported("delete table column");
          target.Delete();
        }
        break;
      case "merge_cells": {
        const start = table.Cell?.(row, column);
        const end = table.Cell?.(options.endRow ?? row, options.endColumn ?? column);
        if (!start || !end || typeof start.Merge !== "function") unsupported("merge table cells");
        start.Merge(end);
        break;
      }
      case "split_cell": {
        const cell = table.Cell?.(row, column);
        if (!cell || typeof cell.Split !== "function") unsupported("split table cell");
        cell.Split(Math.max(1, options.endRow ?? 1), Math.max(1, options.endColumn ?? count));
        break;
      }
      default:
        throw new Error(`unsupported table structure action: ${action}`);
    }
  }

  override async formatTable(
    tableIndex: number,
    options: {
      styleName?: string;
      headerRows?: number;
      alignment?: string;
      cellAlignment?: string;
      verticalAlignment?: string;
      shadingColor?: string;
      borderColor?: string;
      borderWidth?: number;
      autofit?: string;
    },
  ): Promise<void> {
    const table = requireCollectionItem(this.application().ActiveDocument?.Tables, tableIndex, "table");
    if (options.styleName) table.Style = options.styleName;
    const headerRows = Math.max(0, options.headerRows ?? 0);
    for (let index = 1; index <= headerRows && index <= Number(table.Rows?.Count ?? 0); index += 1) {
      table.Rows.Item(index).HeadingFormat = -1;
    }
    if (options.alignment) {
      const alignment = PARAGRAPH_ALIGNMENT[options.alignment.toLocaleLowerCase()];
      if (alignment !== undefined && table.Rows) table.Rows.Alignment = alignment;
    }
    if (options.cellAlignment) {
      const alignment = PARAGRAPH_ALIGNMENT[options.cellAlignment.toLocaleLowerCase()];
      if (alignment !== undefined && table.Range?.ParagraphFormat) {
        table.Range.ParagraphFormat.Alignment = alignment;
      }
    }
    if (options.verticalAlignment && table.Range?.Cells) {
      const vertical: Record<string, number> = { top: 0, center: 1, bottom: 3 };
      const value = vertical[options.verticalAlignment.toLocaleLowerCase()];
      if (value !== undefined) table.Range.Cells.VerticalAlignment = value;
    }
    if (options.shadingColor && table.Shading) {
      table.Shading.BackgroundPatternColor = cssColorToWps(options.shadingColor);
    }
    if (table.Borders) {
      table.Borders.Enable = 1;
      if (options.borderColor) {
        const color = cssColorToWps(options.borderColor);
        table.Borders.OutsideColor = color;
        table.Borders.InsideColor = color;
      }
      if (typeof options.borderWidth === "number") {
        const width = borderWidthToWps(options.borderWidth);
        table.Borders.OutsideLineWidth = width;
        table.Borders.InsideLineWidth = width;
      }
    }
    const autofit: Record<string, number> = { fixed: 0, content: 1, window: 2 };
    const behavior = options.autofit ? autofit[options.autofit.toLocaleLowerCase()] : undefined;
    if (behavior !== undefined) table.AutoFitBehavior?.(behavior);
  }

  override async getDocumentOutline(): Promise<Array<{ paragraph: number; text: string; style: string }>> {
    const paragraphs = this.application().ActiveDocument?.Paragraphs;
    const result: Array<{ paragraph: number; text: string; style: string }> = [];
    for (let index = 1; index <= Number(paragraphs?.Count ?? 0); index += 1) {
      const paragraph = paragraphs.Item(index);
      const style = styleName(paragraph?.Style ?? paragraph?.Range?.Style);
      if (/^(?:Heading|标题)\s*[1-9]$/iu.test(style)) {
        result.push({ paragraph: index, text: rangeText(paragraph.Range).trim(), style });
      }
    }
    return result;
  }

  override async readClause(keyword: string): Promise<{ keyword: string; matches: string[] }> {
    const result = await this.searchText(keyword);
    return { keyword, matches: result.matches };
  }

  override async extractDefinitions(): Promise<Array<{ term: string; definition: string }>> {
    const text = cleanText(this.application().ActiveDocument?.Content?.Text);
    const definitions: Array<{ term: string; definition: string }> = [];
    const pattern = /[“"]([^”"]{1,80})[”"]\s*(?:指|是指|means|means that)\s*([^。；;\n]{1,300})/giu;
    for (const match of text.matchAll(pattern)) {
      definitions.push({ term: match[1].trim(), definition: match[2].trim() });
    }
    return definitions;
  }

  override async checkCrossReferences(): Promise<Array<{ reference: string; found: boolean }>> {
    const paragraphs = paragraphTexts(this.application());
    const text = paragraphs.join("\n");
    const references = new Set<string>();
    const pattern = /(?:第\s*[一二三四五六七八九十百千万\d]+条|Section\s+[\d.]+)/giu;
    for (const match of text.matchAll(pattern)) references.add(match[0]);
    const normalizedStarts = paragraphs.map((paragraph) =>
      paragraph.trim().replace(/\s+/gu, "").toLocaleLowerCase());
    return [...references].map((reference) => ({
      reference,
      found: normalizedStarts.some((paragraph) =>
        paragraph.startsWith(reference.replace(/\s+/gu, "").toLocaleLowerCase())),
    }));
  }

  override async insertClauseAfter(anchor: string, text: string): Promise<void> {
    if (!anchor.trim() || !text.trim()) throw new Error("anchor and text are required");
    const document = this.application().ActiveDocument;
    const content = String(document?.Content?.Text ?? "");
    const normalizedContent = content.toLocaleLowerCase();
    const normalizedAnchor = anchor.toLocaleLowerCase();
    const first = normalizedContent.indexOf(normalizedAnchor);
    if (first < 0) throw new Error(`anchor not found: ${anchor}`);
    if (normalizedContent.indexOf(normalizedAnchor, first + normalizedAnchor.length) >= 0) {
      throw new Error(`anchor is ambiguous: ${anchor}`);
    }
    const range = document.Range?.(first, first + anchor.length);
    if (typeof range?.InsertAfter !== "function") unsupported("insert clause after anchor");
    range.InsertAfter(`\r${text}`);
  }

  override async highlightRisk(keyword: string, color = "Yellow"): Promise<{ count: number }> {
    if (!keyword.trim()) throw new Error("keyword is required");
    const document = this.application().ActiveDocument;
    const content = String(document?.Content?.Text ?? "");
    const haystack = content.toLocaleLowerCase();
    const needle = keyword.toLocaleLowerCase();
    const highlight = HIGHLIGHT_COLORS[color.replace(/[\s_-]+/gu, "").toLocaleLowerCase()] ?? 7;
    let count = 0;
    let offset = 0;
    while ((offset = haystack.indexOf(needle, offset)) >= 0) {
      const range = document.Range?.(offset, offset + keyword.length);
      if (!range) unsupported("highlight risk");
      range.HighlightColorIndex = highlight;
      count += 1;
      offset += Math.max(1, keyword.length);
    }
    return { count };
  }

  override async applyLegalFormat(options: { fontName?: string; fontSize?: number; lineSpacing?: number }): Promise<void> {
    const paragraphs = this.application().ActiveDocument?.Paragraphs;
    for (let index = 1; index <= Number(paragraphs?.Count ?? 0); index += 1) {
      const paragraph = paragraphs.Item(index);
      const font = paragraph?.Range?.Font;
      const format = paragraph?.Format ?? paragraph?.Range?.ParagraphFormat;
      if (options.fontName && font) font.Name = options.fontName;
      if (typeof options.fontSize === "number" && font) font.Size = options.fontSize;
      if (typeof options.lineSpacing === "number" && format) format.LineSpacing = options.lineSpacing;
    }
  }

  override async formatList(listType: string): Promise<void> {
    const listFormat = this.application().Selection?.Range?.ListFormat;
    if (!listFormat) unsupported("list formatting");
    const normalized = listType.toLocaleLowerCase();
    if (normalized.startsWith("bullet")) listFormat.ApplyBulletDefault?.();
    else if (normalized.startsWith("number")) listFormat.ApplyNumberDefault?.();
    else throw new Error("list_type must be bullet or number");
  }

  override async pageSetup(options: {
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    orientation?: string;
    paperSize?: string;
    pageWidth?: number;
    pageHeight?: number;
    gutter?: number;
    headerDistance?: number;
    footerDistance?: number;
    differentFirstPage?: boolean;
    oddEvenPages?: boolean;
    mirrorMargins?: boolean;
  }): Promise<void> {
    const setup = this.application().ActiveDocument?.PageSetup;
    if (!setup) unsupported("page setup");
    if (typeof options.marginTop === "number") setup.TopMargin = options.marginTop;
    if (typeof options.marginBottom === "number") setup.BottomMargin = options.marginBottom;
    if (typeof options.marginLeft === "number") setup.LeftMargin = options.marginLeft;
    if (typeof options.marginRight === "number") setup.RightMargin = options.marginRight;
    if (typeof options.pageWidth === "number") setup.PageWidth = options.pageWidth;
    if (typeof options.pageHeight === "number") setup.PageHeight = options.pageHeight;
    if (typeof options.gutter === "number") setup.Gutter = options.gutter;
    if (typeof options.headerDistance === "number") setup.HeaderDistance = options.headerDistance;
    if (typeof options.footerDistance === "number") setup.FooterDistance = options.footerDistance;
    if (typeof options.differentFirstPage === "boolean") setup.DifferentFirstPageHeaderFooter = options.differentFirstPage ? -1 : 0;
    if (typeof options.oddEvenPages === "boolean") setup.OddAndEvenPagesHeaderFooter = options.oddEvenPages ? -1 : 0;
    if (typeof options.mirrorMargins === "boolean") setup.MirrorMargins = options.mirrorMargins ? -1 : 0;
    if (options.paperSize) {
      const paperSizes: Record<string, number> = { letter: 2, legal: 4, a3: 6, a4: 7, a5: 9 };
      const value = paperSizes[options.paperSize.toLocaleLowerCase()];
      if (value) setup.PaperSize = value;
    }
    if (options.orientation) {
      const normalized = options.orientation.toLocaleLowerCase();
      if (normalized !== "landscape" && normalized !== "portrait") {
        throw new Error("orientation must be Landscape or Portrait");
      }
      setup.Orientation = normalized === "landscape" ? 1 : 0;
    }
  }

  override async headerFooter(
    element: string,
    text: string,
    options: { sectionIndex?: number; kind?: string; alignment?: string } = {},
  ): Promise<void> {
    const normalized = element.toLocaleLowerCase();
    if (!["header", "footer", "page_number"].includes(normalized)) {
      throw new Error("element must be header, footer, or page_number");
    }
    const sections = this.application().ActiveDocument?.Sections;
    if (!sections?.Count) unsupported("header and footer");
    const first = Math.max(1, options.sectionIndex ?? 1);
    const last = options.sectionIndex ? first : Number(sections.Count);
    const kind = options.kind?.toLocaleLowerCase() === "first"
      ? 2
      : options.kind?.toLocaleLowerCase() === "even" ? 3 : 1;
    for (let index = first; index <= last; index += 1) {
      const section = sections.Item(index);
      const collection = normalized === "header" ? section?.Headers : section?.Footers;
      const primary = collection?.Item?.(kind);
      if (!primary?.Range) unsupported(`${normalized} range`);
      const range = primary.Range;
      range.Text = "";
      if (normalized === "page_number") {
        if (typeof range.Fields?.Add !== "function") unsupported("page number fields");
        range.Fields.Add(range, -1, "PAGE", true);
        range.InsertAfter?.(" / ");
        const end = primary.Range;
        end.Collapse?.(0);
        end.Fields.Add(end, -1, "NUMPAGES", true);
      } else {
        range.Text = text;
      }
      if (options.alignment && range.ParagraphFormat) {
        const alignments: Record<string, number> = { left: 0, centered: 1, right: 2 };
        const alignment = alignments[options.alignment.toLocaleLowerCase()];
        if (alignment !== undefined) range.ParagraphFormat.Alignment = alignment;
      }
    }
  }

  override async updateToc(
    action: string,
    options: {
      upperHeadingLevel?: number;
      lowerHeadingLevel?: number;
      includePageNumbers?: boolean;
      rightAlignPageNumbers?: boolean;
      useHyperlinks?: boolean;
    } = {},
  ): Promise<{ count: number }> {
    const application = this.application();
    const document = application.ActiveDocument;
    const tables = document?.TablesOfContents;
    if (!tables) unsupported("table of contents");
    const normalized = action.toLocaleLowerCase();
    if (normalized === "insert") {
      const range = application.Selection?.Range ?? document.Range?.(0, 0);
      if (typeof tables.Add !== "function") unsupported("insert table of contents");
      tables.Add(
        range,
        true,
        Math.max(1, Math.min(8, options.upperHeadingLevel ?? 1)),
        Math.max(2, Math.min(9, options.lowerHeadingLevel ?? 3)),
        false,
        undefined,
        options.rightAlignPageNumbers ?? true,
        options.includePageNumbers ?? true,
        undefined,
        options.useHyperlinks ?? true,
      );
    } else if (normalized === "update") {
      for (let index = 1; index <= Number(tables.Count ?? 0); index += 1) {
        const table = tables.Item(index);
        if (typeof table?.Update === "function") table.Update();
        else table?.UpdatePageNumbers?.();
      }
    } else {
      throw new Error("action must be insert or update");
    }
    return { count: Number(tables.Count ?? 0) };
  }

  override async listStyles(): Promise<string[]> {
    const fallback = [
      "正文", "标题 1", "标题 2", "标题 3", "无间隔", "引用",
      "Normal", "Heading 1", "Heading 2", "Heading 3", "Quote",
    ];
    const styles = this.application().ActiveDocument?.Styles;
    const result = [...fallback];
    for (let index = 1; index <= Number(styles?.Count ?? 0); index += 1) {
      const name = styleName(styles.Item(index));
      if (name) result.push(name);
    }
    return Array.from(new Set(result)).sort((left, right) => left.localeCompare(right));
  }

  override async createParagraphStyle(name: string): Promise<void> {
    const normalized = name.trim();
    if (!normalized || normalized.length > 100) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.invalidStyleName"));
    }
    const styles = this.application().ActiveDocument?.Styles;
    if (typeof styles?.Add !== "function") unsupported("create paragraph style");
    styles.Add(normalized, 1);
  }

  override async insertHtmlAtSelection(html: string): Promise<void> {
    if (!html.trim()) throw new Error("html must not be empty");
    const application = this.application();
    const fileSystem = application.FileSystem;
    const range = application.Selection?.Range;
    if (!range || typeof range.InsertFile !== "function" ||
        typeof fileSystem?.writeFileString !== "function") {
      unsupported("HTML insertion");
    }
    const path = temporaryFilePath(application, "html");
    const document = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
    try {
      await Promise.resolve(fileSystem.writeFileString(path, document));
      range.Text = "";
      await Promise.resolve(range.InsertFile(path));
    } finally {
      await removeTemporaryFile(application, path);
    }
  }

  override async insertStyledHtmlBlocksAtSelection(
    blocks: Array<{ kind: string; html: string; notes?: Array<{ marker: string; text: string }> }>,
    styleMappings: Record<string, string>,
    notePlacement: "footnote" | "endnote" = "footnote",
  ): Promise<void> {
    if (!blocks.length) throw new Error("Markdown blocks must not be empty");
    const application = this.application();
    const document = application.ActiveDocument;
    const notes = blocks.flatMap((block) => block.notes ?? []);
    const styledBlocks = blocks.flatMap((block, index) => {
      const style = block.kind === "table" ? "" : styleMappings[block.kind]?.trim() ?? "";
      return style ? [{ index, style, marker: `[[WORDOLLAMA_STYLE_${Date.now()}_${index}]]` }] : [];
    });
    const noteCollection = notePlacement === "endnote" ? document?.Endnotes : document?.Footnotes;
    const canFindInsertedText = Boolean(document?.Content?.Duplicate?.Find &&
      typeof document.Content.Duplicate.Find.Execute === "function");
    if (notes.length && (typeof noteCollection?.Add !== "function" || !canFindInsertedText)) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.markdownNotesUnsupported"));
    }
    if (styledBlocks.length && !canFindInsertedText) unsupported("style-mapped HTML insertion");
    const html = blocks.map((block, index) => {
      const styled = styledBlocks.find((item) => item.index === index);
      const imported = applyNamedStyleToHtmlRoot(block.html, styled?.style ?? "");
      return styled ? insertTextAtHtmlRoot(imported, styled.marker) : imported;
    }).join("\n");
    await this.insertHtmlAtSelection(html);
    for (const styled of styledBlocks) {
      const markerRange = findTextRange(document, styled.marker);
      if (!markerRange) {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.markdownNoteAnchorLost"));
      }
      const paragraph = markerRange.Paragraphs?.Item?.(1);
      const styleTarget = paragraph?.Range ?? paragraph;
      if (!styleTarget) unsupported("apply imported paragraph style");
      styleTarget.Style = styled.style;
      markerRange.Text = "";
    }
    for (const note of notes) {
      const reference = findTextRange(document, note.marker);
      if (!reference) {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.markdownNoteAnchorLost"));
      }
      reference.Text = "";
      reference.Collapse?.(1);
      noteCollection.Add(reference, undefined, markdownNoteToPlainText(note.text));
    }
  }

  override async applyCompareChangesBatch(
    changes: DocumentDiff[],
  ): Promise<Array<{ paragraphIndex: number; kind: string }>> {
    if (!changes.length) return [];
    if (changes.some((change) =>
      (change.blockType === "tableCell" && change.kind !== "modified") ||
      change.insertAfterOriginalBlockType === "tableCell")) {
      unsupported("apply table comparison changes");
    }
    const application = this.application();
    const paragraphs = paragraphTexts(application);
    const normalize = (value: string) => value.replace(/[\r\u0007]+$/gu, "").replace(/\s+/gu, " ").trim();
    const resolveTableCell = (change: DocumentDiff): { range: any; table: number; row: number; column: number } => {
      const expected = normalize(change.original ?? "");
      const location = String(change.originalLocation ?? change.location ?? "");
      const coordinates = /table:(\d+)\/row:(\d+)\/cell:(\d+)/iu.exec(location);
      if (coordinates) {
        const tableIndex = Number(coordinates[1]);
        const row = Number(coordinates[2]);
        const column = Number(coordinates[3]);
        const range = application.ActiveDocument?.Tables?.Item?.(tableIndex)?.Cell?.(row, column)?.Range;
        if (range && normalize(range.Text) === expected) return { range, table: tableIndex, row, column };
      }
      const matches: Array<{ range: any; table: number; row: number; column: number }> = [];
      const tables = application.ActiveDocument?.Tables;
      for (let tableIndex = 1; tableIndex <= Number(tables?.Count ?? 0); tableIndex += 1) {
        const table = tables.Item(tableIndex);
        for (let row = 1; row <= Number(table?.Rows?.Count ?? 0); row += 1) {
          for (let column = 1; column <= Number(table?.Columns?.Count ?? 0); column += 1) {
            const range = table.Cell?.(row, column)?.Range;
            if (range && normalize(range.Text) === expected) matches.push({ range, table: tableIndex, row, column });
          }
        }
      }
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.compareOriginalAmbiguous", {
          text: String(change.original ?? "").slice(0, 40),
        }));
      }
      throw new Error(i18n.t("taskpane.wordAdapter.errors.compareOriginalNotFound", {
        text: String(change.original ?? "").slice(0, 40),
      }));
    };
    const resolveIndex = (expectedIndex: number, expectedText: string): number => {
      const expected = normalize(expectedText);
      if (expectedIndex > 0 && normalize(paragraphs[expectedIndex - 1] ?? "") === expected) return expectedIndex;
      const matches = paragraphs
        .map((text, index) => ({ text: normalize(text), index: index + 1 }))
        .filter((entry) => entry.text === expected);
      if (matches.length === 1) return matches[0].index;
      if (matches.length > 1) {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.compareOriginalAmbiguous", { text: expectedText.slice(0, 40) }));
      }
      throw new Error(i18n.t("taskpane.wordAdapter.errors.compareOriginalNotFound", { text: expectedText.slice(0, 40) }));
    };
    const applied: Array<{ paragraphIndex: number; kind: string }> = [];
    for (const change of changes.filter((item) => item.blockType === "tableCell")) {
      const cell = resolveTableCell(change);
      setRangeText(cell.range, change.revised ?? "");
      if (change.revisedStyle && change.revisedStyle !== change.originalStyle) {
        cell.range.Style = change.revisedStyle;
      }
      applied.push({ paragraphIndex: change.revisedParagraphIndex ?? change.paragraphIndex, kind: change.kind });
    }
    for (const change of changes.filter((item) => item.blockType !== "tableCell").sort((left, right) =>
      (right.originalParagraphIndex ?? right.paragraphIndex) -
      (left.originalParagraphIndex ?? left.paragraphIndex))) {
      if (change.kind === "added") {
        const anchor = change.insertAfterOriginalParagraphIndex ?? 0;
        if (anchor <= 0) {
          const range = application.ActiveDocument?.Range?.(0, 0);
          if (!range || typeof range.InsertBefore !== "function") unsupported("insert comparison paragraph");
          range.InsertBefore(`${change.revised ?? ""}\r`);
        } else {
          const resolved = resolveIndex(anchor, change.insertAfterOriginalText ?? "");
          const range = application.ActiveDocument?.Paragraphs?.Item?.(resolved)?.Range;
          if (!range || typeof range.InsertAfter !== "function") unsupported("insert comparison paragraph");
          range.InsertAfter(`${change.revised ?? ""}\r`);
        }
        applied.push({ paragraphIndex: change.revisedParagraphIndex ?? change.paragraphIndex, kind: change.kind });
        continue;
      }
      const resolved = resolveIndex(
        change.originalParagraphIndex ?? change.paragraphIndex,
        change.original ?? "",
      );
      const range = application.ActiveDocument?.Paragraphs?.Item?.(resolved)?.Range;
      if (!range) unsupported("comparison paragraph");
      if (change.kind === "removed") {
        if (typeof range.Delete === "function") range.Delete();
        else range.Text = "";
      } else {
        range.Text = `${change.revised ?? ""}\r`;
        if (change.revisedStyle && change.revisedStyle !== change.originalStyle) {
          range.Style = change.revisedStyle;
        }
      }
      applied.push({ paragraphIndex: resolved, kind: change.kind });
    }
    return applied;
  }

  override async insertImage(base64: string, altText?: string): Promise<void> {
    const payload = base64.replace(/^data:image\/[a-z0-9.+-]+;base64,/iu, "").trim();
    if (!payload) throw new Error("base64 image data is required");
    const application = this.application();
    const fileSystem = application.FileSystem;
    const shapes = application.ActiveDocument?.InlineShapes;
    if (!shapes || typeof shapes.AddPicture !== "function" ||
        typeof fileSystem?.writeAsBinaryString !== "function") {
      unsupported("image insertion");
    }
    const extension = payload.startsWith("iVBOR") ? "png"
      : payload.startsWith("R0lGOD") ? "gif" : "jpg";
    const path = temporaryFilePath(application, extension);
    try {
      await Promise.resolve(fileSystem.writeAsBinaryString(path, window.atob(payload)));
      const picture = await Promise.resolve(shapes.AddPicture(path, false, true, application.Selection?.Range));
      if (altText && picture && "AlternativeText" in picture) picture.AlternativeText = altText;
    } finally {
      await removeTemporaryFile(application, path);
    }
  }

  override async getReviewDocumentFingerprint(): Promise<string> {
    return reviewDocumentFingerprint(paragraphTexts(this.application()));
  }

  override async applyReviewSuggestionsBatch(
    items: Array<{
      id: string;
      paragraphIndex: number;
      originalText: string;
      suggestedText: string;
      reason: string;
      anchor?: ReviewAnchor;
    }>,
    action: "accept" | "insert" | "comment",
  ): Promise<Array<{ id: string; paragraphIndex: number }>> {
    if (!items.length) return [];
    const application = this.application();
    const paragraphs = paragraphTexts(application);
    const resolved = items.map((item) => ({
      item,
      paragraphIndex: resolveReviewAnchorIndex(
        paragraphs,
        item.anchor,
        item.originalText,
        item.paragraphIndex,
      ),
    }));
    if (new Set(resolved.map((item) => item.paragraphIndex)).size !== resolved.length) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.duplicateSuggestionTarget"));
    }
    for (const entry of resolved.sort((left, right) => right.paragraphIndex - left.paragraphIndex)) {
      const paragraph = requireCollectionItem(
        application.ActiveDocument?.Paragraphs,
        entry.paragraphIndex,
        "paragraph",
      );
      if (action === "accept") {
        paragraph.Range.Text = `${entry.item.suggestedText}\r`;
      } else if (action === "insert") {
        paragraph.Range.InsertAfter(`${entry.item.suggestedText}\r`);
      } else {
        application.ActiveDocument.Comments.Add(
          paragraph.Range,
          i18n.t("taskpane.wordAdapter.suggestionComment", {
            reason: entry.item.reason,
            text: entry.item.suggestedText,
            interpolation: { escapeValue: false },
          }),
        );
      }
    }
    return resolved.map((entry) => ({ id: entry.item.id, paragraphIndex: entry.paragraphIndex }));
  }

  override async resolveReviewParagraph(paragraphIndex: number, excerpt: string, anchor?: ReviewAnchor): Promise<number> {
    return resolveReviewAnchorIndex(paragraphTexts(this.application()), anchor, excerpt, paragraphIndex);
  }

  override async focusReviewTarget(paragraphIndex: number): Promise<void> {
    const range = this.application().ActiveDocument?.Paragraphs?.Item?.(paragraphIndex)?.Range;
    if (typeof range?.Select !== "function") unsupported("focus review target");
    range.Select();
  }

  override async commentReviewTarget(paragraphIndex: number, _excerpt: string, comment: string): Promise<void> {
    const application = this.application();
    const range = application.ActiveDocument?.Paragraphs?.Item?.(paragraphIndex)?.Range;
    if (!range || typeof application.ActiveDocument?.Comments?.Add !== "function") {
      unsupported("review comments");
    }
    application.ActiveDocument.Comments.Add(range, comment);
  }
}
