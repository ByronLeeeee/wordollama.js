import type { RuntimeClient } from "./runtime-client";
import type { ReviewAnchor } from "./review-anchor";
import i18n from "./i18n.ts";

export type ReviewSeverity = "high" | "medium" | "low";

export interface ReviewIssue {
  id: string;
  source: string;
  category: string;
  severity: ReviewSeverity;
  paragraphIndex: number;
  title: string;
  description: string;
  suggestion: string;
  excerpt: string;
  anchor?: ReviewAnchor;
}

export interface ReviewSuggestion {
  id: string;
  paragraphIndex: number;
  originalText: string;
  suggestedText: string;
  reason: string;
  status: "pending" | "accepted" | "inserted" | "commented" | "skipped";
  anchor?: ReviewAnchor;
}

const MAX_REVIEW_ITEMS = 100;
const MAX_REVIEW_SOURCE_CHARACTERS = 100_000;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function firstString(record: JsonRecord, names: string[]): string {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstInteger(record: JsonRecord, names: string[]): number {
  for (const name of names) {
    const value = record[name];
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function normalizeSeverity(value: string): ReviewSeverity {
  const normalized = value.trim().toLocaleLowerCase();
  if (["high", "critical", "严重", "高"].includes(normalized)) return "high";
  if (["low", "minor", "轻微", "低"].includes(normalized)) return "low";
  return "medium";
}

function extractJsonItems(content: string, propertyNames: string[]): unknown[] {
  const withoutFence = content
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const arrayStart = withoutFence.indexOf("[");
  const arrayEnd = withoutFence.lastIndexOf("]");
  const objectStart = withoutFence.indexOf("{");
  const objectEnd = withoutFence.lastIndexOf("}");
  let parsed: unknown;
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    parsed = JSON.parse(withoutFence.slice(arrayStart, arrayEnd + 1));
  } else if (objectStart >= 0 && objectEnd > objectStart) {
    parsed = JSON.parse(withoutFence.slice(objectStart, objectEnd + 1));
  } else {
    throw new Error(i18n.t("taskpane.review.errors.invalidJsonResult"));
  }
  if (Array.isArray(parsed)) return parsed;
  const record = asRecord(parsed);
  if (record) {
    for (const property of propertyNames) {
      if (Array.isArray(record[property])) return record[property] as unknown[];
    }
  }
  throw new Error(i18n.t("taskpane.review.errors.missingItems"));
}

export function parseReviewIssues(content: string): ReviewIssue[] {
  return extractJsonItems(content, ["issues", "问题", "items"])
    .slice(0, MAX_REVIEW_ITEMS)
    .map(asRecord)
    .filter((record): record is JsonRecord => record !== undefined)
    .map((record, index) => {
      const category = firstString(record, ["category", "类型", "类别"]) ||
        i18n.t("taskpane.reviewRuntime.defaultCategory");
      const excerpt = firstString(record, ["excerpt", "original", "原文", "摘录"]);
      const description = firstString(record, ["description", "reason", "问题", "说明"]);
      return {
        id: firstString(record, ["id"]) || `issue-${index + 1}`,
        source: firstString(record, ["source", "来源"]) ||
          i18n.t("taskpane.reviewRuntime.defaultSource"),
        category,
        severity: normalizeSeverity(firstString(record, ["severity", "严重程度", "level"])),
        paragraphIndex: firstInteger(record, ["paragraphIndex", "paragraph_index", "paragraph", "段落"]),
        title: firstString(record, ["title", "标题"]) || category,
        description: description || excerpt,
        suggestion: firstString(record, ["suggestion", "建议", "recommendedChange"]),
        excerpt,
      };
    })
    .filter((issue) => issue.title || issue.description || issue.excerpt);
}

export function parseReviewSuggestions(content: string): ReviewSuggestion[] {
  return extractJsonItems(content, ["suggestions", "建议", "items"])
    .slice(0, MAX_REVIEW_ITEMS)
    .map(asRecord)
    .filter((record): record is JsonRecord => record !== undefined)
    .map((record, index) => ({
      id: firstString(record, ["id"]) || `suggestion-${index + 1}`,
      paragraphIndex: firstInteger(record, ["paragraphIndex", "paragraph_index", "paragraph", "段落"]),
      originalText: firstString(record, ["originalText", "original", "原文"]),
      suggestedText: firstString(record, ["suggestedText", "suggestion", "修改后", "建议"]),
      reason: firstString(record, ["reason", "description", "理由", "说明"]),
      status: "pending" as const,
    }))
    .filter((suggestion) => suggestion.originalText && suggestion.suggestedText);
}

function boundedSource(source: string): string {
  if (source.length <= MAX_REVIEW_SOURCE_CHARACTERS) return source;
  return i18n.t("taskpane.reviewRuntime.truncatedSource", {
    source: source.slice(0, MAX_REVIEW_SOURCE_CHARACTERS),
    max: MAX_REVIEW_SOURCE_CHARACTERS,
    interpolation: { escapeValue: false },
  });
}

export async function generateReviewIssues(
  runtime: RuntimeClient,
  source: string,
  scopeLabel: string,
  providerProfileId?: string,
  signal?: AbortSignal,
): Promise<ReviewIssue[]> {
  const response = await runtime.chat([
    {
      role: "system",
      content: i18n.t("taskpane.reviewRuntime.issueSystemPrompt"),
    },
    {
      role: "user",
      content: i18n.t("taskpane.reviewRuntime.issueUserMessage", {
        scope: scopeLabel,
        source: boundedSource(source),
        interpolation: { escapeValue: false },
      }),
    },
  ], undefined, signal, providerProfileId || undefined);
  return parseReviewIssues(response.content);
}

export async function generateReviewSuggestions(
  runtime: RuntimeClient,
  source: string,
  instruction: string,
  signal?: AbortSignal,
): Promise<ReviewSuggestion[]> {
  const response = await runtime.chat([
    {
      role: "system",
      content: i18n.t("taskpane.reviewRuntime.suggestionSystemPrompt"),
    },
    {
      role: "user",
      content: i18n.t("taskpane.reviewRuntime.suggestionUserMessage", {
        instruction: instruction || i18n.t("taskpane.reviewRuntime.defaultInstruction"),
        profile: i18n.t("taskpane.reviewRuntime.noProfile"),
        source: boundedSource(source),
        interpolation: { escapeValue: false },
      }),
    },
  ], undefined, signal);
  return parseReviewSuggestions(response.content);
}
