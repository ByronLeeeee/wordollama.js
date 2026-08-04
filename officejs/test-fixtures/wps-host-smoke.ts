import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

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
const viteConfig = readFileSync(
  new URL("../apps/addin/vite.config.ts", import.meta.url),
  "utf8",
);
const windowsInstaller = readFileSync(
  new URL("../../src/WordOllama.WindowsInstaller/Program.cs", import.meta.url),
  "utf8",
);
const desktopBridge = readFileSync(
  new URL("../../src/WordOllama.DesktopBridge/Program.cs", import.meta.url),
  "utf8",
);
assert.match(wpsEntry, /src="\.\/main\.js"/u);
assert.match(wpsMain, /\/wps\.html\?surface=/u);
assert.match(wpsMain, /application\.ShowDialog/u);
assert.match(wpsMain, /application\.GetTaskPane\(wordOllamaTaskPaneId\)/u);
assert.doesNotMatch(wpsMain, /var wordOllamaTaskPane =/u);
assert.match(wpsMain, /settings\.html\?wpsDialog=1/u);
assert.doesNotMatch(wpsMain, /settings\.html\?wpsTaskpane=1/u);
assert.match(wpsMain, /return "assets\/ribbon\/wps\/"/u);
assert.doesNotMatch(wpsRibbon, /(?:JS调试器|debugger|devtools)/iu);
assert.doesNotMatch(
  windowsInstaller,
  /new XAttribute\("debug",\s*""\)/u,
  "production WPS registration must not enable WPS's injected JS debugger",
);
assert.doesNotMatch(
  windowsInstaller,
  /start-bridge[\s\S]*--repair-wps-registration/u,
  "login startup must not overwrite the user's persistent WPS add-in state",
);
assert.match(
  desktopBridge,
  /OnPrepareResponse[\s\S]*Headers\.CacheControl = "no-store"/u,
  "WPS static assets must not survive an installed-version change in Chromium cache",
);
assert.match(taskpaneMain, /dataset\.host = "wps"/u);
assert.match(taskpaneStyles, /:root\[data-host="wps"\] \.agent-shell[\s\S]*padding-top: 0/u);
assert.match(taskpaneStyles, /DaisyUI 5[\s\S]*:root\[data-host="wps"\] \.btn-primary/u);
assert.match(taskpaneStyles, /:root\[data-host="wps"\] \.input[\s\S]*border: 1px solid var\(--border-strong\)/u);
assert.match(viteConfig, /target:\s*"chrome104"/u);
assert.match(viteConfig, /cssTarget:\s*"chrome104"/u);
for (const action of wpsRibbon.matchAll(/onAction="([^"]+)"/gu)) {
  assert.match(wpsMain, new RegExp(`(?:function ${action[1]}\\b|${action[1]}:)`, "u"));
}

let createCount = 0;
let getCount = 0;
const navigated: string[] = [];
const paneState = { visible: false };
const makePaneProxy = () => ({
  ID: 17,
  get Visible() { return paneState.visible; },
  set Visible(value: boolean) { paneState.visible = value; },
  Navigate(url: string) { navigated.push(url); },
});
const ribbonWindow = {
  location: { protocol: "https:", host: "localhost:37421" },
} as Record<string, unknown>;
runInNewContext(wpsMain, {
  window: ribbonWindow,
  Application: {
    CreateTaskPane() { createCount += 1; return makePaneProxy(); },
    GetTaskPane(id: number) { getCount += 1; assert.equal(id, 17); return makePaneProxy(); },
    ShowDialog() { return true; },
  },
  encodeURIComponent,
  Boolean,
  Object,
});
(ribbonWindow.OpenWordOllamaWriting as () => boolean)();
paneState.visible = false;
(ribbonWindow.OpenWordOllamaTranslate as () => boolean)();
assert.equal(createCount, 1, "WPS Ribbon must reuse one task pane by ID");
assert.equal(getCount, 1, "WPS Ribbon must reacquire a fresh task-pane proxy for later callbacks");
assert.equal(paneState.visible, true, "reacquired WPS task pane must become visible");
assert.equal(navigated.length, 1, "reacquired WPS task pane must navigate to the requested workflow");

let recoveredCreateCount = 0;
const faultWindow = {
  location: { protocol: "https:", host: "localhost:37421" },
} as Record<string, unknown>;
runInNewContext(wpsMain, {
  window: faultWindow,
  Application: {
    CreateTaskPane() {
      recoveredCreateCount += 1;
      return { ID: 31, Visible: false, Navigate() { throw new Error("stale native proxy"); } };
    },
    GetTaskPane() {
      return { ID: 31, Visible: false, Navigate() { throw new Error("stale native proxy"); } };
    },
    ShowDialog() { throw new Error("dialog unavailable"); },
  },
  encodeURIComponent,
  Boolean,
  Object,
});
assert.equal((faultWindow.OpenWordOllamaWriting as () => boolean)(), true);
assert.equal(
  (faultWindow.OpenWordOllamaTranslate as () => boolean)(),
  false,
  "a native task-pane exception must be isolated from the WPS Ribbon callback",
);
assert.equal(
  (faultWindow.OpenWordOllamaTranslate as () => boolean)(),
  true,
  "the next Ribbon action must recreate the task pane after a stale proxy",
);
assert.equal(recoveredCreateCount, 2);
assert.equal(
  (faultWindow.OpenWordOllamaSettings as () => boolean)(),
  false,
  "a WPS dialog exception must not escape through the Ribbon callback",
);

const values = new Map<string, string>();
const paragraphValues = ["第一段", "第二段包含关键字", "第三段"];
let paragraphItemReads = 0;
const paragraphs = {
  get Count() { return paragraphValues.length; },
  Item(index: number) {
    paragraphItemReads += 1;
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
const activeWpsApplication = window.wps;
window.wps = { CreateTaskPane() { return {}; } };
assert.equal(isWpsHost(), true, "WPS must be detected before ActiveDocument is ready");
window.wps = activeWpsApplication;
const word = new WpsWordAdapter();
assert.equal(word.supportsTool("get_selection"), true);
assert.equal(word.supportsTool("revisions"), true);
assert.deepEqual(await word.getSelection(), {
  text: "用户选区",
  documentUrl: "C:\\docs\\sample.docx",
});
assert.equal((await word.getDocumentOverview()).paragraphCount, 3);
assert.equal(paragraphItemReads, 0, "bulk WPS document reads must avoid one native call per paragraph");
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
