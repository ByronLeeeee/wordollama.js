import i18n from "./i18n.ts";
import type { RuntimeClient } from "./runtime-client";
import { streamText, type TextStreamUpdate } from "./stream-text.ts";
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
  runtime: Pick<RuntimeClient, "streamChat">,
  request: TranslationRequest,
  signal?: AbortSignal,
  onUpdate?: TextStreamUpdate,
): Promise<string> {
  const template = request.sourceLanguage === "auto"
    ? "taskpane.translation.model.adaptivePrompt"
    : "taskpane.translation.model.explicitPrompt";
  const instructions = request.instructions?.trim();
  const result = await streamText(runtime, [{
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
  }], signal, onUpdate);

  if (!result) {
    throw new Error(i18n.t("taskpane.translation.errors.emptyResult"));
  }
  return result;
}
