import assert from "node:assert/strict";

const state = new Map<string, unknown>();
const texts = ["第一段", "第二段", "第三段"];
const styles = ["标题 1", "正文", "正文"];
const formats = texts.map(() => ({ Alignment: 0, SpaceBefore: 0, SpaceAfter: 0 }));
const fonts = texts.map(() => ({} as Record<string, unknown>));
const paragraphs = {
  get Count() { return texts.length; },
  Item(index: number) {
    const range = {
      Font: fonts[index - 1],
      ParagraphFormat: formats[index - 1],
      get Style() { return styles[index - 1]; },
      set Style(value: string) { styles[index - 1] = value; },
      get Text() { return `${texts[index - 1]}\r`; },
      set Text(value: string) { texts[index - 1] = value.replace(/\r$/u, ""); },
      InsertAfter(value: string) { texts[index - 1] += value; },
      Select() { state.set("selected", index); },
    };
    return {
      get Style() { return styles[index - 1]; },
      set Style(value: string) { styles[index - 1] = value; },
      Format: formats[index - 1],
      Range: range,
    };
  },
};

function createTable(rowCount: number, columnCount: number) {
  const data = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));
  const table: any = {
    data,
    Cell(row: number, column: number) {
      if (data[row - 1]?.[column - 1] === undefined) return undefined;
      return { Range: {
        get Text() { return `${data[row - 1][column - 1]}\r\u0007`; },
        set Text(value: string) { data[row - 1][column - 1] = value; },
      } };
    },
    Rows: {
      get Count() { return data.length; },
      Add(before?: { index?: number }) {
        data.splice(before?.index ? before.index - 1 : data.length, 0, Array(columnCount).fill(""));
      },
      Item(index: number) { return { index, Range: { Font: {} } }; },
    },
    Columns: { get Count() { return columnCount; }, AutoFit() {} },
  };
  return table;
}

const tableValues = [createTable(2, 2)];
tableValues[0].data.splice(0, 2, ["A", "B"], ["1", "2"]);
const tables = {
  get Count() { return tableValues.length; },
  Item(index: number) { return tableValues[index - 1]; },
  Add(_range: unknown, rows: number, columns: number) {
    const table = createTable(rows, columns);
    tableValues.push(table);
    return table;
  },
};

const listFormat = {
  ApplyBulletDefault() { state.set("list", "bullet"); },
  ApplyNumberDefault() { state.set("list", "number"); },
};
const selection = {
  Text: "选择内容",
  Range: { Text: "选择内容", ListFormat: listFormat },
  Font: {} as Record<string, unknown>,
  TypeText(value: string) { state.set("typed", value); },
  InsertAfter(value: string) { state.set("after", value); },
  InsertBreak() { state.set("break", true); },
};
const comments: Array<{ text: string }> = [];
const styleNames = ["正文", "标题 1", "标题 2"];
const pageSetup: Record<string, unknown> = {};
const header = { Range: { Text: "" } };
const footer = { Range: { Text: "" } };
const tocItems: Array<{ Update(): void }> = [];
const document = {
  FullName: "C:\\sample.docx",
  Paragraphs: paragraphs,
  Tables: tables,
  PageSetup: pageSetup,
  Content: {
    get Text() { return texts.join("\r"); },
    get Duplicate() { return { Collapse() {} }; },
    InsertAfter(value: string) { texts.push(value); },
  },
  Comments: {
    get Count() { return comments.length; },
    Add(_range: unknown, text: string) { comments.push({ text }); },
    Item(index: number) { return { Author: "Tester", Content: comments[index - 1]?.text }; },
  },
  Bookmarks: {
    Count: 1,
    Item() { return { Name: "重点", Start: 1, End: 3, Range: { Text: "重点\r" } }; },
  },
  Styles: {
    get Count() { return styleNames.length; },
    Item(index: number) { return { NameLocal: styleNames[index - 1] }; },
    Add(name: string) { styleNames.push(name); },
  },
  Sections: {
    Count: 1,
    Item() {
      return {
        Headers: { Item() { return header; } },
        Footers: { Item() { return footer; } },
      };
    },
  },
  TablesOfContents: {
    get Count() { return tocItems.length; },
    Add() { tocItems.push({ Update() { state.set("tocUpdated", true); } }); },
    Item(index: number) { return tocItems[index - 1]; },
  },
  Range(start: number, end: number) {
    return {
      set HighlightColorIndex(value: number) {
        state.set("highlight", [...(state.get("highlight") as unknown[] ?? []), { start, end, value }]);
      },
      InsertAfter(text: string) { state.set("rangeInsert", text); },
    };
  },
};

Object.assign(globalThis, {
  window: {
    wps: { Selection: selection, ActiveDocument: document },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  },
});

const { WpsWordAdapter } = await import("../apps/addin/src/wps-word-adapter.ts");
const { OfficeJsToolRegistry } = await import("../apps/addin/src/officejs-tool-registry.ts");
const word = new WpsWordAdapter();
const registry = new OfficeJsToolRegistry(word);

assert(registry.list().some((tool) => tool.name === "table_set_cell"));
assert(registry.list().some((tool) => tool.name === "page_setup"));
assert(!registry.list().some((tool) => tool.name === "insert_image"));
await word.applyStyle(1, "标题 2");
await word.formatParagraph(1, "Centered", 6, 12);
assert.equal(styles[0], "标题 2");
assert.deepEqual(formats[0], { Alignment: 1, SpaceBefore: 6, SpaceAfter: 12 });

assert.deepEqual((await word.readTable(1)).rows, [["A", "B"], ["1", "2"]]);
await word.setTableCell(1, 2, 2, "更新");
assert.equal(tableValues[0].data[1][1], "更新");
await word.insertTableRow(1, 1);
assert.equal(tableValues[0].Rows.Count, 3);
await word.insertTable(2, 2, ["列一", "列二"]);
assert.deepEqual(tableValues[1].data[0], ["列一", "列二"]);

assert.equal((await word.readBookmarks())[0]?.name, "重点");
assert.equal((await word.getDocumentOutline())[0]?.paragraph, 1);
await word.formatList("bullet");
assert.equal(state.get("list"), "bullet");
await word.pageSetup({ marginTop: 72, orientation: "Landscape" });
assert.equal(pageSetup.TopMargin, 72);
assert.equal(pageSetup.Orientation, 1);
await word.headerFooter("header", "测试页眉");
assert.equal(header.Range.Text, "测试页眉");
await word.updateToc("insert");
await word.updateToc("update");
assert.equal(state.get("tocUpdated"), true);
await word.createParagraphStyle("自定义样式");
assert((await word.listStyles()).includes("自定义样式"));

texts.splice(0, texts.length,
  "第一条 风险事项",
  "“服务费”是指合同项下应付费用。",
  "参见第一条，另见 Section 2.1。",
);
assert.equal((await word.extractDefinitions())[0]?.term, "服务费");
assert((await word.checkCrossReferences()).some((item) => item.reference.includes("第一条")));
await word.insertClauseAfter("风险事项", "新增条款");
assert.equal(state.get("rangeInsert"), "\r新增条款");
assert.equal((await word.highlightRisk("风险")).count, 1);
await word.applyLegalFormat({ fontName: "宋体", fontSize: 12, lineSpacing: 24 });
assert.equal(fonts[0].Name, "宋体");
assert.equal(formats[0].LineSpacing, 24);

const review = await word.applyReviewSuggestionsBatch([
  {
    id: "suggestion-1",
    paragraphIndex: 1,
    originalText: "第一条 风险事项",
    suggestedText: "第一条 已处理事项",
    reason: "降低歧义",
  },
], "accept");
assert.equal(review[0]?.paragraphIndex, 1);
assert.equal(texts[0], "第一条 已处理事项");

console.log("WPS extended tool smoke tests passed.");
