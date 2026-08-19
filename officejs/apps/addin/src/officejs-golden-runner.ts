import type { OfficeToolDescriptor, ReleaseTestIdentity } from "./contracts";

type ToolArguments = Record<string, unknown>;

export type GoldenStatus = "passed" | "failed" | "unsupported" | "blocked";

export interface GoldenCase {
  name: string;
  args?: ToolArguments;
  selectText?: string;
}

export interface GoldenResult {
  name: string;
  status: GoldenStatus;
  durationMs: number;
  error?: string;
}

export interface GoldenReport {
  schemaVersion: 1;
  startedAt: string;
  finishedAt: string;
  release?: ReleaseTestIdentity;
  host: Record<string, string>;
  supportedToolCount: number;
  passed: number;
  failed: number;
  unsupported: number;
  blocked: number;
  results: GoldenResult[];
}

export interface GoldenRegistry {
  list(): OfficeToolDescriptor[];
  execute(name: string, args?: ToolArguments): Promise<unknown>;
}

export interface GoldenHostHarness {
  describeHost(): Record<string, string>;
  prepareDisposableFixture(): Promise<void>;
  selectText(text: string): Promise<void>;
}

export const GOLDEN_FIXTURE_MARKER = "WORDOLLAMA_GOLDEN_ANCHOR";
const SELECTION_GUARDED_TOOLS = new Set([
  "insert_at_cursor",
  "add_comment",
  "format_text",
  "insert_page_break",
  "format_list",
  "apply_precise_revision",
]);
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export const GOLDEN_CASES: GoldenCase[] = [
  { name: "get_selection", selectText: GOLDEN_FIXTURE_MARKER },
  { name: "select_exact_text", args: { text: GOLDEN_FIXTURE_MARKER } },
  { name: "search_text", args: { keyword: "合同期限" } },
  { name: "get_doc_overview" },
  { name: "insert_text_at_end", args: { text: "\nWORDOLLAMA_END_MARKER" } },
  { name: "read_paragraphs", args: { start: 1, end: 3 } },
  { name: "read_large_chunk", args: { start_paragraph: 1 } },
  { name: "build_semantic_map" },
  { name: "apply_style", args: { paragraph_index: 1, style_name: "Heading 1" } },
  { name: "replace_paragraph", args: { paragraph_index: 1, new_text: "合同期限为2026年1月1日至2026年12月31日。" } },
  { name: "insert_at_cursor", args: { text: "WORDOLLAMA_CURSOR_INSERTED" }, selectText: "WORDOLLAMA_CURSOR_TARGET" },
  { name: "find_replace", args: { find: "WORDOLLAMA_FIND_OLD", replace: "WORDOLLAMA_FIND_NEW" } },
  { name: "format_paragraph", args: { paragraph_index: 1, alignment: "Justified", space_before: 3, space_after: 3 } },
  { name: "format_text", args: { bold: true, italic: true, font_size: 11, color: "#1F4E79" }, selectText: "高风险违约责任" },
  { name: "insert_page_break", selectText: "WORDOLLAMA_PAGE_BREAK_TARGET" },
  { name: "insert_table", args: { rows: 2, columns: 2, header_row: ["项目", "内容"] } },
  { name: "read_table", args: { table_index: 1 } },
  { name: "table_insert_row", args: { table_index: 1, after_row: 1 } },
  { name: "table_set_cell", args: { table_index: 1, row: 2, column: 1, text: "金样本" } },
  { name: "edit_table_structure", args: { table_index: 1, action: "insert_column", column: 1, count: 1 } },
  { name: "format_table", args: { table_index: 1, header_rows: 1, alignment: "Centered", autofit: "window" } },
  { name: "get_document_outline" },
  { name: "read_clause", args: { keyword: "服务范围" } },
  { name: "extract_definitions" },
  { name: "check_cross_references" },
  { name: "insert_clause_after", args: { anchor: "WORDOLLAMA_CLAUSE_ANCHOR", text: "新增测试条款。" } },
  { name: "highlight_risk", args: { keyword: "高风险", color: "Yellow" } },
  { name: "apply_legal_format", args: { font_name: "Arial", font_size: 11, line_spacing: 18 } },
  { name: "validate_citation", args: { citation: "2024年示例法第1条" } },
  { name: "insert_image", args: { base64: ONE_PIXEL_PNG, alt_text: "WordOllama.JS golden pixel" } },
  { name: "format_list", args: { list_type: "bullet" }, selectText: "测试列表项目" },
  { name: "page_setup", args: { margin_top: 72, margin_bottom: 72, margin_left: 72, margin_right: 72, orientation: "Portrait" } },
  { name: "header_footer", args: { element: "header", text: "WordOllama.JS Golden Header" } },
  { name: "update_toc", args: { action: "insert" } },
  {
    name: "apply_precise_revision",
    args: { original: "WORDOLLAMA_PRECISE_OLD", revised: "WORDOLLAMA_PRECISE_NEW" },
    selectText: "WORDOLLAMA_PRECISE_OLD",
  },
  { name: "replace_exact_text", args: { find: "WORDOLLAMA_EXACT_OLD", replace: "WORDOLLAMA_EXACT_NEW" } },
  { name: "add_comment", args: { text: "WordOllama.JS golden comment" }, selectText: "合同期限" },
  { name: "read_comments" },
  { name: "read_bookmarks" },
  { name: "ask_human", args: { question: "WordOllama.JS 金样本：请选择确定或取消，二者都会记录为调用成功。" } },
];

export class OfficeGoldenHostHarness implements GoldenHostHarness {
  describeHost(): Record<string, string> {
    return {
      host: String(Office.context?.host ?? "unknown"),
      platform: String(Office.context?.platform ?? "unknown"),
      version: String(Office.context?.diagnostics?.version ?? "unknown"),
      language: String(Office.context?.displayLanguage ?? "unknown"),
    };
  }

  async prepareDisposableFixture(): Promise<void> {
    const fixture = [
      GOLDEN_FIXTURE_MARKER,
      "合同期限为2026年1月1日至2026年12月31日。",
      "第一条 服务范围",
      "“服务”是指本合同项下的测试服务。",
      "根据2024年示例法第1条执行。",
      "高风险违约责任需要人工复核。",
      "WORDOLLAMA_FIND_OLD",
      "WORDOLLAMA_EXACT_OLD",
      "WORDOLLAMA_PRECISE_OLD",
      "WORDOLLAMA_CURSOR_TARGET",
      "WORDOLLAMA_PAGE_BREAK_TARGET",
      "WORDOLLAMA_CLAUSE_ANCHOR",
      "测试列表项目",
    ].join("\n");

    await Word.run(async (context) => {
      context.document.body.insertText(fixture, Word.InsertLocation.replace);
      await context.sync();
    });
  }

  async selectText(text: string): Promise<void> {
    await Word.run(async (context) => {
      const range = context.document.body.search(text, { matchCase: true }).getFirstOrNullObject();
      range.load("isNullObject");
      await context.sync();
      if (range.isNullObject) throw new Error(`金样本选区锚点不存在：${text}`);
      range.select();
      await context.sync();
    });
  }
}

export async function runOfficeGoldenMatrix(
  registry: GoldenRegistry,
  harness: GoldenHostHarness,
  onProgress?: (completed: number, total: number, result: GoldenResult) => void,
): Promise<GoldenReport> {
  const startedAt = new Date().toISOString();
  const supported = new Set(registry.list().map((tool) => tool.name));
  const results: GoldenResult[] = [];
  let fixtureError: string | undefined;
  try {
    await harness.prepareDisposableFixture();
  } catch (error) {
    fixtureError = error instanceof Error ? error.message : String(error);
  }

  for (const testCase of GOLDEN_CASES) {
    const started = performance.now();
    let result: GoldenResult;
    if (!supported.has(testCase.name)) {
      result = { name: testCase.name, status: "unsupported", durationMs: 0 };
    } else if (fixtureError) {
      result = { name: testCase.name, status: "blocked", durationMs: 0, error: fixtureError };
    } else {
      try {
        if (testCase.selectText) await harness.selectText(testCase.selectText);
        let args = testCase.args ?? {};
        if (SELECTION_GUARDED_TOOLS.has(testCase.name)) {
          const selection = await registry.execute("get_selection") as { selectionHash?: string };
          if (!selection.selectionHash) throw new Error("get_selection did not return selectionHash");
          args = { ...args, expected_selection_hash: selection.selectionHash };
        }
        await registry.execute(testCase.name, args);
        result = { name: testCase.name, status: "passed", durationMs: Math.round(performance.now() - started) };
      } catch (error) {
        result = {
          name: testCase.name,
          status: "failed",
          durationMs: Math.round(performance.now() - started),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    results.push(result);
    onProgress?.(results.length, GOLDEN_CASES.length, result);
  }

  const count = (status: GoldenStatus) => results.filter((result) => result.status === status).length;
  return {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    host: harness.describeHost(),
    supportedToolCount: supported.size,
    passed: count("passed"),
    failed: count("failed"),
    unsupported: count("unsupported"),
    blocked: count("blocked"),
    results,
  };
}
