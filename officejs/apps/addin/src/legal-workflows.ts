import type { RuntimeClient } from "./runtime-client";
import i18n from "./i18n.ts";

export type PleadingType = "indictment" | "defense";

export async function investigatePleading(
  runtime: RuntimeClient,
  pleadingType: PleadingType,
  documentText: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!documentText.trim()) throw new Error(i18n.t("taskpane.moot.errors.sourceRequired"));
  const typeLabel = i18n.t(`taskpane.moot.${pleadingType === "indictment" ? "complaint" : "defense"}`);
  const response = await runtime.chat([
    {
      role: "system",
      content: [
        "You are conducting a rigorous moot-court investigation, not giving a final judicial conclusion.",
        "Identify factual assertions, disputed issues, legal elements, evidence gaps, burden of proof, counterarguments, and questions for examination.",
        "Separate facts stated in the pleading from assumptions. Do not fabricate statutes, cases, evidence, or quotations.",
        "Use a numbered, actionable structure and explain why each investigation question matters.",
      ].join("\n"),
    },
    {
      role: "user",
      content: i18n.t("taskpane.moot.model.userMessage", {
        type: typeLabel,
        document: documentText.slice(0, 100_000),
        interpolation: { escapeValue: false },
      }),
    },
  ], undefined, signal);
  if (!response.content.trim()) throw new Error(i18n.t("taskpane.moot.errors.emptyResult"));
  return response.content.trim();
}

export function formatLawArticle(article: {
  lawName: string;
  articleNumber: string;
  content: string;
}): string {
  return `【${article.lawName}】${article.articleNumber}\n${article.content}`.trim();
}
