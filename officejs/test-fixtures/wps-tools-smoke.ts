import assert from "node:assert/strict";

const state = new Map<string, unknown>();
const temporaryFiles = new Map<string, string>();
let insertedDocumentText = "";
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
      InsertAfter(value: string) {
        if (value.endsWith("\r")) texts.splice(index, 0, value.slice(0, -1));
        else texts[index - 1] += value;
      },
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
    Shading: {},
    Borders: {},
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
      Item(index: number) { return {
        index,
        Range: { Font: {} },
        Delete() { data.splice(index - 1, 1); },
      }; },
    },
    Columns: {
      get Count() { return data[0]?.length ?? 0; },
      Add(before?: { index?: number }) {
        const insertAt = before?.index ? before.index - 1 : (data[0]?.length ?? 0);
        for (const row of data) row.splice(insertAt, 0, "");
      },
      Item(index: number) { return {
        index,
        Delete() { for (const row of data) row.splice(index - 1, 1); },
      }; },
      AutoFit() {},
    },
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
  Type: 2,
  Text: "选择内容",
  Range: {
    Text: "选择内容",
    ListFormat: listFormat,
    InsertFile(path: string) {
      const html = temporaryFiles.get(path) ?? "";
      state.set("insertedHtml", html);
      insertedDocumentText = html.replace(/<[^>]+>/gu, "");
    },
  },
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
let tocAddArguments: unknown[] = [];
let undoRecording = false;
const makeSearchRange = () => {
  let text = "";
  const range: any = {
    get Text() { return text; },
    set Text(value: string) { text = value; },
    Collapse() { state.set("noteCollapsed", true); },
    Paragraphs: {
      Item() {
        return { Range: {
          set Style(value: string) { state.set("importedStyle", value); },
        } };
      },
    },
  };
  range.Find = {
    Execute(keyword: string) {
      if (!insertedDocumentText.includes(keyword)) return false;
      text = keyword;
      return true;
    },
  };
  return range;
};
const document = {
  FullName: "C:\\sample.docx",
  get WordOpenXML() { return JSON.stringify({ texts, tables: tableValues.map((table) => table.data) }); },
  Undo(times: number) { state.set("undoTimes", times); return true; },
  TrackRevisions: false,
  Paragraphs: paragraphs,
  Tables: tables,
  PageSetup: pageSetup,
  Content: {
    get Text() { return texts.join("\r"); },
    get Duplicate() { return makeSearchRange(); },
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
    Add(...args: unknown[]) {
      tocAddArguments = args;
      tocItems.push({ Update() { state.set("tocUpdated", true); } });
    },
    Item(index: number) { return tocItems[index - 1]; },
  },
  InlineShapes: {
    AddPicture(path: string) {
      state.set("insertedImage", temporaryFiles.get(path));
      return { AlternativeText: "" };
    },
  },
  Footnotes: {
    Add(_range: unknown, _reference: unknown, text: string) { state.set("footnote", text); },
  },
  Endnotes: {
    Add(_range: unknown, _reference: unknown, text: string) { state.set("endnote", text); },
  },
  Revisions: {
    Count: 1,
    Item() {
      return {
        Type: 1,
        Author: "Tester",
        Date: new Date("2026-08-04T00:00:00.000Z"),
        FormatDescription: "",
        Range: { Text: "修订文本\r", Select() { state.set("revisionSelected", true); } },
        Accept() { state.set("revisionAccepted", true); },
        Reject() { state.set("revisionRejected", true); },
      };
    },
    AcceptAll() { state.set("allRevisionsAccepted", true); },
    RejectAll() { state.set("allRevisionsRejected", true); },
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
    atob(value: string) { return Buffer.from(value, "base64").toString("binary"); },
    wps: {
      Selection: selection,
      ActiveDocument: document,
      Env: { GetTempPath() { return "C:\\temp\\"; } },
      FileSystem: {
        writeFileString(path: string, value: string) { temporaryFiles.set(path, value); },
        writeAsBinaryString(path: string, value: string) { temporaryFiles.set(path, value); },
        Remove(path: string) { temporaryFiles.delete(path); },
      },
      UndoRecord: {
        get IsRecordingCustomRecord() { return undoRecording; },
        get CustomRecordLevel() { return undoRecording ? 1 : 0; },
        StartCustomRecord(name: string) { undoRecording = true; state.set("undoName", name); },
        EndCustomRecord() { undoRecording = false; state.set("undoEnded", true); },
      },
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  },
});

const { WpsWordAdapter } = await import("../apps/addin/src/wps-word-adapter.ts");
const { OfficeJsToolRegistry } = await import("../apps/addin/src/officejs-tool-registry.ts");
const word = new WpsWordAdapter();
const registry = new OfficeJsToolRegistry(word);

assert(registry.list().some((tool) => tool.name === "table_set_cell"));
assert(registry.list().some((tool) => tool.name === "page_setup"));
assert(registry.list().some((tool) => tool.name === "insert_image"));
assert.equal(word.supportsTool("revisions"), true);
await word.applyStyle(1, "标题 2");
await word.formatParagraph(1, "Centered", 6, 12);
assert.equal(styles[0], "标题 2");
assert.deepEqual(formats[0], { Alignment: 1, SpaceBefore: 6, SpaceAfter: 12 });

assert.deepEqual((await word.readTable(1)).rows, [["A", "B"], ["1", "2"]]);
await word.setTableCell(1, 2, 2, "更新");
assert.equal(tableValues[0].data[1][1], "更新");
await word.insertTableRow(1, 1);
assert.equal(tableValues[0].Rows.Count, 3);
await word.editTableStructure(1, "insert_row", { row: tableValues[0].Rows.Count });
assert.equal(tableValues[0].Rows.Count, 4, "inserting after the final row must not request row Count + 1");
await word.editTableStructure(1, "insert_column", { column: tableValues[0].Columns.Count });
assert.equal(tableValues[0].Columns.Count, 3, "inserting after the final column must not request column Count + 1");
await word.insertTable(2, 2, ["列一", "列二"]);
assert.deepEqual(tableValues[1].data[0], ["列一", "列二"]);
await word.formatTable(1, {
  shadingColor: "#123456",
  borderColor: "rgb(255, 0, 0)",
  borderWidth: 1,
});
assert.equal(tableValues[0].Shading.BackgroundPatternColor, 0x563412);
assert.equal(tableValues[0].Borders.OutsideColor, 0x0000ff);
assert.equal(tableValues[0].Borders.InsideColor, 0x0000ff);
assert.equal(tableValues[0].Borders.OutsideLineWidth, 8);
assert.equal(tableValues[0].Borders.InsideLineWidth, 8);

assert.equal((await word.readBookmarks())[0]?.name, "重点");
assert.equal((await word.getDocumentOutline())[0]?.paragraph, 1);
await word.formatList("bullet");
assert.equal(state.get("list"), "bullet");
await word.pageSetup({ marginTop: 72, orientation: "Landscape" });
assert.equal(pageSetup.TopMargin, 72);
assert.equal(pageSetup.Orientation, 1);
await word.headerFooter("header", "测试页眉");
assert.equal(header.Range.Text, "测试页眉");
await word.updateToc("insert", {
  upperHeadingLevel: 2,
  lowerHeadingLevel: 5,
  includePageNumbers: false,
  rightAlignPageNumbers: false,
  useHyperlinks: true,
});
assert.deepEqual(tocAddArguments.slice(1, 10), [true, 2, 5, false, undefined, false, false, undefined, true]);
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
const insertedReview = await word.applyReviewSuggestionsBatch([{
  id: "suggestion-2",
  paragraphIndex: 2,
  originalText: "“服务费”是指合同项下应付费用。",
  suggestedText: "补充说明",
  reason: "补充",
}], "insert");
assert.equal(insertedReview[0]?.paragraphIndex, 2);
assert.deepEqual(texts.slice(1, 4), [
  "“服务费”是指合同项下应付费用。",
  "补充说明",
  "参见第一条，另见 Section 2.1。",
]);

await word.insertHtmlAtSelection("<strong>共用 Word UI</strong>");
assert.match(String(state.get("insertedHtml")), /<strong>共用 Word UI<\/strong>/u);
await word.insertStyledHtmlBlocksAtSelection([{
  kind: "heading1",
  html: "<h1>原生标题[[WORDOLLAMA_NOTE_TEST]]</h1>",
  notes: [{ marker: "[[WORDOLLAMA_NOTE_TEST]]", text: "**脚注**内容" }],
}], { heading1: "标题 1" }, "footnote");
assert.match(String(state.get("insertedHtml")), /mso-style-name: '标题 1'/u);
assert.equal(state.get("importedStyle"), "标题 1");
assert.equal(state.get("footnote"), "脚注内容");
await word.insertImage("data:image/png;base64,aGVsbG8=", "图片说明");
assert.equal(state.get("insertedImage"), "hello");

const undoSnapshot = await word.captureDocumentSnapshot();
assert.match(String(undoSnapshot), /^wps-undo:/u);
texts[0] = `${texts[0]}（任务修改）`;
const finalizedUndoSnapshot = await word.finalizeDocumentSnapshot(undoSnapshot);
assert.equal(finalizedUndoSnapshot, undoSnapshot);
assert.equal(state.get("undoEnded"), true);
await word.restoreDocumentSnapshot(finalizedUndoSnapshot!);
assert.equal(state.get("undoTimes"), 1);

const previousTracking = await word.beginTrackedChanges();
assert.equal(previousTracking, "false");
assert.equal(document.TrackRevisions, true);
const revisions = await word.listTrackedRevisions();
assert.equal(revisions.total, 1);
await word.focusTrackedRevision(revisions.revisions[0].identity, 1);
await word.applyTrackedRevision(revisions.revisions[0].identity, 1, "accept");
await word.applyAllTrackedRevisions("reject");
assert.equal(state.get("revisionSelected"), true);
assert.equal(state.get("revisionAccepted"), true);
assert.equal(state.get("allRevisionsRejected"), true);
await word.restoreTrackedChanges(previousTracking);
assert.equal(document.TrackRevisions, false);

const tableChange = await word.applyCompareChangesBatch([{
  kind: "modified",
  paragraphIndex: 1,
  original: "更新",
  revised: "已更新",
  blockType: "tableCell",
  originalLocation: "table:1/row:3/cell:2/paragraph:1",
}]);
assert.equal(tableChange.length, 1);
assert.equal(tableValues[0].data[2][1], "已更新");

let preciseText = "选择旧内容";
let preciseStart = 0;
let preciseEnd = preciseText.length;
let preciseDeleteCount = 0;
let preciseInsertCount = 0;
let preciseTypeCount = 0;
Object.defineProperties(selection, {
  Text: {
    configurable: true,
    get() { return preciseText.slice(preciseStart, preciseEnd); },
  },
});
Object.defineProperties(selection.Range, {
  Start: { configurable: true, get() { return preciseStart; } },
  End: { configurable: true, get() { return preciseEnd; } },
});
(selection as any).Delete = () => {
  preciseDeleteCount += 1;
  state.set("trackedDuringDelete", document.TrackRevisions);
  preciseText = `${preciseText.slice(0, preciseStart)}${preciseText.slice(preciseEnd)}`;
  preciseEnd = preciseStart;
};
(selection as any).TypeText = (value: string) => {
  preciseTypeCount += 1;
  state.set("trackedDuringType", document.TrackRevisions);
  preciseText = `${preciseText.slice(0, preciseStart)}${value}${preciseText.slice(preciseEnd)}`;
  preciseStart += value.length;
  preciseEnd = preciseStart;
};
(document as any).Range = (start: number, end: number) => ({
  Start: start,
  End: end,
  get Text() { return preciseText.slice(start, end); },
  Select() { preciseStart = start; preciseEnd = end; },
  InsertBefore(value: string) {
    preciseInsertCount += 1;
    state.set("trackedDuringRangeInsert", document.TrackRevisions);
    preciseText = `${preciseText.slice(0, start)}${value}${preciseText.slice(start)}`;
  },
});
assert.equal(await word.applyPreciseRevision("选择旧内容", "选择新内容"), true);
assert.equal(preciseText, "选择新内容");
assert.equal(state.get("trackedDuringDelete"), true);
assert.equal(state.get("trackedDuringRangeInsert"), true);
assert.equal(preciseTypeCount, 0, "precise WPS revisions must prefer native Range insertion");
assert.equal(document.TrackRevisions, false);

preciseText = "甲乙";
preciseStart = 0;
preciseEnd = preciseText.length;
preciseDeleteCount = 0;
preciseInsertCount = 0;
assert.equal(await word.applyPreciseRevision("甲乙", "甲新增乙"), true);
assert.equal(preciseText, "甲新增乙");
assert.equal(preciseDeleteCount, 0, "a collapsed WPS insertion must not call Selection.Delete");
assert.equal(preciseInsertCount, 1, "a collapsed WPS insertion must use Range.InsertBefore");

preciseStart = 0;
preciseEnd = preciseText.length;
(selection as any).Type = 6;
await assert.rejects(
  () => word.applyPreciseRevision(preciseText, "不应直接替换"),
  /修订|revision|selection/iu,
);
assert.equal(preciseText, "甲新增乙");
(selection as any).Type = 2;

console.log("WPS extended tool smoke tests passed.");
