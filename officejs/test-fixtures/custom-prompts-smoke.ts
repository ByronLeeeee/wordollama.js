import {
  loadCustomPrompts,
  runCustomPrompt,
  saveCustomPrompts,
  type CustomPromptDefinition,
} from "../apps/addin/src/custom-prompts.ts";
import type { RuntimeClient } from "../apps/addin/src/runtime-client.ts";
import i18n from "../apps/addin/src/i18n.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Custom prompt smoke failed: ${message}`);
}

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
} as Storage;
const prompts: CustomPromptDefinition[] = [
  { id: "c1", name: "合同语言", prompt: "改为严谨合同语言", outputMode: "TrackedChanges", quickSlot: 1 },
  { id: "more", name: "提示风险", prompt: "指出风险", outputMode: "Comment" },
];
await i18n.changeLanguage("en-US");
saveCustomPrompts(storage, prompts);
assert(loadCustomPrompts(storage).length === 2, "prompt library did not round-trip");

let duplicateRejected = false;
try {
  saveCustomPrompts(storage, [
    prompts[0],
    { ...prompts[1], name: prompts[0].name },
  ]);
} catch { duplicateRejected = true; }
assert(duplicateRejected, "duplicate prompt names were accepted");

let captured = "";
const runtime = {
  async *streamChat(messages: Array<{ content: string }>) {
    captured = messages.map((message) => message.content).join("\n");
    yield { provider: "fake", model: "fake", delta: "修改", done: false };
    yield { provider: "fake", model: "fake", delta: "结果", done: true };
  },
} as unknown as RuntimeClient;
const result = await runCustomPrompt(runtime, prompts[0], "原始选区");
assert(result === "修改结果", "custom prompt result was not returned");
assert(captured.includes("改为严谨合同语言") && captured.includes("原始选区"), "custom prompt or source was lost");
assert(captured.includes("complete final text"), "edit output contract was not applied");

await i18n.changeLanguage("zh-CN");
let localizedError = "";
try {
  await runCustomPrompt(runtime, prompts[0], "");
} catch (error) {
  localizedError = error instanceof Error ? error.message : String(error);
}
assert(localizedError === "请先在 Word 中选择文本", "Chinese runtime error was not localized");

console.log("Office.js custom prompt and quick-slot smoke passed.");
