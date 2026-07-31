import { generateTranslation } from "../apps/addin/src/translation-workflow.ts";
import { TRANSLATION_LANGUAGE_CODES } from "../apps/addin/src/translation-languages.ts";
import i18n from "../apps/addin/src/i18n.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Translation workflow smoke failed: ${message}`);
}

let capturedMessages: Array<{ role: string; content: string }> = [];
const runtime = {
  async *streamChat(messages: Array<{ role: string; content: string }>) {
    capturedMessages = messages;
    yield { provider: "fake", model: "fake", delta: "  This is a ", done: false };
    yield { provider: "fake", model: "fake", delta: "translated sentence.  ", done: true };
  },
};

await i18n.changeLanguage("en-US");
const updates: string[] = [];
const result = await generateTranslation(runtime as never, {
  source: "这是一段待翻译的文字。",
  sourceLanguage: "zh-CN",
  targetLanguage: "en",
  instructions: "Use formal legal language.",
}, undefined, (content) => updates.push(content));

assert(result === "This is a translated sentence.", "the translated result should be trimmed");
assert(updates.length === 2 && updates[0]?.includes("This is a "), "translation did not stream incrementally");
assert(TRANSLATION_LANGUAGE_CODES.length >= 90, "the searchable picker should cover most languages");
assert(
  capturedMessages[0]?.content.includes("Chinese") &&
    capturedMessages[0]?.content.includes("English") &&
    capturedMessages[0]?.content.includes("Use formal legal language.") &&
    capturedMessages[0]?.content.includes("这是一段待翻译的文字。"),
  "an explicit source language should produce one concise prompt with both languages",
);

await generateTranslation(runtime as never, {
  source: "Bonjour",
  sourceLanguage: "auto",
  targetLanguage: "en",
});
assert(
  capturedMessages.length === 1 &&
    !capturedMessages[0]?.content.includes("Adaptive text") &&
    capturedMessages[0]?.content.includes("into English"),
  "adaptive mode should omit a claimed source language",
);

console.log("Dedicated translation workflow smoke passed.");
