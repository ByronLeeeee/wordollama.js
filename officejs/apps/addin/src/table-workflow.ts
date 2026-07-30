import type { RuntimeClient } from "./runtime-client";
import i18n from "./i18n.ts";

export interface StructuredTable {
  headers: string[];
  rows: string[][];
}

const MAX_SOURCE_LENGTH = 100_000;
const MAX_COLUMNS = 20;
const MAX_ROWS = 200;

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseStructuredTable(value: string): StructuredTable {
  const cleaned = stripCodeFence(value);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(i18n.t("taskpane.table.errors.invalidJson"));

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error(i18n.t("taskpane.table.errors.parseFailed"));
  }

  const candidate = parsed as { headers?: unknown; rows?: unknown };
  if (!Array.isArray(candidate.headers) || candidate.headers.length < 1) {
    throw new Error(i18n.t("taskpane.table.errors.headersRequired"));
  }
  if (candidate.headers.length > MAX_COLUMNS) {
    throw new Error(i18n.t("taskpane.table.errors.maxColumns", { count: MAX_COLUMNS }));
  }

  const headers = candidate.headers.map((value) => String(value ?? "").trim());
  if (headers.some((value) => !value)) throw new Error(i18n.t("taskpane.table.errors.emptyHeader"));
  if (!Array.isArray(candidate.rows)) throw new Error(i18n.t("taskpane.table.errors.rowsArray"));
  if (candidate.rows.length > MAX_ROWS) {
    throw new Error(i18n.t("taskpane.table.errors.maxRows", { count: MAX_ROWS }));
  }

  const rows = candidate.rows.map((row) => {
    if (!Array.isArray(row)) throw new Error(i18n.t("taskpane.table.errors.rowArray"));
    return Array.from({ length: headers.length }, (_, index) => String(row[index] ?? ""));
  });
  return { headers, rows };
}

export async function generateStructuredTable(
  runtime: RuntimeClient,
  source: string,
  requirement: string,
  signal?: AbortSignal,
): Promise<StructuredTable> {
  const boundedSource = source.slice(0, MAX_SOURCE_LENGTH);
  if (!boundedSource.trim()) throw new Error(i18n.t("taskpane.table.errors.sourceRequired"));
  const response = await runtime.chat([
    {
      role: "system",
      content: [
        "Analyze source text and convert it to structured table data.",
        'Return only one JSON object with this exact shape: {"headers":["Column"],"rows":[["Value"]]}.',
        `Use at most ${MAX_COLUMNS} columns and ${MAX_ROWS} data rows.`,
        "Keep facts and terminology faithful to the source. Never add markdown fences or explanations.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        requirement.trim() ? `Additional requirements:\n${requirement.trim()}` : "Infer the most useful columns.",
        `Source text:\n${boundedSource}`,
      ].join("\n\n"),
    },
  ], undefined, signal);
  return parseStructuredTable(response.content);
}
