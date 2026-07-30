import type { ChatMessage } from "./contracts.ts";

export type OutputLanguageMode = "auto" | "zh" | "en" | "source";

export function applyOutputLanguage(
  messages: ChatMessage[],
  mode: OutputLanguageMode,
): ChatMessage[] {
  const instruction = mode === "zh"
    ? "始终使用简体中文输出；原文、专有名词和用户明确要求保留的内容除外。"
    : mode === "en"
      ? "Always respond in English, except for source quotations, proper nouns, or explicit user requirements."
      : mode === "source"
        ? "Use the same language as the source text or primary user content. Preserve quotations and proper nouns."
        : "";
  return instruction
    ? [{ role: "system", content: instruction }, ...messages]
    : messages;
}
