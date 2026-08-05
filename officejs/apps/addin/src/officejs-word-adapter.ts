import {
  hashReviewText,
  resolveReviewAnchorIndex,
  reviewDocumentFingerprint,
  type ReviewAnchor,
} from "./review-anchor.ts";
import type { DocumentDiff } from "./contracts.ts";
import i18n from "./i18n.ts";
import { buildTextRevisionHunks, occurrenceBefore } from "./text-revision-diff.ts";

export interface WordSelection {
  text: string;
  documentUrl?: string;
}

export interface SearchResult {
  keyword: string;
  count: number;
  matches: string[];
  locations: Array<{ paragraph: number; text: string; context: string }>;
}

export interface DocumentOverview {
  paragraphCount: number;
  preview: string[];
}

export interface ParagraphResult {
  start: number;
  end: number;
  paragraphs: string[];
}

export type AskHumanHandler = (question: string) => Promise<string | null> | string | null;

export interface TrackedRevision {
  identity: string;
  index: number;
  type: string;
  author: string;
  date: string;
  formatDescription: string;
  text: string;
}

export interface TrackedRevisionResult {
  total: number;
  truncated: boolean;
  revisions: TrackedRevision[];
}

type RevisionIdentityFields = Omit<TrackedRevision, "identity" | "index">;

export function trackedRevisionIdentity(revision: RevisionIdentityFields): string {
  return JSON.stringify([
    revision.type,
    revision.author,
    revision.date,
    revision.formatDescription,
    revision.text,
  ]);
}

const BUILT_IN_STYLE_ALIASES: Record<string, Word.BuiltInStyleName> = {
  normal: "Normal" as Word.BuiltInStyleName,
  正文: "Normal" as Word.BuiltInStyleName,
  title: "Title" as Word.BuiltInStyleName,
  标题: "Title" as Word.BuiltInStyleName,
  subtitle: "Subtitle" as Word.BuiltInStyleName,
  副标题: "Subtitle" as Word.BuiltInStyleName,
  nospacing: "NoSpacing" as Word.BuiltInStyleName,
  listparagraph: "ListParagraph" as Word.BuiltInStyleName,
  quote: "Quote" as Word.BuiltInStyleName,
};

export function resolveBuiltInStyleName(styleName: string): Word.BuiltInStyleName | undefined {
  const normalized = styleName.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
  const headingMatch = /^(?:heading|标题)([1-9])$/.exec(normalized);
  if (headingMatch) return `Heading${headingMatch[1]}` as Word.BuiltInStyleName;
  return BUILT_IN_STYLE_ALIASES[normalized];
}

function markdownNoteToPlainText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/giu, "$1 ($2)")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
    .replace(/~~([^~\n]+)~~/gu, "$1")
    .replace(/\*([^*\n]+)\*/gu, "$1")
    .trim();
}

export class OfficeJsWordAdapter {
  private readonly askHumanHandler?: AskHumanHandler;

  constructor(askHumanHandler?: AskHumanHandler) {
    this.askHumanHandler = askHumanHandler;
  }

  async readDocumentSetting<T>(key: string): Promise<T | null> {
    const settings = typeof Office !== "undefined" ? Office.context?.document?.settings : undefined;
    if (!settings) return null;
    const value = settings.get(key) as T | undefined;
    return value ?? null;
  }

  async writeDocumentSetting(key: string, value: unknown): Promise<boolean> {
    const settings = typeof Office !== "undefined" ? Office.context?.document?.settings : undefined;
    if (!settings) return false;
    settings.set(key, value);
    await new Promise<void>((resolve, reject) => {
      settings.saveAsync((result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
        else reject(new Error(result.error?.message || "document settings save failed"));
      });
    });
    return true;
  }

  async captureDocumentSnapshot(maximumCharacters = 8_000_000): Promise<string | null> {
    if (typeof Word === "undefined") return null;
    return Word.run(async (context) => {
      const result = context.document.body.getOoxml();
      await context.sync();
      return result.value.length <= maximumCharacters ? result.value : null;
    });
  }

  async restoreDocumentSnapshot(ooxml: string): Promise<void> {
    if (!ooxml || typeof Word === "undefined") {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.snapshotUnavailable"));
    }
    await Word.run(async (context) => {
      context.document.body.insertOoxml(ooxml, Word.InsertLocation.replace);
      await context.sync();
    });
  }

  async createReviewBookmarks(
    anchors: Map<number, ReviewAnchor>,
  ): Promise<Map<number, ReviewAnchor>> {
    if (!anchors.size ||
        !Office.context?.requirements?.isSetSupported?.("WordApi", "1.4")) {
      return anchors;
    }
    return Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      const hydrated = new Map<number, ReviewAnchor>();
      for (const [paragraphIndex, anchor] of anchors) {
        const paragraph = paragraphs.items[paragraphIndex - 1];
        if (!paragraph) {
          hydrated.set(paragraphIndex, anchor);
          continue;
        }
        const bookmarkName = `_WordOllamaReview_${anchor.textHash}_${paragraphIndex}`;
        paragraph.getRange().insertBookmark(bookmarkName);
        hydrated.set(paragraphIndex, { ...anchor, bookmarkName });
      }
      await context.sync();
      return hydrated;
    });
  }

  supportsTool(name: string): boolean {
    const requirements = Office.context?.requirements;
    if (!requirements?.isSetSupported) {
      return true;
    }

    const wordApi14 = ["read_comments", "add_comment"];
    const wordApi13 = ["edit_table_structure", "format_table"];
    const wordApi12 = ["insert_image"];
    const desktop13 = ["page_setup"];
    const desktop14 = ["update_toc", "revisions"];
    if (wordApi14.includes(name)) {
      return requirements.isSetSupported("WordApi", "1.4");
    }
    if (wordApi13.includes(name)) {
      return requirements.isSetSupported("WordApi", "1.3");
    }
    if (wordApi12.includes(name)) {
      return requirements.isSetSupported("WordApi", "1.2");
    }
    if (desktop13.includes(name)) {
      return requirements.isSetSupported("WordApiDesktop", "1.3");
    }
    if (desktop14.includes(name)) {
      return requirements.isSetSupported("WordApiDesktop", "1.4");
    }
    return requirements.isSetSupported("WordApi", "1.1");
  }

  async beginTrackedChanges(): Promise<string | null> {
    if (!Office.context?.requirements?.isSetSupported?.("WordApi", "1.4")) return null;
    return Word.run(async (context) => {
      const document = context.document;
      document.load("changeTrackingMode");
      await context.sync();
      const previous = String(document.changeTrackingMode);
      if (previous !== Word.ChangeTrackingMode.trackAll) {
        document.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
        await context.sync();
      }
      return previous;
    });
  }

  async restoreTrackedChanges(previous: string | null): Promise<void> {
    if (!previous || !Office.context?.requirements?.isSetSupported?.("WordApi", "1.4")) return;
    const mode = previous === Word.ChangeTrackingMode.trackMineOnly
      ? Word.ChangeTrackingMode.trackMineOnly
      : previous === Word.ChangeTrackingMode.trackAll
        ? Word.ChangeTrackingMode.trackAll
        : Word.ChangeTrackingMode.off;
    await Word.run(async (context) => {
      context.document.changeTrackingMode = mode;
      await context.sync();
    });
  }

  async listTrackedRevisions(limit = 200): Promise<TrackedRevisionResult> {
    if (!this.supportsTool("revisions")) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.revisionsApiUnsupported"));
    }
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 200));
    return Word.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load("items");
      await context.sync();
      const visible = revisions.items.slice(0, boundedLimit);
      visible.forEach((revision) => {
        revision.load("index,type,author,date,formatDescription");
        revision.range.load("text");
      });
      await context.sync();
      return {
        total: revisions.items.length,
        truncated: revisions.items.length > visible.length,
        revisions: visible.map((revision) => {
          const fields: RevisionIdentityFields = {
            type: String(revision.type),
            author: revision.author || "",
            date: revision.date instanceof Date
              ? revision.date.toISOString()
              : String(revision.date || ""),
            formatDescription: revision.formatDescription || "",
            text: revision.range.text || "",
          };
          return {
            identity: trackedRevisionIdentity(fields),
            index: revision.index,
            ...fields,
          };
        }),
      };
    });
  }

  async focusTrackedRevision(identity: string, index: number): Promise<void> {
    await this.performTrackedRevisionAction(identity, index, "focus");
  }

  async applyTrackedRevision(
    identity: string,
    index: number,
    action: "accept" | "reject",
  ): Promise<void> {
    await this.performTrackedRevisionAction(identity, index, action);
  }

  async applyAllTrackedRevisions(action: "accept" | "reject"): Promise<void> {
    if (!this.supportsTool("revisions")) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.revisionsApiUnsupported"));
    }
    await Word.run(async (context) => {
      const revisions = context.document.revisions;
      if (action === "accept") revisions.acceptAll();
      else revisions.rejectAll();
      await context.sync();
    });
  }

  private async performTrackedRevisionAction(
    identity: string,
    index: number,
    action: "focus" | "accept" | "reject",
  ): Promise<void> {
    if (!identity || !Number.isInteger(index) || !this.supportsTool("revisions")) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.safeRevisionUnsupported"));
    }
    await Word.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load("items");
      await context.sync();
      revisions.items.forEach((revision) => revision.load("index"));
      await context.sync();
      const matches = revisions.items.filter((revision) => revision.index === index);
      if (matches.length !== 1) {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.revisionListChanged"));
      }
      const revision = matches[0];
      revision.load("type,author,date,formatDescription");
      revision.range.load("text");
      await context.sync();
      const currentIdentity = trackedRevisionIdentity({
        type: String(revision.type),
        author: revision.author || "",
        date: revision.date instanceof Date
          ? revision.date.toISOString()
          : String(revision.date || ""),
        formatDescription: revision.formatDescription || "",
        text: revision.range.text || "",
      });
      if (currentIdentity !== identity) {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.targetRevisionChanged"));
      }
      if (action === "focus") revision.range.select();
      else if (action === "accept") revision.accept();
      else revision.reject();
      await context.sync();
    });
  }

  async getSelection(): Promise<WordSelection> {
    return Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.load("text");
      await context.sync();

      return {
        text: selection.text,
        documentUrl: Office.context.document.url,
      };
    });
  }

  async replaceSelection(text: string): Promise<void> {
    await Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.insertText(text, Word.InsertLocation.replace);
      await context.sync();
    });
  }

  async focusToolTarget(name: string, args: Record<string, unknown>): Promise<boolean> {
    if (typeof Word === "undefined") return false;
    const paragraphIndex = Number(args.paragraph_index ?? 0);
    const tableIndex = Number(args.table_index ?? 0);
    const row = Number(args.row ?? 0);
    const column = Number(args.column ?? 0);
    const searchText = String(args.keyword ?? args.find ?? args.anchor ?? "").trim();
    return Word.run(async (context) => {
      if (Number.isInteger(paragraphIndex) && paragraphIndex > 0) {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load("items");
        await context.sync();
        const paragraph = paragraphs.items[paragraphIndex - 1];
        if (!paragraph) return false;
        paragraph.getRange().select();
        await context.sync();
        return true;
      }
      if (Number.isInteger(tableIndex) && tableIndex > 0) {
        const tables = context.document.body.tables;
        tables.load("items");
        await context.sync();
        const table = tables.items[tableIndex - 1];
        if (!table) return false;
        if (row > 0 && column > 0) table.getCell(row - 1, column - 1).body.getRange().select();
        else table.getRange().select();
        await context.sync();
        return true;
      }
      if (searchText) {
        const matches = context.document.body.search(searchText.slice(0, 200), {
          matchCase: false,
          matchWholeWord: false,
        });
        matches.load("items");
        await context.sync();
        if (!matches.items.length) return false;
        matches.items[0].select();
        await context.sync();
        return true;
      }
      return false;
    });
  }

  async applyPreciseRevision(original: string, revised: string): Promise<boolean> {
    const hunks = buildTextRevisionHunks(original, revised);
    if (!hunks.length) return true;
    const previousTrackingMode = await this.beginTrackedChanges();
    if (previousTrackingMode === null) {
      await this.replaceSelection(revised);
      return false;
    }
    try {
      const precise = await Word.run(async (context) => {
        const selection = context.document.getSelection();
        const targets = hunks.map((hunk) => {
          const needle = hunk.originalText || hunk.rightAnchor || hunk.leftAnchor;
          const location = hunk.originalText || hunk.rightAnchor ? "replace-or-before" : "after";
          const needleStart = hunk.originalText
            ? hunk.originalStart
            : hunk.rightAnchor
              ? hunk.originalStart
              : hunk.originalStart - hunk.leftAnchor.length;
          if (!needle || needle.length > 200) return null;
          const matches = selection.search(needle, {
            matchCase: true,
            matchWholeWord: false,
            matchWildcards: false,
          });
          matches.load("items/text");
          return { hunk, matches, location, occurrence: occurrenceBefore(original, needle, needleStart) };
        });
        await context.sync();
        if (targets.some((target) => !target || !target.matches.items[target.occurrence])) return false;
        for (const target of [...targets].reverse()) {
          if (!target) return false;
          const range = target.matches.items[target.occurrence];
          if (target.hunk.originalText) {
            range.insertText(target.hunk.revisedText, Word.InsertLocation.replace);
          } else if (target.location === "replace-or-before") {
            range.insertText(target.hunk.revisedText, Word.InsertLocation.before);
          } else {
            range.insertText(target.hunk.revisedText, Word.InsertLocation.after);
          }
        }
        await context.sync();
        return true;
      });
      if (!precise) await this.replaceSelection(revised);
      return precise;
    } finally {
      await this.restoreTrackedChanges(previousTrackingMode);
    }
  }

  async searchText(keyword: string): Promise<SearchResult> {
    if (!keyword.trim()) {
      throw new Error("keyword is required");
    }

    return Word.run(async (context) => {
      const results = context.document.body.search(keyword, {
        matchCase: false,
        matchWholeWord: false,
      });
      results.load("items/text");
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      const matches = results.items.slice(0, 10).map((range) => range.text);
      const locations: Array<{ paragraph: number; text: string; context: string }> = [];
      for (const [index, paragraph] of paragraphs.items.entries()) {
        paragraph.load("text");
        if (locations.length >= 20) break;
      }
      await context.sync();
      for (const [index, paragraph] of paragraphs.items.entries()) {
        const text = paragraph.text.replace(/[\r\a]+$/g, "");
        const matchAt = text.toLocaleLowerCase().indexOf(keyword.toLocaleLowerCase());
        if (matchAt < 0) continue;
        locations.push({
          paragraph: index + 1,
          text: text.slice(matchAt, matchAt + Math.max(keyword.length, 120)),
          context: text.slice(Math.max(0, matchAt - 80), matchAt + keyword.length + 80),
        });
        if (locations.length >= 20) break;
      }
      return { keyword, count: results.items.length, matches, locations };
    });
  }

  async getDocumentOverview(): Promise<DocumentOverview> {
    return Word.run(async (context) => {
      const body = context.document.body;
      const paragraphs = body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      const previewParagraphs = paragraphs.items.slice(0, 2);
      previewParagraphs.forEach((paragraph) => paragraph.load("text"));
      await context.sync();

      return {
        paragraphCount: paragraphs.items.length,
        preview: previewParagraphs.map((paragraph) => paragraph.text.trim()),
      };
    });
  }

  async insertTextAtEnd(text: string): Promise<void> {
    if (!text) {
      throw new Error("text is required");
    }

    await Word.run(async (context) => {
      context.document.body.insertText(text, Word.InsertLocation.end);
      await context.sync();
    });
  }

  async readParagraphs(start: number, end: number): Promise<ParagraphResult> {
    if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start) {
      throw new Error("start and end must be positive paragraph indexes");
    }
    return Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      const boundedEnd = Math.min(end, paragraphs.items.length);
      if (start > paragraphs.items.length) {
        throw new Error(`paragraph ${start} is out of range (total ${paragraphs.items.length})`);
      }
      const selected = paragraphs.items.slice(start - 1, boundedEnd);
      selected.forEach((paragraph) => paragraph.load("text"));
      await context.sync();
      return {
        start,
        end: boundedEnd,
        paragraphs: selected
          .map((paragraph) => paragraph.text.replace(/[\r\a]+$/g, "")),
      };
    });
  }

  async focusReviewTarget(
    paragraphIndex: number,
    excerpt = "",
    anchor?: ReviewAnchor,
  ): Promise<void> {
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/text,items/style");
      await context.sync();
      if (anchor?.bookmarkName) {
        const bookmarked = context.document.getBookmarkRangeOrNullObject(anchor.bookmarkName);
        bookmarked.load("isNullObject,text");
        await context.sync();
        if (!bookmarked.isNullObject && hashReviewText(bookmarked.text) === anchor.textHash) {
          bookmarked.select();
          await context.sync();
          return;
        }
      }
      if (paragraphIndex > 0) {
        const resolved = resolveReviewAnchorIndex(
          paragraphs.items.map((paragraph) => paragraph.text),
          anchor,
          excerpt,
          paragraphIndex,
        );
        paragraphs.items[resolved - 1].getRange().select();
        await context.sync();
        return;
      }
      const searchText = excerpt.trim().slice(0, 120);
      if (!searchText) throw new Error(i18n.t("taskpane.wordAdapter.errors.reviewTargetMissing"));
      const matches = context.document.body.search(searchText, {
        matchCase: false,
        matchWholeWord: false,
      });
      matches.load("items");
      await context.sync();
      const match = matches.items[0];
      if (!match) throw new Error(i18n.t("taskpane.wordAdapter.errors.reviewOriginalNotFound"));
      match.select();
      await context.sync();
    });
  }

  async resolveReviewParagraph(
    paragraphIndex: number,
    excerpt: string,
    anchor?: ReviewAnchor,
  ): Promise<number> {
    const normalizedExcerpt = excerpt.replace(/\s+/g, " ").trim();
    if (!normalizedExcerpt) throw new Error(i18n.t("taskpane.wordAdapter.errors.relocationTextMissing"));
    return Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/text");
      await context.sync();
      return resolveReviewAnchorIndex(
        paragraphs.items.map((paragraph) => paragraph.text),
        anchor,
        normalizedExcerpt,
        paragraphIndex,
      );
    });
  }

  async commentReviewTarget(
    paragraphIndex: number,
    excerpt: string,
    comment: string,
    anchor?: ReviewAnchor,
  ): Promise<void> {
    if (!comment.trim()) throw new Error("comment is required");
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/text");
      await context.sync();
      if (anchor?.bookmarkName) {
        const bookmarked = context.document.getBookmarkRangeOrNullObject(anchor.bookmarkName);
        bookmarked.load("isNullObject,text");
        await context.sync();
        if (!bookmarked.isNullObject && hashReviewText(bookmarked.text) === anchor.textHash) {
          bookmarked.insertComment(comment);
          await context.sync();
          return;
        }
      }
      if (paragraphIndex > 0) {
        const resolved = resolveReviewAnchorIndex(
          paragraphs.items.map((paragraph) => paragraph.text),
          anchor,
          excerpt,
          paragraphIndex,
        );
        paragraphs.items[resolved - 1].getRange().insertComment(comment);
        await context.sync();
        return;
      }
      const searchText = excerpt.trim().slice(0, 120);
      if (!searchText) throw new Error(i18n.t("taskpane.wordAdapter.errors.commentTargetMissing"));
      const matches = context.document.body.search(searchText, {
        matchCase: false,
        matchWholeWord: false,
      });
      matches.load("items");
      await context.sync();
      const match = matches.items[0];
      if (!match) throw new Error(i18n.t("taskpane.wordAdapter.errors.reviewOriginalNotFound"));
      match.insertComment(comment);
      await context.sync();
    });
  }

  async getReviewDocumentFingerprint(): Promise<string> {
    return Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/text");
      await context.sync();
      return reviewDocumentFingerprint(paragraphs.items.map((paragraph) => paragraph.text));
    });
  }

  async applyReviewSuggestionsBatch(
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
    if (action === "comment" && !this.supportsTool("add_comment")) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.commentsUnsupported"));
    }
    return Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/text");
      await context.sync();
      const paragraphTexts = paragraphs.items.map((paragraph) => paragraph.text);
      const candidates = items.map((item) => {
        const range = item.anchor?.bookmarkName
          ? context.document.getBookmarkRangeOrNullObject(item.anchor.bookmarkName)
          : undefined;
        range?.load("isNullObject,text");
        return { item, range };
      });
      if (candidates.some((entry) => entry.range)) await context.sync();
      const resolved = candidates.map(({ item, range }) => {
        const validBookmark = Boolean(
          range && !range.isNullObject && item.anchor &&
          hashReviewText(range.text) === item.anchor.textHash,
        );
        const paragraphIndex = validBookmark
          ? item.paragraphIndex
          : resolveReviewAnchorIndex(
              paragraphTexts,
              item.anchor,
              item.originalText,
              item.paragraphIndex,
            );
        return {
          item,
          range: validBookmark ? range : undefined,
          paragraphIndex,
          targetKey: validBookmark
            ? `bookmark:${item.anchor?.bookmarkName}`
            : `paragraph:${paragraphIndex}`,
        };
      });
      const uniqueTargets = new Set(resolved.map((entry) => entry.targetKey));
      if (uniqueTargets.size !== resolved.length) {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.duplicateSuggestionTarget"));
      }
      for (const entry of resolved) {
        const paragraph = paragraphs.items[entry.paragraphIndex - 1];
        const target = entry.range ?? paragraph;
        if (!target) throw new Error(`paragraph ${entry.paragraphIndex} is out of range`);
        if (action === "accept") {
          target.insertText(entry.item.suggestedText, Word.InsertLocation.replace);
        } else if (action === "insert") {
          target.insertParagraph(entry.item.suggestedText, Word.InsertLocation.after);
        } else {
          (entry.range ?? paragraph.getRange()).insertComment(
            i18n.t("taskpane.wordAdapter.suggestionComment", {
              reason: entry.item.reason,
              text: entry.item.suggestedText,
              interpolation: { escapeValue: false },
            }),
          );
        }
      }
      await context.sync();
      return resolved.map((entry) => ({
        id: entry.item.id,
        paragraphIndex: entry.paragraphIndex,
      }));
    });
  }

  async applyCompareChangesBatch(
    changes: DocumentDiff[],
  ): Promise<Array<{ paragraphIndex: number; kind: string }>> {
    if (!changes.length) return [];
    for (const change of changes) {
      if (change.kind === "added" &&
          (change.blockType === "tableCell" ||
           change.insertAfterOriginalBlockType === "tableCell")) {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.addedTableUnsupported"));
      }
      if (change.kind === "removed" && change.blockType === "tableCell") {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.removedTableUnsupported"));
      }
      if (change.kind === "modified" &&
          (!change.original || change.revised === null || change.revised === undefined)) {
        throw new Error(i18n.t("taskpane.wordAdapter.errors.modifiedTextMissing"));
      }
    }

    return Word.run(async (context) => {
      const body = context.document.body;
      const paragraphs = body.paragraphs;
      paragraphs.load("items/text");
      const tableSearches = new Map<DocumentDiff, Word.RangeCollection>();
      for (const change of changes) {
        if (change.kind === "modified" && change.blockType === "tableCell" && change.original) {
          const matches = body.search(change.original, {
            matchCase: true,
            matchWholeWord: false,
          });
          matches.load("items/text");
          tableSearches.set(change, matches);
        }
      }
      await context.sync();

      const normalize = (value: string) =>
        value.replace(/[\r\a]+$/g, "").replace(/\s+/g, " ").trim();
      const paragraphTexts = paragraphs.items.map((paragraph) => normalize(paragraph.text));
      const resolveParagraphIndex = (expectedIndex: number, expectedText: string): number => {
        const normalizedExpected = normalize(expectedText);
        if (!normalizedExpected) throw new Error(i18n.t("taskpane.wordAdapter.errors.compareOriginalMissing"));
        if (expectedIndex > 0 &&
            paragraphTexts[expectedIndex - 1] === normalizedExpected) {
          return expectedIndex;
        }
        const matches = paragraphTexts
          .map((text, index) => ({ text, index: index + 1 }))
          .filter((entry) => entry.text === normalizedExpected);
        if (matches.length === 1) return matches[0].index;
        if (matches.length > 1) {
          throw new Error(i18n.t("taskpane.wordAdapter.errors.compareOriginalAmbiguous", {
            text: expectedText.slice(0, 40),
          }));
        }
        throw new Error(i18n.t("taskpane.wordAdapter.errors.compareOriginalNotFound", {
          text: expectedText.slice(0, 40),
        }));
      };

      const resolvedOriginals = new Map<DocumentDiff, number>();
      for (const change of changes) {
        if (change.kind === "added" || change.blockType === "tableCell") continue;
        resolvedOriginals.set(
          change,
          resolveParagraphIndex(change.originalParagraphIndex ?? change.paragraphIndex, change.original ?? ""),
        );
      }
      const duplicateTargets = new Set<number>();
      for (const paragraphIndex of resolvedOriginals.values()) {
        if (duplicateTargets.has(paragraphIndex)) {
          throw new Error(i18n.t("taskpane.wordAdapter.errors.duplicateCompareTarget"));
        }
        duplicateTargets.add(paragraphIndex);
      }

      const additions = changes
        .filter((change) => change.kind === "added")
        .sort((left, right) =>
          (right.revisedParagraphIndex ?? right.paragraphIndex) -
          (left.revisedParagraphIndex ?? left.paragraphIndex));
      for (const change of additions) {
        const text = change.revised ?? "";
        const anchorIndex = change.insertAfterOriginalParagraphIndex ?? 0;
        if (anchorIndex === 0) {
          body.insertParagraph(text, Word.InsertLocation.start);
        } else {
          const resolvedAnchor = resolveParagraphIndex(
            anchorIndex,
            change.insertAfterOriginalText ?? "",
          );
          paragraphs.items[resolvedAnchor - 1].insertParagraph(text, Word.InsertLocation.after);
        }
      }

      const originals = changes
        .filter((change) => change.kind !== "added")
        .sort((left, right) =>
          (right.originalParagraphIndex ?? right.paragraphIndex) -
          (left.originalParagraphIndex ?? left.paragraphIndex));
      const applied: Array<{ paragraphIndex: number; kind: string }> = [];
      for (const change of originals) {
        if (change.blockType === "tableCell") {
          const matches = tableSearches.get(change)?.items
            .filter((range) => normalize(range.text) === normalize(change.original ?? "")) ?? [];
          if (matches.length !== 1) {
            throw new Error(i18n.t("taskpane.wordAdapter.errors.tableCellChanged"));
          }
          matches[0].insertText(change.revised ?? "", Word.InsertLocation.replace);
          applied.push({
            paragraphIndex: change.originalParagraphIndex ?? change.paragraphIndex,
            kind: change.kind,
          });
          continue;
        }
        const paragraphIndex = resolvedOriginals.get(change);
        if (!paragraphIndex) throw new Error(i18n.t("taskpane.wordAdapter.errors.compareParagraphMissing"));
        const paragraph = paragraphs.items[paragraphIndex - 1];
        if (change.kind === "removed") {
          paragraph.delete();
        } else {
          paragraph.insertText(change.revised ?? "", Word.InsertLocation.replace);
          if (change.revisedStyle && change.revisedStyle !== change.originalStyle) {
            const builtInStyle = resolveBuiltInStyleName(change.revisedStyle);
            if (builtInStyle &&
                Office.context?.requirements?.isSetSupported?.("WordApi", "1.3")) {
              paragraph.styleBuiltIn = builtInStyle;
            } else {
              paragraph.style = change.revisedStyle;
            }
          }
        }
        applied.push({ paragraphIndex, kind: change.kind });
      }
      await context.sync();
      return [
        ...additions.map((change) => ({
          paragraphIndex: change.revisedParagraphIndex ?? change.paragraphIndex,
          kind: change.kind,
        })),
        ...applied,
      ];
    });
  }

  async insertAfterParagraph(paragraphIndex: number, text: string): Promise<void> {
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 1 || !text.trim()) {
      throw new Error("paragraphIndex and text are required");
    }
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      const paragraph = paragraphs.items[paragraphIndex - 1];
      if (!paragraph) throw new Error(`paragraph ${paragraphIndex} is out of range`);
      paragraph.insertParagraph(text, Word.InsertLocation.after);
      await context.sync();
    });
  }

  async insertAfterSelection(text: string): Promise<void> {
    if (!text.trim()) throw new Error("text is required");
    await Word.run(async (context) => {
      context.document.getSelection().insertText(text, Word.InsertLocation.after);
      await context.sync();
    });
  }

  async readLargeChunk(startParagraph: number): Promise<ParagraphResult> {
    return this.readParagraphs(startParagraph, startParagraph + 49);
  }

  async buildSemanticMap(): Promise<{ paragraphCount: number; entries: Array<{ start: number; end: number; summary: string }> }> {
    return Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/text");
      await context.sync();
      const entries: Array<{ start: number; end: number; summary: string }> = [];
      const headingIndexes = paragraphs.items
        .map((paragraph, index) => ({ index, style: paragraph.style, text: paragraph.text.replace(/[\r\a]+$/g, "").trim() }))
        .filter((item) => /^(?:Heading|标题)\s*[1-9]$/i.test(item.style));
      const boundaries = headingIndexes.length ? headingIndexes.map((item) => item.index) :
        paragraphs.items.map((_, index) => index).filter((index) => index % 10 === 0);
      for (let boundary = 0; boundary < boundaries.length; boundary += 1) {
        const index = boundaries[boundary];
        const next = boundaries[boundary + 1] ?? paragraphs.items.length;
        const summary = paragraphs.items[index]?.text.replace(/[\r\a]+$/g, "").trim() ?? "";
        entries.push({
          start: index + 1,
          end: next,
          summary: summary.length > 120 ? `${summary.slice(0, 120)}...` : summary,
        });
      }
      return { paragraphCount: paragraphs.items.length, entries };
    });
  }

  async applyStyle(paragraphIndex: number, styleName: string): Promise<void> {
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 1 || !styleName.trim()) {
      throw new Error("paragraph_index and style_name are required");
    }
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      const paragraph = paragraphs.items[paragraphIndex - 1];
      if (!paragraph) {
        throw new Error(`paragraph ${paragraphIndex} is out of range`);
      }
      const builtInStyle = resolveBuiltInStyleName(styleName);
      if (builtInStyle && Office.context?.requirements?.isSetSupported?.("WordApi", "1.3")) {
        paragraph.styleBuiltIn = builtInStyle;
      } else {
        paragraph.style = styleName;
      }
      await context.sync();
    });
  }

  async replaceParagraph(paragraphIndex: number, text: string): Promise<void> {
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 1 || !text) {
      throw new Error("paragraph_index and new_text are required");
    }
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      const paragraph = paragraphs.items[paragraphIndex - 1];
      if (!paragraph) {
        throw new Error(`paragraph ${paragraphIndex} is out of range`);
      }
      paragraph.insertText(text, Word.InsertLocation.replace);
      await context.sync();
    });
  }

  async insertAtCursor(text: string): Promise<void> {
    if (!text) {
      throw new Error("text is required");
    }
    await Word.run(async (context) => {
      context.document.getSelection().insertText(text, Word.InsertLocation.replace);
      await context.sync();
    });
  }

  async readComments(): Promise<Array<{ author: string; content: string; resolved: boolean }>> {
    return Word.run(async (context) => {
      const comments = context.document.comments;
      comments.load("items/authorName,items/content,items/resolved");
      await context.sync();
      return comments.items.slice(0, 50).map((comment) => ({
        author: comment.authorName,
        content: comment.content,
        resolved: comment.resolved,
      }));
    });
  }

  async readBookmarks(): Promise<Array<{ name: string; start: number; end: number; text: string }>> {
    return Word.run(async (context) => {
      const bookmarks = context.document.bookmarks;
      bookmarks.load("items/name,start,end,range/text");
      await context.sync();
      return bookmarks.items.slice(0, 100).map((bookmark) => ({
        name: bookmark.name,
        start: bookmark.start,
        end: bookmark.end,
        text: bookmark.range.text,
      }));
    });
  }

  async addComment(text: string): Promise<void> {
    if (!text.trim()) {
      throw new Error("text is required");
    }
    await Word.run(async (context) => {
      context.document.getSelection().insertComment(text);
      await context.sync();
    });
  }

  async findReplace(find: string, replace: string): Promise<{ count: number }> {
    if (!find) {
      throw new Error("find is required");
    }
    return Word.run(async (context) => {
      const matches = context.document.body.search(find, { matchCase: false, matchWholeWord: false });
      matches.load("items");
      await context.sync();
      matches.items.forEach((range) => range.insertText(replace, Word.InsertLocation.replace));
      await context.sync();
      return { count: matches.items.length };
    });
  }

  async formatParagraph(paragraphIndex: number, alignment?: string, spaceBefore?: number, spaceAfter?: number): Promise<void> {
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      const paragraph = paragraphs.items[paragraphIndex - 1];
      if (!paragraph) throw new Error(`paragraph ${paragraphIndex} is out of range`);
      if (alignment) paragraph.alignment = alignment as Word.Alignment;
      if (typeof spaceBefore === "number") paragraph.spaceBefore = spaceBefore;
      if (typeof spaceAfter === "number") paragraph.spaceAfter = spaceAfter;
      await context.sync();
    });
  }

  async formatText(options: { bold?: boolean; italic?: boolean; underline?: boolean; fontName?: string; fontSize?: number; color?: string }): Promise<void> {
    await Word.run(async (context) => {
      const font = context.document.getSelection().font;
      if (typeof options.bold === "boolean") font.bold = options.bold;
      if (typeof options.italic === "boolean") font.italic = options.italic;
      if (typeof options.underline === "boolean") font.underline = options.underline ? Word.UnderlineType.single : Word.UnderlineType.none;
      if (options.fontName) font.name = options.fontName;
      if (typeof options.fontSize === "number") font.size = options.fontSize;
      if (options.color) font.color = options.color;
      await context.sync();
    });
  }

  async insertPageBreak(): Promise<void> {
    await Word.run(async (context) => {
      context.document.getSelection().insertBreak(Word.BreakType.page, Word.InsertLocation.after);
      await context.sync();
    });
  }

  async readTable(tableIndex: number): Promise<{ tableIndex: number; rows: string[][] }> {
    if (!Number.isInteger(tableIndex) || tableIndex < 1) throw new Error("table_index must be a positive integer");
    return Word.run(async (context) => {
      const tables = context.document.body.tables;
      tables.load("items");
      await context.sync();
      const table = tables.items[tableIndex - 1];
      if (!table) throw new Error(`table ${tableIndex} is out of range`);
      table.load("rowCount");
      table.columns.load("items");
      table.rows.load("items");
      const cells: Word.TableCell[][] = [];
      await context.sync();
      const columnCount = table.columns.items.length;
      for (let row = 0; row < table.rowCount; row++) {
        cells.push([]);
        for (let column = 0; column < columnCount; column++) {
          const cell = table.getCell(row, column);
          cell.load("value");
          cells[row].push(cell);
        }
      }
      await context.sync();
      return { tableIndex, rows: cells.map((row) => row.map((cell) => cell.value)) };
    });
  }

  async insertTable(rows: number, columns: number, headerRow?: string[]): Promise<void> {
    if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1) {
      throw new Error("rows and columns must be positive integers");
    }
    await Word.run(async (context) => {
      const values = headerRow && headerRow.length > 0
        ? [headerRow.slice(0, columns), ...Array.from({ length: Math.max(0, rows - 1) }, () => [])]
        : undefined;
      context.document.body.insertTable(rows, columns, Word.InsertLocation.end, values);
      await context.sync();
    });
  }

  async insertStructuredTable(headers: string[], rows: string[][]): Promise<void> {
    if (headers.length < 1) throw new Error("headers must not be empty");
    const columnCount = headers.length;
    const values = [
      headers.map((value) => String(value ?? "")),
      ...rows.map((row) => Array.from({ length: columnCount }, (_, index) => String(row[index] ?? ""))),
    ];
    await Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.clear();
      const table = selection.insertTable(
        values.length,
        columnCount,
        Word.InsertLocation.after,
        values,
      );
      table.styleBuiltIn = Word.BuiltInStyleName.gridTable5Dark_Accent1;
      table.headerRowCount = 1;
      table.rows.getFirst().font.bold = true;
      await context.sync();
    });
  }

  async insertHtmlAtSelection(html: string): Promise<void> {
    if (!html.trim()) throw new Error("html must not be empty");
    await Word.run(async (context) => {
      context.document.getSelection().insertHtml(html, Word.InsertLocation.replace);
      await context.sync();
    });
  }

  async insertStyledHtmlBlocksAtSelection(
    blocks: Array<{
      kind: string;
      html: string;
      notes?: Array<{ marker: string; text: string }>;
    }>,
    styleMappings: Record<string, string>,
    notePlacement: "footnote" | "endnote" = "footnote",
  ): Promise<void> {
    if (!blocks.length) throw new Error("Markdown blocks must not be empty");
    if (blocks.some((block) => block.notes?.length) &&
        !Office.context?.requirements?.isSetSupported?.("WordApi", "1.5")) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.markdownNotesUnsupported"));
    }
    await Word.run(async (context) => {
      let anchor = context.document.getSelection();
      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        const inserted = anchor.insertHtml(
          block.html,
          index === 0 ? Word.InsertLocation.replace : Word.InsertLocation.after,
        );
        const styleName = styleMappings[block.kind]?.trim();
        if (styleName && block.kind !== "table") {
          const builtInStyle = resolveBuiltInStyleName(styleName);
          if (builtInStyle && Office.context?.requirements?.isSetSupported?.("WordApi", "1.3")) {
            inserted.styleBuiltIn = builtInStyle;
          } else {
            inserted.style = styleName;
          }
        }
        const noteSearches = (block.notes ?? []).map((note) => {
          const matches = inserted.search(note.marker, {
            matchCase: true,
            matchWholeWord: false,
          });
          matches.load("items");
          return { note, matches };
        });
        if (noteSearches.length) {
          await context.sync();
          for (const { note, matches } of noteSearches) {
            if (matches.items.length !== 1) {
              throw new Error(i18n.t("taskpane.wordAdapter.errors.markdownNoteAnchorLost"));
            }
            const reference = matches.items[0];
            const text = markdownNoteToPlainText(note.text);
            if (notePlacement === "endnote") reference.insertEndnote(text);
            else reference.insertFootnote(text);
            reference.delete();
          }
        }
        anchor = inserted;
      }
      await context.sync();
    });
  }

  async listStyles(): Promise<string[]> {
    const fallback = [
      "Normal", "Heading 1", "Heading 2", "Heading 3",
      "No Spacing", "Quote", "List Paragraph", "List Bullet", "List Number",
    ];
    if (!Office.context?.requirements?.isSetSupported?.("WordApi", "1.5")) return fallback;
    return Word.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load("items/nameLocal,items/type");
      await context.sync();
      const paragraphStyles = styles.items
        .filter((style) => style.type === Word.StyleType.paragraph)
        .map((style) => style.nameLocal);
      return Array.from(new Set([...fallback, ...paragraphStyles]))
        .sort((left, right) => left.localeCompare(right));
    });
  }

  async createParagraphStyle(name: string): Promise<void> {
    name = name.trim();
    if (!name || name.length > 100) throw new Error(i18n.t("taskpane.wordAdapter.errors.invalidStyleName"));
    if (!Office.context?.requirements?.isSetSupported?.("WordApi", "1.5")) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.customStyleUnsupported"));
    }
    await Word.run(async (context) => {
      context.document.addStyle(name, Word.StyleType.paragraph);
      await context.sync();
    });
  }

  async insertTableRow(tableIndex: number, afterRow?: number): Promise<void> {
    return Word.run(async (context) => {
      const tables = context.document.body.tables;
      tables.load("items");
      await context.sync();
      const table = tables.items[tableIndex - 1];
      if (!table) throw new Error(`table ${tableIndex} is out of range`);
      table.load("rowCount");
      table.rows.load("items");
      await context.sync();
      const row = typeof afterRow === "number" && afterRow >= 1 && afterRow <= table.rowCount
        ? table.rows.items[afterRow - 1] ?? table.rows.getFirst()
        : table.rows.getFirst();
      row.insertRows(Word.InsertLocation.after, 1);
      await context.sync();
    });
  }

  async setTableCell(tableIndex: number, rowIndex: number, columnIndex: number, text: string): Promise<void> {
    if (!Number.isInteger(tableIndex) || tableIndex < 1 || !Number.isInteger(rowIndex) || rowIndex < 1 ||
        !Number.isInteger(columnIndex) || columnIndex < 1) {
      throw new Error("table_index, row and column must be positive integers");
    }
    await Word.run(async (context) => {
      const tables = context.document.body.tables;
      tables.load("items");
      await context.sync();
      const table = tables.items[tableIndex - 1];
      if (!table) throw new Error(`table ${tableIndex} is out of range`);
      const cell = table.getCell(rowIndex - 1, columnIndex - 1);
      cell.value = text;
      await context.sync();
    });
  }

  async getDocumentOutline(): Promise<Array<{ paragraph: number; text: string; style: string }>> {
    return Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/text,items/style");
      await context.sync();
      return paragraphs.items
        .map((paragraph, index) => ({ paragraph: index + 1, text: paragraph.text.trim(), style: paragraph.style }))
        .filter((item) => /^Heading\s*\d+$/i.test(item.style) || /^标题\s*\d+$/i.test(item.style));
    });
  }

  async readClause(keyword: string): Promise<{ keyword: string; matches: string[] }> {
    const result = await this.searchText(keyword);
    return { keyword, matches: result.matches };
  }

  async extractDefinitions(): Promise<Array<{ term: string; definition: string }>> {
    return Word.run(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();
      const text = body.text.replace(/[\r\a]+/g, "\n");
      const definitions: Array<{ term: string; definition: string }> = [];
      const pattern = /[“\"]([^”\"]{1,80})[”\"]\s*(?:指|是指|means|means that)\s*([^。；;\n]{1,300})/gi;
      for (const match of text.matchAll(pattern)) {
        definitions.push({ term: match[1].trim(), definition: match[2].trim() });
      }
      return definitions;
    });
  }

  async checkCrossReferences(): Promise<Array<{ reference: string; found: boolean }>> {
    return Word.run(async (context) => {
      const body = context.document.body;
      const paragraphs = body.paragraphs;
      body.load("text");
      paragraphs.load("items/text");
      await context.sync();
      const text = body.text;
      const references = new Set<string>();
      const pattern = /(?:第\s*[一二三四五六七八九十百千万\d]+条|Section\s+[\d.]+)/gi;
      for (const match of text.matchAll(pattern)) references.add(match[0]);
      const normalizedStarts = paragraphs.items
        .map((paragraph) => paragraph.text.trim().replace(/\s+/g, "").toLocaleLowerCase());
      return [...references].map((reference) => ({
        reference,
        found: normalizedStarts.some((text) => text.startsWith(reference.replace(/\s+/g, "").toLocaleLowerCase())),
      }));
    });
  }

  async insertClauseAfter(anchor: string, text: string): Promise<void> {
    if (!anchor || !text) throw new Error("anchor and text are required");
    await Word.run(async (context) => {
      const matches = context.document.body.search(anchor, { matchCase: false, matchWholeWord: false });
      matches.load("items");
      await context.sync();
      if (matches.items.length > 1) throw new Error(`anchor is ambiguous (${matches.items.length} matches): ${anchor}`);
      const range = matches.items[0];
      if (!range) throw new Error(`anchor not found: ${anchor}`);
      range.insertText(`\n${text}`, Word.InsertLocation.after);
      await context.sync();
    });
  }

  async highlightRisk(keyword: string, color = "Yellow"): Promise<{ count: number }> {
    if (!keyword) throw new Error("keyword is required");
    return Word.run(async (context) => {
      const matches = context.document.body.search(keyword, { matchCase: false, matchWholeWord: false });
      matches.load("items");
      await context.sync();
      matches.items.forEach((range) => { range.font.highlightColor = color; });
      await context.sync();
      return { count: matches.items.length };
    });
  }

  async applyLegalFormat(options: { fontName?: string; fontSize?: number; lineSpacing?: number }): Promise<void> {
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      paragraphs.items.forEach((paragraph) => {
        if (options.fontName) paragraph.font.name = options.fontName;
        if (typeof options.fontSize === "number") paragraph.font.size = options.fontSize;
        if (typeof options.lineSpacing === "number") paragraph.lineSpacing = options.lineSpacing;
      });
      await context.sync();
    });
  }

  async validateCitation(citation: string): Promise<{ citation: string; valid: boolean; verified: boolean; check: "format-only"; reason?: string }> {
    const valid = /(?:\b(?:19|20)\d{2}\b|\d{4}年).{0,80}(?:第[一二三四五六七八九十百千万\d]+条|Section\s+\d+)/i.test(citation);
    return valid
      ? { citation, valid: true, verified: false, check: "format-only" }
      : { citation, valid: false, verified: false, check: "format-only", reason: i18n.t("taskpane.wordAdapter.invalidCitationReason") };
  }

  async insertImage(base64: string, altText?: string): Promise<void> {
    if (!base64.trim()) throw new Error("base64 image data is required");
    await Word.run(async (context) => {
      const picture = context.document.body.insertInlinePictureFromBase64(base64, Word.InsertLocation.end);
      if (altText) picture.altTextDescription = altText;
      await context.sync();
    });
  }

  async formatList(listType: string): Promise<void> {
    await Word.run(async (context) => {
      const listFormat = context.document.getSelection().listFormat;
      if (listType.toLowerCase().startsWith("bullet")) {
        listFormat.applyBulletDefault("Word97");
      } else if (listType.toLowerCase().startsWith("number")) {
        listFormat.applyNumberDefault("Word97");
      } else {
        throw new Error("list_type must be bullet or number");
      }
      await context.sync();
    });
  }

  async pageSetup(options: {
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
    await Word.run(async (context) => {
      const sections = context.document.sections;
      sections.load("items");
      await context.sync();
      sections.items.forEach((section) => {
        const setup = section.pageSetup;
        if (typeof options.marginTop === "number") setup.topMargin = options.marginTop;
        if (typeof options.marginBottom === "number") setup.bottomMargin = options.marginBottom;
        if (typeof options.marginLeft === "number") setup.leftMargin = options.marginLeft;
        if (typeof options.marginRight === "number") setup.rightMargin = options.marginRight;
        if (options.orientation) setup.orientation = options.orientation as Word.PageOrientation;
        if (options.paperSize) setup.paperSize = options.paperSize as Word.PaperSize;
        if (typeof options.pageWidth === "number") setup.pageWidth = options.pageWidth;
        if (typeof options.pageHeight === "number") setup.pageHeight = options.pageHeight;
        if (typeof options.gutter === "number") setup.gutter = options.gutter;
        if (typeof options.headerDistance === "number") setup.headerDistance = options.headerDistance;
        if (typeof options.footerDistance === "number") setup.footerDistance = options.footerDistance;
        if (typeof options.differentFirstPage === "boolean") {
          setup.differentFirstPageHeaderFooter = options.differentFirstPage;
        }
        if (typeof options.oddEvenPages === "boolean") {
          setup.oddAndEvenPagesHeaderFooter = options.oddEvenPages;
        }
        if (typeof options.mirrorMargins === "boolean") setup.mirrorMargins = options.mirrorMargins;
      });
      await context.sync();
    });
  }

  async headerFooter(
    element: string,
    text: string,
    options: { sectionIndex?: number; kind?: string; alignment?: string } = {},
  ): Promise<void> {
    const target = element.toLowerCase();
    if (!["header", "footer", "page_number"].includes(target)) {
      throw new Error("element must be header, footer, or page_number");
    }
    await Word.run(async (context) => {
      const sections = context.document.sections;
      sections.load("items");
      await context.sync();
      const sectionIndex = Math.max(1, options.sectionIndex ?? 1);
      const section = sections.items[sectionIndex - 1];
      if (!section) throw new Error(`section ${sectionIndex} is out of range`);
      const kind = options.kind?.toLowerCase() === "first"
        ? Word.HeaderFooterType.firstPage
        : options.kind?.toLowerCase() === "even"
          ? Word.HeaderFooterType.evenPages
          : Word.HeaderFooterType.primary;
      const body = target === "header"
        ? section.getHeader(kind)
        : section.getFooter(kind);
      body.clear();
      if (target === "page_number") {
        if (!Office.context?.requirements?.isSetSupported?.("WordApi", "1.5")) {
          throw new Error(i18n.t("taskpane.wordAdapter.errors.pageNumberUnsupported"));
        }
        const range = body.getRange(Word.RangeLocation.start);
        range.insertField(Word.InsertLocation.start, Word.FieldType.page);
        range.insertText(" / ", Word.InsertLocation.end);
        range.insertField(Word.InsertLocation.end, Word.FieldType.numPages);
      } else {
        body.insertText(text, Word.InsertLocation.start);
      }
      if (options.alignment) {
        const paragraphs = body.paragraphs;
        paragraphs.load("items");
        await context.sync();
        paragraphs.items.forEach((paragraph) => {
          paragraph.alignment = options.alignment as Word.Alignment;
        });
      }
      await context.sync();
    });
  }

  async editTableStructure(
    tableIndex: number,
    action: string,
    options: { row?: number; column?: number; endRow?: number; endColumn?: number; count?: number } = {},
  ): Promise<void> {
    await Word.run(async (context) => {
      const tables = context.document.body.tables;
      tables.load("items");
      await context.sync();
      const table = tables.items[tableIndex - 1];
      if (!table) throw new Error(`table ${tableIndex} is out of range`);
      const row = Math.max(1, options.row ?? 1);
      const column = Math.max(1, options.column ?? 1);
      const count = Math.max(1, options.count ?? 1);
      switch (action.toLocaleLowerCase()) {
        case "insert_row":
          table.getCell(row - 1, 0).insertRows(Word.InsertLocation.after, count);
          break;
        case "delete_row":
          table.deleteRows(row - 1, count);
          break;
        case "insert_column":
          table.getCell(0, column - 1).insertColumns(Word.InsertLocation.after, count);
          break;
        case "delete_column":
          table.deleteColumns(column - 1, count);
          break;
        case "merge_cells":
          if (!Office.context?.requirements?.isSetSupported?.("WordApiDesktop", "1.4")) {
            throw new Error(i18n.t("taskpane.wordAdapter.errors.tableMergeUnsupported"));
          }
          table.getCell(row - 1, column - 1).merge(
            table.getCell((options.endRow ?? row) - 1, (options.endColumn ?? column) - 1),
          );
          break;
        case "split_cell":
          if (!Office.context?.requirements?.isSetSupported?.("WordApi", "1.4")) {
            throw new Error(i18n.t("taskpane.wordAdapter.errors.tableSplitUnsupported"));
          }
          table.getCell(row - 1, column - 1).split(
            Math.max(1, options.endRow ?? 1),
            Math.max(1, options.endColumn ?? count),
          );
          break;
        default:
          throw new Error(`unsupported table structure action: ${action}`);
      }
      await context.sync();
    });
  }

  async formatTable(
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
    await Word.run(async (context) => {
      const tables = context.document.body.tables;
      tables.load("items");
      await context.sync();
      const table = tables.items[tableIndex - 1];
      if (!table) throw new Error(`table ${tableIndex} is out of range`);
      if (options.styleName) table.style = options.styleName;
      if (typeof options.headerRows === "number") table.headerRowCount = Math.max(0, options.headerRows);
      if (options.alignment) table.alignment = options.alignment as Word.Alignment;
      if (options.cellAlignment) table.horizontalAlignment = options.cellAlignment as Word.Alignment;
      if (options.verticalAlignment) {
        table.verticalAlignment = options.verticalAlignment as Word.VerticalAlignment;
      }
      if (options.shadingColor) table.shadingColor = options.shadingColor;
      if (options.borderColor || typeof options.borderWidth === "number") {
        const border = table.getBorder(Word.BorderLocation.all);
        border.type = Word.BorderType.single;
        if (options.borderColor) border.color = options.borderColor;
        if (typeof options.borderWidth === "number") border.width = options.borderWidth;
      }
      const autofit = options.autofit?.toLocaleLowerCase();
      if (autofit === "window") {
        table.autoFitWindow();
      } else if (autofit === "content" || autofit === "fixed") {
        if (!Office.context?.requirements?.isSetSupported?.("WordApiDesktop", "1.4")) {
          throw new Error(i18n.t("taskpane.wordAdapter.errors.tableAutofitUnsupported"));
        }
        table.autoFitBehavior(autofit === "content" ? Word.AutoFitBehavior.content : Word.AutoFitBehavior.fixedSize);
      }
      await context.sync();
    });
  }

  async updateToc(
    action: string,
    options: {
      upperHeadingLevel?: number;
      lowerHeadingLevel?: number;
      includePageNumbers?: boolean;
      rightAlignPageNumbers?: boolean;
      useHyperlinks?: boolean;
    } = {},
  ): Promise<{ count: number }> {
    return Word.run(async (context) => {
      const tables = context.document.tablesOfContents;
      tables.load("items");
      await context.sync();
      if (action.toLowerCase() === "insert") {
        tables.add(context.document.body.getRange(Word.RangeLocation.start), {
          upperHeadingLevel: Math.max(1, Math.min(8, options.upperHeadingLevel ?? 1)),
          lowerHeadingLevel: Math.max(2, Math.min(9, options.lowerHeadingLevel ?? 3)),
          includePageNumbers: options.includePageNumbers ?? true,
          rightAlignPageNumbers: options.rightAlignPageNumbers ?? true,
          useHyperlinksOnWeb: options.useHyperlinks ?? true,
        });
      } else {
        tables.items.forEach((table) => table.updatePageNumbers());
      }
      await context.sync();
      return { count: tables.items.length + (action.toLowerCase() === "insert" ? 1 : 0) };
    });
  }

  async askHuman(question: string): Promise<{ answer: string | null }> {
    if (!question.trim()) throw new Error("question is required");
    const answer = this.askHumanHandler ? await this.askHumanHandler(question) : null;
    return { answer };
  }
}
