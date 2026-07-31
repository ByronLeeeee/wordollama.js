import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateStructuredTable,
  parseStructuredTable,
} from "../apps/addin/src/table-workflow.ts";
import {
  markdownInlineToHtml,
  markdownToBlocks,
  markdownToHtml,
} from "../apps/addin/src/markdown-workflow.ts";
import {
  buildMarkdownStyleMappings,
  DEFAULT_MARKDOWN_SETTINGS,
} from "../apps/addin/src/markdown-settings.ts";
import {
  buildSandboxedPreview,
  generateHtmlApp,
  loadHtmlLibrary,
  normalizeHtmlDocument,
  saveHtmlLibrary,
} from "../apps/addin/src/html-workflow.ts";
import type { RuntimeClient } from "../apps/addin/src/runtime-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Format workflow smoke failed: ${message}`);
}

const parsed = parseStructuredTable('```json\n{"headers":["事项","期限"],"rows":[["交付","周五"],["验收"]]}\n```');
assert(parsed.headers.length === 2, "table headers were not parsed");
assert(parsed.rows[1][1] === "", "short table rows must be padded");

for (const invalid of [
  "not json",
  '{"headers":[],"rows":[]}',
  '{"headers":[""],"rows":[]}',
  '{"headers":["A"],"rows":"bad"}',
]) {
  let rejected = false;
  try { parseStructuredTable(invalid); } catch { rejected = true; }
  assert(rejected, `invalid table response was accepted: ${invalid}`);
}

let capturedPrompt = "";
const runtime = {
  async chat(messages: Array<{ role: string; content: string }>) {
    capturedPrompt = messages.map((message) => message.content).join("\n");
    return { content: '{"headers":["A"],"rows":[["B"]]}' };
  },
} as unknown as RuntimeClient;
const generated = await generateStructuredTable(runtime, "source facts", "use one column");
assert(generated.rows[0][0] === "B", "generated table was not returned");
assert(capturedPrompt.includes("source facts") && capturedPrompt.includes("use one column"), "table prompt lost source or requirements");
assert(capturedPrompt.includes("Return only one JSON object"), "table prompt does not enforce structured output");

const markdown = [
  "# 标题",
  "",
  "含 **粗体**、*斜体*、`code` 和 [链接](https://example.com)。",
  "",
  "- 第一项",
  "- 第二项",
  "",
  "1. 编号一",
  "2. 编号二",
  "",
  "| 名称 | 值 |",
  "| --- | ---: |",
  "| A | 1 |",
  "",
  "```js",
  "<script>alert(1)</script>",
  "```",
].join("\n");
const html = markdownToHtml(markdown, { headings: true, tables: true, code: true });
const markdownBlocks = markdownToBlocks(markdown, { headings: true, tables: true, code: true });
assert(markdownBlocks[0]?.kind === "heading1", "Markdown heading block type was lost");
assert(markdownBlocks.some((block) => block.kind === "unorderedList"), "Markdown unordered-list block type was lost");
assert(markdownBlocks.some((block) => block.kind === "orderedList"), "Markdown ordered-list block type was lost");
for (const contract of ["<h1>", "<strong>", "<em>", "<code>", "<ul>", "<ol>", "<table>", "<pre>"]) {
  assert(html.includes(contract), `Markdown conversion lost ${contract}`);
}
const styleMappings = buildMarkdownStyleMappings({
  ...DEFAULT_MARKDOWN_SETTINGS,
  unorderedList: "Bullet Contract Style",
  orderedList: "Numbered Contract Style",
});
assert(
  !("list" in DEFAULT_MARKDOWN_SETTINGS) &&
  styleMappings.unorderedList === "Bullet Contract Style" &&
    styleMappings.orderedList === "Numbered Contract Style",
  "Markdown settings must store ordered and unordered Word style mappings independently",
);
assert(html.includes("&lt;script&gt;") && !html.includes("<script>"), "code block HTML was not escaped");
assert(
  !markdownInlineToHtml("[危险](javascript:alert(1))").includes("<a "),
  "unsafe link protocol was accepted",
);

const disabled = markdownToHtml("# 普通文本", { headings: false, tables: false, code: false });
assert(!disabled.includes("<h1>"), "disabled heading conversion was ignored");

const repoRoot = resolve(import.meta.dirname, "../..");
const adapter = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/officejs-word-adapter.ts"), "utf8");
assert(adapter.includes("async insertStructuredTable("), "Word adapter lacks structured table insertion");
assert(adapter.includes("selection.insertTable("), "table insertion must use the current selection");
assert(adapter.includes("async insertHtmlAtSelection("), "Word adapter lacks HTML insertion");
assert(adapter.includes("async insertStyledHtmlBlocksAtSelection("), "Word adapter lacks style-mapped Markdown insertion");
assert(adapter.includes("async listStyles("), "Word adapter lacks cross-platform style discovery");
assert(adapter.includes("async createParagraphStyle("), "Word adapter lacks WordApi 1.5 custom style creation");

const normalizedHtml = normalizeHtmlDocument("<main>hello</main>");
assert(normalizedHtml.includes("<!doctype html>") && normalizedHtml.includes("<main>hello</main>"), "HTML fragments were not wrapped");
const sandboxed = buildSandboxedPreview("<!doctype html><html><head></head><body><script>ok()</script></body></html>");
assert(sandboxed.includes("Content-Security-Policy"), "HTML preview lacks CSP");
assert(sandboxed.includes("connect-src 'none'") && sandboxed.includes("form-action 'none'"), "HTML preview permits network exfiltration");

let htmlPrompt = "";
const htmlRuntime = {
  async *streamChat(messages: Array<{ role: string; content: string }>) {
    htmlPrompt = messages.map((message) => message.content).join("\n");
    yield { provider: "fake", model: "fake", delta: "```html\n<!doctype html><html>", done: false };
    yield { provider: "fake", model: "fake", delta: "<body>app</body></html>\n```", done: true };
  },
} as unknown as RuntimeClient;
const generatedHtml = await generateHtmlApp(htmlRuntime, "make a calculator");
assert(generatedHtml.includes("<body>app</body>"), "HTML generation did not normalize the model response");
assert(htmlPrompt.includes("no external scripts") || htmlPrompt.includes("external scripts"), "HTML prompt does not prohibit external dependencies");

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
} as Storage;
saveHtmlLibrary(storage, [{ id: "one", name: "App", html: normalizedHtml, updatedAt: "2026-01-01T00:00:00.000Z" }]);
assert(loadHtmlLibrary(storage)[0]?.name === "App", "HTML app library did not round-trip");

console.log("Office.js table, Markdown and HTML app workflow smoke passed.");
