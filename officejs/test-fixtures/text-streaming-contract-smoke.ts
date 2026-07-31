import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { streamText } from "../apps/addin/src/stream-text.ts";
import {
  beginStreamingText,
  endStreamingText,
  updateStreamingText,
} from "../apps/addin/src/streaming-ui.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Text streaming contract smoke failed: ${message}`);
}

const controller = new AbortController();
const updates: string[] = [];
let receivedSignal: AbortSignal | undefined;
const runtime = {
  async *streamChat(
    _messages: Array<{ role: string; content: string }>,
    _model?: string,
    signal?: AbortSignal,
  ) {
    receivedSignal = signal;
    yield { provider: "fake", model: "fake", delta: "第一段", done: false };
    yield { provider: "fake", model: "fake", delta: "第二段", done: true };
  },
};
const result = await streamText(
  runtime as never,
  [{ role: "user", content: "test" }],
  controller.signal,
  (content) => updates.push(content),
);
assert(result === "第一段第二段", "chunks were not accumulated in order");
assert(updates.join("|") === "第一段|第一段第二段", "incremental UI updates were not emitted");
assert(receivedSignal === controller.signal, "abort signal did not reach the provider stream");

let scheduledFrame: FrameRequestCallback | null = null;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    requestAnimationFrame(callback: FrameRequestCallback) {
      scheduledFrame = callback;
      return 1;
    },
    cancelAnimationFrame() {
      scheduledFrame = null;
    },
  },
});
const textarea = {
  value: "old",
  dataset: {} as Record<string, string>,
  scrollHeight: 100,
  scrollTop: 50,
  clientHeight: 50,
  readOnly: false,
  dispatchEvent() {
    return true;
  },
} as HTMLTextAreaElement;
beginStreamingText(textarea);
assert(textarea.readOnly, "streaming output should not be editable while chunks are arriving");
updateStreamingText(textarea, "第一段");
updateStreamingText(textarea, "第一段第二段");
assert(textarea.value === "", "token bursts should be batched before the next frame");
scheduledFrame?.(0);
assert(textarea.value === "第一段第二段", "batched output did not render the latest content");
assert(textarea.scrollTop === textarea.scrollHeight, "output should follow while the user is at the bottom");
textarea.scrollHeight = 300;
textarea.scrollTop = 0;
updateStreamingText(textarea, "用户正在查看前文");
scheduledFrame?.(1);
assert(textarea.scrollTop === 0, "automatic scrolling must stop after the user scrolls upward");
endStreamingText(textarea, "保留的部分结果");
assert(
  textarea.value === "保留的部分结果" &&
    textarea.dataset.streaming === undefined &&
    !textarea.readOnly,
  "ending a stream must preserve content and clear streaming state",
);

const repoRoot = resolve(import.meta.dirname, "../..");
for (const path of [
  "officejs/apps/addin/src/translation-workflow.ts",
  "officejs/apps/addin/src/text-workflow.ts",
  "officejs/apps/addin/src/image-workflow.ts",
  "officejs/apps/addin/src/legal-workflows.ts",
  "officejs/apps/addin/src/custom-prompts.ts",
  "officejs/apps/addin/src/html-workflow.ts",
]) {
  assert(
    readFileSync(resolve(repoRoot, path), "utf8").includes("streamText("),
    `${path} is a direct-text workflow but does not use streaming`,
  );
}

for (const path of [
  "officejs/apps/addin/src/table-workflow.ts",
  "officejs/apps/addin/src/review-workspace.ts",
]) {
  const source = readFileSync(resolve(repoRoot, path), "utf8");
  assert(source.includes("runtime.chat("), `${path} lost its complete JSON response path`);
  assert(!source.includes("streamText("), `${path} must not stream partial JSON`);
}

console.log("Direct-text streaming and structured JSON separation smoke passed.");
