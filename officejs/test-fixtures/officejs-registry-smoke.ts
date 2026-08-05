import { OfficeJsToolRegistry } from "../apps/addin/src/officejs-tool-registry.ts";
import i18n from "../apps/addin/src/i18n.ts";

type AnyRecord = Record<string, unknown>;

const calls: string[] = [];
const fakeWord = new Proxy({
  supportsTool: () => true,
} as AnyRecord, {
  get(target, property) {
    if (property in target) {
      return target[property];
    }
    return (..._args: unknown[]) => {
      calls.push(String(property));
      if (property === "getSelection") return { text: "fixture" };
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
  "replace_paragraph",
  "read_comments",
  "insert_table",
  "get_document_outline",
  "replace_exact_text",
  "ask_human",
];
for (const name of expected) {
  if (!names.includes(name)) throw new Error(`missing Office.js tool: ${name}`);
}
if (names.length !== 38) {
  throw new Error(`expected 38 Office.js descriptors, got ${names.length}`);
}
if (registry.list().find((tool) => tool.name === "get_selection")?.description !==
    "Read text from the current Word selection.") {
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
const replacement = await registry.execute("replace_exact_text", { find: "old", replace: "new" });
if ((replacement as { count: number }).count !== 1) throw new Error("replace_exact_text dispatch failed");
const answer = await registry.execute("ask_human", { question: "continue?" });
if (answer !== "approved") throw new Error("ask_human dispatch failed");
if (!calls.includes("getSelection") || !calls.includes("findReplace") || !calls.includes("askHuman")) {
  throw new Error("Office.js dispatch call trace is incomplete");
}

const dispatchArguments: Record<string, AnyRecord> = {
  search_text: { keyword: "term" },
  insert_text_at_end: { text: "text" },
  read_paragraphs: { start: 0, end: 1 },
  read_large_chunk: { start_paragraph: 0 },
  apply_style: { paragraph_index: 0, style_name: "Normal" },
  replace_paragraph: { paragraph_index: 0, new_text: "text" },
  insert_at_cursor: { text: "text" },
  add_comment: { text: "comment" },
  find_replace: { find: "old", replace: "new" },
  format_paragraph: { paragraph_index: 0 },
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
  format_list: { list_type: "bullet" },
  header_footer: { element: "header", text: "header" },
  update_toc: { action: "update" },
  replace_exact_text: { find: "old", replace: "new" },
  ask_human: { question: "continue?" },
};
for (const descriptor of registry.list()) {
  await registry.execute(descriptor.name, dispatchArguments[descriptor.name] ?? {});
}

console.log(`Office.js registry smoke passed (${names.length} tools).`);
