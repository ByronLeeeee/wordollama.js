import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wpsEntry = readFileSync(
  new URL("../apps/addin/wps-public/wps-addin/index.html", import.meta.url),
  "utf8",
);
const wpsMain = readFileSync(
  new URL("../apps/addin/wps-public/wps-addin/main.js", import.meta.url),
  "utf8",
);
const wpsRibbon = readFileSync(
  new URL("../apps/addin/wps-public/wps-addin/ribbon.xml", import.meta.url),
  "utf8",
);
const taskpaneMain = readFileSync(
  new URL("../apps/addin/src/main.ts", import.meta.url),
  "utf8",
);
const taskpaneStyles = readFileSync(
  new URL("../apps/addin/src/styles.css", import.meta.url),
  "utf8",
);
assert.match(wpsEntry, /src="\.\/main\.js"/u);
assert.match(wpsMain, /\/wps\.html\?surface=/u);
assert.match(wpsMain, /Application\.ShowDialog/u);
assert.match(wpsMain, /settings\.html\?wpsDialog=1/u);
assert.doesNotMatch(wpsMain, /settings\.html\?wpsTaskpane=1/u);
assert.match(wpsMain, /return "assets\/ribbon\/"/u);
assert.match(taskpaneMain, /dataset\.host = "wps"/u);
assert.match(taskpaneStyles, /:root\[data-host="wps"\] \.agent-shell[\s\S]*padding-top: 124px/u);
for (const action of wpsRibbon.matchAll(/onAction="([^"]+)"/gu)) {
  assert.match(wpsMain, new RegExp(`(?:function ${action[1]}\\b|${action[1]}:)`, "u"));
}

const values = new Map<string, string>();
const paragraphValues = ["第一段", "第二段包含关键字", "第三段"];
const paragraphs = {
  get Count() { return paragraphValues.length; },
  Item(index: number) {
    return {
      Range: {
        get Text() { return `${paragraphValues[index - 1]}\r`; },
        set Text(value: string) { paragraphValues[index - 1] = value.replace(/\r$/u, ""); },
        InsertAfter(value: string) { paragraphValues[index - 1] += value; },
        Select() { values.set("selected", String(index)); },
      },
    };
  },
};

const selection = {
  Text: "用户选区",
  Range: {},
  InsertAfter(value: string) { values.set("selectionAfter", value); },
  TypeText(value: string) { values.set("typed", value); },
  InsertBreak() { values.set("break", "page"); },
  Font: {},
};

const comments: Array<{ range: unknown; text: string }> = [];
const application = {
  Selection: selection,
  ActiveDocument: {
    FullName: "C:\\docs\\sample.docx",
    Paragraphs: paragraphs,
    Content: {
      get Text() { return paragraphValues.join("\r"); },
      InsertAfter(value: string) { paragraphValues.push(value); },
    },
    Comments: {
      get Count() { return comments.length; },
      Add(range: unknown, text: string) { comments.push({ range, text }); },
      Item(index: number) { return { Author: "Tester", Content: comments[index - 1]?.text }; },
    },
  },
};

Object.assign(globalThis, {
  window: {
    wps: application,
    localStorage: {
      getItem(key: string) { return values.get(key) ?? null; },
      setItem(key: string, value: string) { values.set(key, value); },
      removeItem(key: string) { values.delete(key); },
    },
  },
});

const { isWpsHost } = await import("../apps/addin/src/wps-host.ts");
const { WpsWordAdapter } = await import("../apps/addin/src/wps-word-adapter.ts");

assert.equal(isWpsHost(), true);
const word = new WpsWordAdapter();
assert.equal(word.supportsTool("get_selection"), true);
assert.equal(word.supportsTool("revisions"), true);
assert.deepEqual(await word.getSelection(), {
  text: "用户选区",
  documentUrl: "C:\\docs\\sample.docx",
});
assert.equal((await word.getDocumentOverview()).paragraphCount, 3);
assert.deepEqual((await word.readParagraphs(2, 3)).paragraphs, ["第二段包含关键字", "第三段"]);
assert.equal((await word.searchText("关键字")).locations[0]?.paragraph, 2);

await word.replaceParagraph(1, "已替换");
assert.equal(paragraphValues[0], "已替换");
await word.insertAfterParagraph(2, "（补充）");
assert.equal(paragraphValues[1], "第二段包含关键字（补充）");
await word.insertAtCursor("光标文本");
assert.equal(values.get("typed"), "光标文本");
await word.addComment("批注意见");
assert.equal(comments[0]?.text, "批注意见");

console.log("WPS host adapter smoke tests passed.");
