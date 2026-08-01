import {
  generateTextWorkflow,
  resolveTextWorkflowOutputMode,
  TEXT_WORKFLOWS,
} from "../apps/addin/src/text-workflow.ts";
import { applyOutputLanguage } from "../apps/addin/src/output-language.ts";
import { selectProviderForAiMode } from "../apps/addin/src/provider-mode.ts";
import type { ChatMessage } from "../apps/addin/src/contracts.ts";
import i18n from "../apps/addin/src/i18n.ts";
import { buildTextRevisionHunks } from "../apps/addin/src/text-revision-diff.ts";
import {
  createTextPromptPreset,
  loadTextPromptPresets,
  saveTextPromptPresets,
} from "../apps/addin/src/text-prompt-presets.ts";
import {
  loadTextWorkflowPreferences,
  saveTextWorkflowPreferences,
  workflowPreference,
} from "../apps/addin/src/text-workflow-preferences.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Text workflow smoke failed: ${message}`);
}

await i18n.changeLanguage("zh-CN");
for (const key of [
  "writing", "modify", "polish", "expand", "simplify", "continue",
  "summarize", "fix", "translate", "translate-zh", "translate-en", "fairness",
  "risk",
]) {
  assert(TEXT_WORKFLOWS[key]?.title, `missing workflow definition ${key}`);
}
assert(TEXT_WORKFLOWS.writing.defaultScope === "none", "writing starts without destructive source");
assert(TEXT_WORKFLOWS.polish.defaultScope === "selection", "polish targets selection");
assert(TEXT_WORKFLOWS.summarize.defaultScope === "selection", "editing workflows start from the selection");
assert(TEXT_WORKFLOWS.continue.preferredAction === "insert", "continue auto-apply inserts generated text");
assert(TEXT_WORKFLOWS.summarize.preferredAction === "replace", "summary auto-apply revises the selected source");
assert(TEXT_WORKFLOWS.fairness.preferredAction === "replace", "fairness auto-apply revises the selected clause");
assert(TEXT_WORKFLOWS.risk.preferredAction === "comment", "legal risk output must default to a Word comment");
for (const key of ["modify", "polish", "expand", "simplify", "continue", "summarize", "fix", "fairness", "risk"]) {
  assert(TEXT_WORKFLOWS[key].supportsAutoApply, `${key} should support automatic document modification`);
}
for (const key of ["writing", "translate", "translate-zh", "translate-en"]) {
  assert(!TEXT_WORKFLOWS[key].supportsAutoApply, `${key} must require an explicit document action`);
}
assert(resolveTextWorkflowOutputMode("Auto", TEXT_WORKFLOWS.polish, "短文本") === "InsertBelow",
  "short auto output inserts below");
assert(resolveTextWorkflowOutputMode("Auto", TEXT_WORKFLOWS.polish, "一\n二\n三\n四\n五\n六\n七\n八") === "ReviewPane",
  "multi-paragraph auto output uses review pane");
assert(resolveTextWorkflowOutputMode("ReplaceOriginal", TEXT_WORKFLOWS.polish, "文本") === "ReplaceOriginal",
  "explicit output mode is honored");
assert(resolveTextWorkflowOutputMode("ReplaceOriginal", TEXT_WORKFLOWS.risk, "文本") === "Comment",
  "workflow safety preference overrides incompatible global mode");
assert(resolveTextWorkflowOutputMode(
  "ReviewPane",
  TEXT_WORKFLOWS.summarize,
  "全文",
  "document",
) === "InsertBelow", "document output cannot enter selection-based review handoff");
assert(resolveTextWorkflowOutputMode(
  "ReplaceOriginal",
  TEXT_WORKFLOWS.writing,
  "",
  "none",
) === "InsertBelow", "selection-only output modes degrade safely without a selection");
const languageMessages: ChatMessage[] = [{ role: "user", content: "Draft a clause" }];
assert(applyOutputLanguage(languageMessages, "auto") === languageMessages,
  "automatic language mode leaves provider messages unchanged");
assert(applyOutputLanguage(languageMessages, "zh")[0].content.includes("简体中文"),
  "Chinese language mode adds a provider-wide instruction");
assert(applyOutputLanguage(languageMessages, "en")[0].content.includes("English"),
  "English language mode adds a provider-wide instruction");
assert(applyOutputLanguage(languageMessages, "source")[0].content.includes("same language"),
  "source language mode adds a provider-wide instruction");
const providerView = {
  activeProviderId: "ollama",
  profiles: [
    {
      id: "ollama", name: "Local", type: "Ollama", endpoint: "http://127.0.0.1:11434",
      model: "qwen", toolCallingMode: "Auto", supportsStreaming: true, supportsVision: false,
      supportsJsonOutput: true, contextWindow: 32768, hasApiKey: false, temperature: 0.5,
      maxTokens: 4096, keepAlive: "5m",
    },
    {
      id: "online", name: "Cloud", type: "OpenAI", endpoint: "https://api.openai.com/v1",
      model: "model", toolCallingMode: "Auto", supportsStreaming: true, supportsVision: true,
      supportsJsonOutput: true, contextWindow: 128000, hasApiKey: true, temperature: 0.5,
      maxTokens: 4096, keepAlive: "5m",
    },
  ],
};
assert(selectProviderForAiMode(providerView, "ollama").candidate?.id === "ollama",
  "Ollama AI mode retains an active Ollama profile");
assert(selectProviderForAiMode(providerView, "online").candidate?.id === "online",
  "online AI mode selects an online provider profile");
assert(selectProviderForAiMode({
  activeProviderId: "ollama",
  profiles: [providerView.profiles[0]],
}, "online").candidate === undefined,
  "missing preferred provider is reported instead of silently changing the saved AI mode");

class FakeRuntime {
  messages: ChatMessage[] = [];
  signal?: AbortSignal;
  async *streamChat(messages: ChatMessage[], _model?: string, signal?: AbortSignal) {
    this.messages = messages;
    this.signal = signal;
    yield { provider: "fake", model: "fake", delta: "  修改后", done: false };
    yield { provider: "fake", model: "fake", delta: "的文本  ", done: true };
  }
}

const runtime = new FakeRuntime();
const controller = new AbortController();
const streamedUpdates: string[] = [];
const result = await generateTextWorkflow(
  runtime as never,
  TEXT_WORKFLOWS.polish,
  "原文",
  "当前选区",
  "正式一些",
  "强制中文",
  "简洁、专业",
  controller.signal,
  (content) => streamedUpdates.push(content),
);
assert(result === "修改后的文本", "provider output is trimmed");
assert(streamedUpdates.length === 2, "text workflow did not expose incremental output");
assert(runtime.messages[0].content.includes("只输出润色后的完整文本"), "workflow system contract applied");
assert(runtime.messages[0].content.includes("强制中文"), "language preference applied");
assert(runtime.messages[1].content.includes("正式一些") && runtime.messages[1].content.includes("简洁、专业"),
  "instruction and writing profile applied");
assert(runtime.signal === controller.signal, "cancellation signal reaches Provider");

const revisionHunks = buildTextRevisionHunks("合同应当立即履行。违约金为十万元。", "合同应当按期履行。违约金为五万元。");
assert(revisionHunks.length === 2, "precise revisions preserve separate edits");
assert(revisionHunks[0].originalText.includes("立即") && revisionHunks[1].revisedText.includes("五"),
  "precise revision hunks retain the changed text");

let promptStorage = "";
const storage = {
  getItem: () => promptStorage || null,
  setItem: (_key: string, value: string) => { promptStorage = value; },
};
const savedPreset = createTextPromptPreset("polish", "法律文风", "保持法律术语准确");
saveTextPromptPresets(storage, [savedPreset]);
assert(loadTextPromptPresets(storage)[0]?.instruction === "保持法律术语准确",
  "multiple text tools can persist their own prompt presets");
let preferenceStorage = "";
const preferencesStorage = {
  getItem: () => preferenceStorage || null,
  setItem: (_key: string, value: string) => { preferenceStorage = value; },
};
saveTextWorkflowPreferences(preferencesStorage, {
  polish: { defaultPresetId: savedPreset.id, autoApply: true },
});
const preferences = loadTextWorkflowPreferences(preferencesStorage);
assert(workflowPreference(preferences, "polish").defaultPresetId === savedPreset.id,
  "each editing workflow persists its own default prompt");
assert(workflowPreference(preferences, "polish").autoApply,
  "each editing workflow persists its automatic apply preference");
assert(!workflowPreference(preferences, "expand").autoApply,
  "automatic apply is opt-in per workflow");

await generateTextWorkflow(
  runtime as never,
  TEXT_WORKFLOWS.summarize,
  "x".repeat(100_100),
  "当前文档",
  "",
  "",
  "",
);
assert(runtime.messages[1].content.includes("100000 字符上限截断"), "large source is bounded");

await i18n.changeLanguage("en-US");
assert(TEXT_WORKFLOWS.polish.title === "Polish text", "workflow titles do not react to locale changes");
await generateTextWorkflow(
  runtime as never,
  TEXT_WORKFLOWS.polish,
  "Source",
  "Selection",
  "",
  "",
  "",
);
assert(runtime.messages[0].content.includes("complete polished text"),
  "English workflow system contract was not localized");

console.log("Office.js dedicated text workflow smoke passed.");
