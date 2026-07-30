import i18n from "./i18n.ts";
import type { RuntimeClient } from "./runtime-client";
import {
  languageDisplayName,
  type SourceLanguageCode,
  type TranslationLanguageCode,
} from "./translation-languages.ts";

export interface TranslationRequest {
  source: string;
  sourceLanguage: SourceLanguageCode;
  targetLanguage: TranslationLanguageCode;
  instructions?: string;
}

export async function generateTranslation(
  runtime: Pick<RuntimeClient, "chat">,
  request: TranslationRequest,
  signal?: AbortSignal,
): Promise<string> {
  const template = request.sourceLanguage === "auto"
    ? "taskpane.translation.model.adaptivePrompt"
    : "taskpane.translation.model.explicitPrompt";
  const instructions = request.instructions?.trim();
  const response = await runtime.chat([{
    role: "user",
    content: i18n.t(template, {
      sourceLanguage: languageDisplayName(request.sourceLanguage),
      targetLanguage: languageDisplayName(request.targetLanguage),
      instructions: instructions
        ? i18n.t("taskpane.translation.model.instructions", { instructions })
        : "",
      source: request.source,
      interpolation: { escapeValue: false },
    }),
  }], undefined, signal);

  const result = response.content.trim();
  if (!result) {
    throw new Error(i18n.t("taskpane.translation.errors.emptyResult"));
  }
  return result;
}
