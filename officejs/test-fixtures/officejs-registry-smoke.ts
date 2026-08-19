import { OfficeJsToolRegistry } from "../apps/addin/src/officejs-tool-registry.ts";
import { OfficeJsWordAdapter } from "../apps/addin/src/officejs-word-adapter.ts";
import i18n from "../apps/addin/src/i18n.ts";

type AnyRecord = Record<string, unknown>;

const calls: string[] = [];
const selectionHash = "a".repeat(64);
const fakeWord = new Proxy({
  supportsTool: () => true,
} as AnyRecord, {
  get(target, property) {
    if (property in target) {
      return target[property];
    }
    return (..._args: unknown[]) => {
      calls.push(String(property));
      if (property === "getSelection") return { text: "fixture", selectionHash };
      if (property === "findReplace") return { count: 1 };
      if (property === "askHuman") return "approved";
      return undefined;
    };
  },
}) as unknown as ConstructorParameters<typeof OfficeJsToolRegistry>[0];

const registry = new OfficeJsToolRegistry(fakeWord);
await i18n.changeLanguage("en-US");
const names = registry.list().map((tool) => tool.name);
const expected = [
  "search_text",
  "select_exact_text",
  "replace_paragraph",
  "read_comments",
  "insert_table",
  "get_document_outline",
  "replace_exact_text",
  "apply_precise_revision",
  "ask_human",
];
for (const name of expected) {
  if (!names.includes(name)) throw new Error(`missing Office.js tool: ${name}`);
}
if (names.length !== 40) {
  throw new Error(`expected 40 Office.js descriptors, got ${names.length}`);
}
for (const name of [
  "insert_at_cursor",
  "add_comment",
  "format_text",
  "insert_page_break",
  "format_list",
  "apply_precise_revision",
]) {
  const schema = registry.list().find((tool) => tool.name === name)?.parameterSchema as {
    required?: string[];
    properties?: Record<string, { pattern?: string }>;
  } | undefined;
  if (!schema?.required?.includes("expected_selection_hash") ||
      schema.properties?.expected_selection_hash?.pattern !== "^[0-9a-f]{64}$") {
    throw new Error(`${name} does not require the guarded selection hash schema`);
  }
}
if (registry.list().find((tool) => tool.name === "get_selection")?.description !==
    "Read the current Word selection and return the selectionHash required by selection-based write tools.") {
  throw new Error("English Office.js tool descriptions were not localized");
}
await i18n.changeLanguage("zh-CN");
if (!registry.list().find((tool) => tool.name === "get_selection")?.description.includes("选区")) {
  throw new Error("Chinese Office.js tool descriptions were not localized");
}

const limitedWord = new Proxy({
  supportsTool: (name: string) => !["insert_image", "page_setup", "update_toc"].includes(name),
} as AnyRecord, {
  get(target, property) {
    if (property in target) return target[property];
    return (..._args: unknown[]) => undefined;
  },
}) as unknown as ConstructorParameters<typeof OfficeJsToolRegistry>[0];
const limitedNames = new OfficeJsToolRegistry(limitedWord).list().map((tool) => tool.name);
for (const unavailable of ["insert_image", "page_setup", "update_toc"]) {
  if (limitedNames.includes(unavailable)) throw new Error(`capability filter failed: ${unavailable}`);
}

const selection = await registry.execute("get_selection");
if ((selection as { text: string }).text !== "fixture") throw new Error("get_selection dispatch failed");
await registry.execute("select_exact_text", { text: "fixture" });
const replacement = await registry.execute("replace_exact_text", { find: "old", replace: "new" });
if ((replacement as { count: number }).count !== 1) throw new Error("replace_exact_text dispatch failed");
const answer = await registry.execute("ask_human", { question: "continue?" });
if (answer !== "approved") throw new Error("ask_human dispatch failed");
if (!calls.includes("getSelection") || !calls.includes("selectExactText") || !calls.includes("findReplace") || !calls.includes("askHuman")) {
  throw new Error("Office.js dispatch call trace is incomplete");
}

const dispatchArguments: Record<string, AnyRecord> = {
  select_exact_text: { text: "fixture" },
  search_text: { keyword: "term" },
  insert_text_at_end: { text: "text" },
  read_paragraphs: { start: 0, end: 1 },
  read_large_chunk: { start_paragraph: 0 },
  apply_style: { paragraph_index: 0, style_name: "Normal" },
  replace_paragraph: { paragraph_index: 0, new_text: "text" },
  insert_at_cursor: { text: "text", expected_selection_hash: selectionHash },
  add_comment: { text: "comment", expected_selection_hash: selectionHash },
  find_replace: { find: "old", replace: "new" },
  format_paragraph: { paragraph_index: 0 },
  format_text: { bold: true, expected_selection_hash: selectionHash },
  insert_page_break: { expected_selection_hash: selectionHash },
  read_table: { table_index: 0 },
  insert_table: { rows: 1, columns: 1, header_row: ["Header"] },
  table_insert_row: { table_index: 0, after_row: 0 },
  table_set_cell: { table_index: 0, row: 0, column: 0, text: "cell" },
  edit_table_structure: { table_index: 1, action: "insert_row", row: 1 },
  format_table: { table_index: 1, header_rows: 1, autofit: "window" },
  read_clause: { keyword: "clause" },
  insert_clause_after: { anchor: "anchor", text: "clause" },
  highlight_risk: { keyword: "risk" },
  validate_citation: { citation: "citation" },
  insert_image: { base64: "aGVsbG8=", alt_text: "image" },
  format_list: { list_type: "bullet", expected_selection_hash: selectionHash },
  header_footer: { element: "header", text: "header" },
  update_toc: { action: "update" },
  replace_exact_text: { find: "old", replace: "new" },
  apply_precise_revision: { original: "old", revised: "new", expected_selection_hash: selectionHash },
  ask_human: { question: "continue?" },
};
for (const descriptor of registry.list()) {
  await registry.execute(descriptor.name, dispatchArguments[descriptor.name] ?? {});
}

let exactSelectCalls = 0;
let exactFixtureTexts = ["Unique target"];
(globalThis as AnyRecord).Office = {
  context: { document: { url: "fixture.docx" } },
};
(globalThis as AnyRecord).Word = {
  RangeLocation: { start: "Start" },
  run: async (callback: (context: AnyRecord) => Promise<unknown>) => callback({
    document: {
      body: {
        search: () => ({
          items: exactFixtureTexts.map((text) => ({
            text,
            load: () => undefined,
            getRange: () => ({}),
            select: () => { exactSelectCalls += 1; },
          })),
          load: () => undefined,
        }),
        getRange: () => ({
          expandTo: () => ({ text: "", load: () => undefined }),
        }),
      },
    },
    sync: async () => undefined,
  }),
};
const exactWord = new OfficeJsWordAdapter();
const exactResult = await exactWord.selectExactText("Unique target");
if (!exactResult.selected || exactResult.matchCount !== 1 || exactSelectCalls !== 1) {
  throw new Error("unique exact selection failed");
}
exactFixtureTexts = ["Repeated", "Repeated"];
await exactWord.selectExactText("Repeated").then(
  () => { throw new Error("ambiguous exact selection must fail"); },
  () => undefined,
);
if (exactSelectCalls !== 1) throw new Error("ambiguous exact selection changed the selection");
exactFixtureTexts = [];
await exactWord.selectExactText("Missing").then(
  () => { throw new Error("missing exact selection must fail"); },
  () => undefined,
);
if (exactSelectCalls !== 1) throw new Error("missing exact selection changed the selection");

let prefixText = "before";
let insertedText = "";
const guardedSelection = {
  text: "target",
  load: () => undefined,
  getRange: () => ({}),
  insertText: (text: string) => { insertedText = text; },
};
(globalThis as AnyRecord).Word = {
  RangeLocation: { start: "Start" },
  InsertLocation: { replace: "Replace" },
  run: async (callback: (context: AnyRecord) => Promise<unknown>) => callback({
    document: {
      getSelection: () => guardedSelection,
      body: {
        getRange: () => ({
          expandTo: () => ({ get text() { return prefixText; }, load: () => undefined }),
        }),
      },
    },
    sync: async () => undefined,
  }),
};
const guardedWord = new OfficeJsWordAdapter();
const guardedSnapshot = await guardedWord.getSelection();
if (!/^[0-9a-f]{64}$/u.test(guardedSnapshot.selectionHash)) {
  throw new Error("get_selection did not return a SHA-256 selection hash");
}
prefixText = "before changed";
await guardedWord.insertAtCursor("unsafe", guardedSnapshot.selectionHash).then(
  () => { throw new Error("stale selection hash must reject the write"); },
  () => undefined,
);
if (insertedText) throw new Error("stale selection hash changed the document");
prefixText = "before";
await guardedWord.insertAtCursor("safe", guardedSnapshot.selectionHash);
if (insertedText !== "safe") throw new Error("matching selection hash did not allow the write");

console.log(`Office.js registry smoke passed (${names.length} tools).`);
