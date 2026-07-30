import { OfficeJsWordAdapter } from "./officejs-word-adapter.ts";
import { createReviewAnchors } from "./review-anchor.ts";
import type { ReleaseTestIdentity } from "./contracts.ts";
import i18n from "./i18n.ts";

export interface LongDocumentHost {
  describeHost(): Record<string, string>;
  prepareFixture(paragraphCount: number): Promise<{ characterCount: number }>;
  readOverview(): Promise<{ paragraphCount: number }>;
  readRange(start: number, end: number): Promise<{ start: number; end: number; paragraphs: string[] }>;
  readChunk(start: number): Promise<{ start: number; end: number; paragraphs: string[] }>;
  buildSemanticMap(): Promise<{ paragraphCount: number; entries: Array<{ start: number; end: number; summary: string }> }>;
  verifyRelocation(targetIndex: number): Promise<{ resolvedIndex: number }>;
}

export interface LongDocumentCaseResult {
  paragraphCount: number;
  characterCount: number;
  status: "passed" | "failed";
  prepareMs: number;
  overviewMs: number;
  fullReadMs: number;
  nearEndChunkMs: number;
  semanticMapMs: number;
  relocationMs: number;
  observedParagraphCount: number;
  semanticEntryCount: number;
  relocatedIndex: number;
  errors: string[];
}

export interface LongDocumentReport {
  schemaVersion: 1;
  startedAt: string;
  finishedAt: string;
  release?: ReleaseTestIdentity;
  host: Record<string, string>;
  operationBudgetMs: number;
  cases: LongDocumentCaseResult[];
}

async function measure<T>(action: () => Promise<T>): Promise<{ durationMs: number; value: T }> {
  const started = performance.now();
  const value = await action();
  return { durationMs: Math.round(performance.now() - started), value };
}

export async function runLongDocumentMatrix(
  host: LongDocumentHost,
  paragraphCounts = [1_000, 5_000],
  operationBudgetMs = 30_000,
  onProgress?: (message: string) => void,
): Promise<LongDocumentReport> {
  const startedAt = new Date().toISOString();
  const cases: LongDocumentCaseResult[] = [];

  for (const paragraphCount of paragraphCounts) {
    onProgress?.(i18n.t("taskpane.diagnosticsRuntime.long.preparing", { count: paragraphCount }));
    const errors: string[] = [];
    let characterCount = 0;
    let prepareMs = 0;
    let overviewMs = 0;
    let fullReadMs = 0;
    let nearEndChunkMs = 0;
    let semanticMapMs = 0;
    let relocationMs = 0;
    let observedParagraphCount = 0;
    let semanticEntryCount = 0;
    let relocatedIndex = 0;

    try {
      const prepared = await measure(() => host.prepareFixture(paragraphCount));
      prepareMs = prepared.durationMs;
      characterCount = prepared.value.characterCount;
      onProgress?.(i18n.t("taskpane.diagnosticsRuntime.long.overview", { count: paragraphCount }));
      const overview = await measure(() => host.readOverview());
      overviewMs = overview.durationMs;
      observedParagraphCount = overview.value.paragraphCount;
      onProgress?.(i18n.t("taskpane.diagnosticsRuntime.long.fullRead", { count: paragraphCount }));
      const fullRead = await measure(() => host.readRange(1, paragraphCount));
      fullReadMs = fullRead.durationMs;
      onProgress?.(i18n.t("taskpane.diagnosticsRuntime.long.endChunk", { count: paragraphCount }));
      const chunk = await measure(() => host.readChunk(Math.max(1, paragraphCount - 49)));
      nearEndChunkMs = chunk.durationMs;
      onProgress?.(i18n.t("taskpane.diagnosticsRuntime.long.semanticMap", { count: paragraphCount }));
      const semantic = await measure(() => host.buildSemanticMap());
      semanticMapMs = semantic.durationMs;
      semanticEntryCount = semantic.value.entries.length;
      onProgress?.(i18n.t("taskpane.diagnosticsRuntime.long.relocation", { count: paragraphCount }));
      const relocation = await measure(() => host.verifyRelocation(Math.max(2, Math.floor(paragraphCount * 0.8))));
      relocationMs = relocation.durationMs;
      relocatedIndex = relocation.value.resolvedIndex;

      if (observedParagraphCount !== paragraphCount) {
        errors.push(i18n.t("taskpane.diagnosticsRuntime.long.errors.overviewCount", {
          actual: observedParagraphCount,
          expected: paragraphCount,
        }));
      }
      if (fullRead.value.paragraphs.length !== paragraphCount || fullRead.value.end !== paragraphCount) {
        errors.push(i18n.t("taskpane.diagnosticsRuntime.long.errors.fullReadCount", {
          actual: fullRead.value.paragraphs.length,
          expected: paragraphCount,
        }));
      }
      if (chunk.value.end !== paragraphCount || chunk.value.paragraphs.length !== Math.min(50, paragraphCount)) {
        errors.push(i18n.t("taskpane.diagnosticsRuntime.long.errors.endChunkRange", {
          start: chunk.value.start,
          end: chunk.value.end,
        }));
      }
      if (semantic.value.paragraphCount !== paragraphCount ||
          semanticEntryCount !== Math.ceil(paragraphCount / 10)) {
        errors.push(i18n.t("taskpane.diagnosticsRuntime.long.errors.semanticMap", {
          paragraphs: semantic.value.paragraphCount,
          entries: semanticEntryCount,
        }));
      }
      const expectedRelocatedIndex = Math.max(2, Math.floor(paragraphCount * 0.8)) + 1;
      if (relocatedIndex !== expectedRelocatedIndex) {
        errors.push(i18n.t("taskpane.diagnosticsRuntime.long.errors.relocation", {
          actual: relocatedIndex,
          expected: expectedRelocatedIndex,
        }));
      }
      for (const [name, durationMs] of Object.entries({
        prepareMs,
        overviewMs,
        fullReadMs,
        nearEndChunkMs,
        semanticMapMs,
        relocationMs,
      })) {
        if (durationMs > operationBudgetMs) {
          errors.push(i18n.t("taskpane.diagnosticsRuntime.long.errors.budget", {
            name,
            duration: durationMs,
            budget: operationBudgetMs,
          }));
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    cases.push({
      paragraphCount,
      characterCount,
      status: errors.length ? "failed" : "passed",
      prepareMs,
      overviewMs,
      fullReadMs,
      nearEndChunkMs,
      semanticMapMs,
      relocationMs,
      observedParagraphCount,
      semanticEntryCount,
      relocatedIndex,
      errors,
    });
  }

  return {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    host: host.describeHost(),
    operationBudgetMs,
    cases,
  };
}

function longDocumentParagraph(index: number): string {
  const number = String(index).padStart(5, "0");
  return `[WO-LONG-${number}] 第${index}条 本段用于 WordOllama.JS 长文档读取、语义地图、分页和稳定锚点性能验收；内容必须保持唯一且可验证。`;
}

export class OfficeLongDocumentHost implements LongDocumentHost {
  private readonly word: OfficeJsWordAdapter;

  constructor(word: OfficeJsWordAdapter) {
    this.word = word;
  }

  describeHost(): Record<string, string> {
    return {
      host: String(Office.context?.host ?? "unknown"),
      platform: String(Office.context?.platform ?? "unknown"),
      version: String(Office.context?.diagnostics?.version ?? "unknown"),
      language: String(Office.context?.displayLanguage ?? "unknown"),
    };
  }

  async prepareFixture(paragraphCount: number): Promise<{ characterCount: number }> {
    const fixture = Array.from(
      { length: paragraphCount },
      (_, index) => longDocumentParagraph(index + 1),
    ).join("\n");
    await Word.run(async (context) => {
      context.document.body.insertText(fixture, Word.InsertLocation.replace);
      await context.sync();
    });
    return { characterCount: fixture.length };
  }

  readOverview(): Promise<{ paragraphCount: number }> {
    return this.word.getDocumentOverview();
  }

  readRange(start: number, end: number) {
    return this.word.readParagraphs(start, end);
  }

  readChunk(start: number) {
    return this.word.readLargeChunk(start);
  }

  buildSemanticMap() {
    return this.word.buildSemanticMap();
  }

  async verifyRelocation(targetIndex: number): Promise<{ resolvedIndex: number }> {
    const neighborhoodStart = targetIndex - 1;
    const neighborhood = await this.word.readParagraphs(neighborhoodStart, targetIndex + 1);
    const targetText = neighborhood.paragraphs[1];
    const anchor = createReviewAnchors(neighborhood.paragraphs, neighborhoodStart)[1];
    if (!targetText || !anchor) {
      throw new Error(i18n.t("taskpane.diagnosticsRuntime.long.errors.anchorCreate"));
    }

    await Word.run(async (context) => {
      context.document.body.insertParagraph(
        "[WO-LONG-CONCURRENT-INSERT] 模拟共同编辑在目标之前插入的段落。",
        Word.InsertLocation.start,
      );
      await context.sync();
    });
    const resolvedIndex = await this.word.resolveReviewParagraph(targetIndex, targetText, anchor);
    const updatedText = `${targetText} [WO-LONG-RELOCATED]`;
    await this.word.replaceParagraph(resolvedIndex, updatedText);
    const verification = await this.word.readParagraphs(resolvedIndex, resolvedIndex);
    if (verification.paragraphs[0] !== updatedText) {
      throw new Error(i18n.t("taskpane.diagnosticsRuntime.long.errors.anchorWrite"));
    }
    return { resolvedIndex };
  }
}
