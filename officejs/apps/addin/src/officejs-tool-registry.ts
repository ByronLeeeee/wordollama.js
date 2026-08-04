import { OfficeJsWordAdapter } from "./officejs-word-adapter.ts";
import type { OfficeToolDescriptor } from "./contracts";
import i18n from "./i18n.ts";

type ToolArguments = Record<string, unknown>;

const descriptors: OfficeToolDescriptor[] = [
  {
    name: "get_selection",
    description: "get_selection",
    isWriteOperation: false,
    parameterSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_text",
    description: "search_text",
    isWriteOperation: false,
    parameterSchema: {
      type: "object",
      properties: { keyword: { type: "string" } },
      required: ["keyword"],
    },
  },
  {
    name: "get_doc_overview",
    description: "get_doc_overview",
    isWriteOperation: false,
    parameterSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "insert_text_at_end",
    description: "insert_text_at_end",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "read_paragraphs",
    description: "read_paragraphs",
    isWriteOperation: false,
    parameterSchema: {
      type: "object",
      properties: { start: { type: "integer" }, end: { type: "integer" } },
      required: ["start", "end"],
    },
  },
  {
    name: "read_large_chunk",
    description: "read_large_chunk",
    isWriteOperation: false,
    parameterSchema: {
      type: "object",
      properties: { start_paragraph: { type: "integer" } },
      required: ["start_paragraph"],
    },
  },
  {
    name: "build_semantic_map",
    description: "build_semantic_map",
    isWriteOperation: false,
    parameterSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_comments",
    description: "read_comments",
    isWriteOperation: false,
    parameterSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_bookmarks",
    description: "read_bookmarks",
    isWriteOperation: false,
    parameterSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "apply_style",
    description: "apply_style",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { paragraph_index: { type: "integer" }, style_name: { type: "string" } },
      required: ["paragraph_index", "style_name"],
    },
  },
  {
    name: "replace_paragraph",
    description: "replace_paragraph",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { paragraph_index: { type: "integer" }, new_text: { type: "string" } },
      required: ["paragraph_index", "new_text"],
    },
  },
  {
    name: "insert_at_cursor",
    description: "insert_at_cursor",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "add_comment",
    description: "add_comment",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "find_replace",
    description: "find_replace",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { find: { type: "string" }, replace: { type: "string" } },
      required: ["find", "replace"],
    },
  },
  {
    name: "format_paragraph",
    description: "format_paragraph",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: {
        paragraph_index: { type: "integer" },
        alignment: { type: "string", enum: ["Left", "Centered", "Right", "Justified"] },
        space_before: { type: "number" },
        space_after: { type: "number" },
      },
      required: ["paragraph_index"],
    },
  },
  {
    name: "format_text",
    description: "format_text",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: {
        bold: { type: "boolean" },
        italic: { type: "boolean" },
        underline: { type: "boolean" },
        font_name: { type: "string" },
        font_size: { type: "number" },
        color: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "insert_page_break",
    description: "insert_page_break",
    isWriteOperation: true,
    parameterSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_table",
    description: "read_table",
    isWriteOperation: false,
    parameterSchema: {
      type: "object",
      properties: { table_index: { type: "integer" } },
      required: ["table_index"],
    },
  },
  {
    name: "insert_table",
    description: "insert_table",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: {
        rows: { type: "integer" },
        columns: { type: "integer" },
        header_row: { type: "array", items: { type: "string" } },
      },
      required: ["rows", "columns"],
    },
  },
  {
    name: "table_insert_row",
    description: "table_insert_row",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { table_index: { type: "integer" }, after_row: { type: "integer" } },
      required: ["table_index"],
    },
  },
  {
    name: "table_set_cell",
    description: "table_set_cell",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: {
        table_index: { type: "integer" },
        row: { type: "integer" },
        column: { type: "integer" },
        text: { type: "string" },
      },
      required: ["table_index", "row", "column", "text"],
    },
  },
  {
    name: "get_document_outline",
    description: "get_document_outline",
    isWriteOperation: false,
    parameterSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_clause",
    description: "read_clause",
    isWriteOperation: false,
    parameterSchema: {
      type: "object",
      properties: { keyword: { type: "string" } },
      required: ["keyword"],
    },
  },
  {
    name: "extract_definitions",
    description: "extract_definitions",
    isWriteOperation: false,
    parameterSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "check_cross_references",
    description: "check_cross_references",
    isWriteOperation: false,
    parameterSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "insert_clause_after",
    description: "insert_clause_after",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { anchor: { type: "string" }, text: { type: "string" } },
      required: ["anchor", "text"],
    },
  },
  {
    name: "highlight_risk",
    description: "highlight_risk",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { keyword: { type: "string" }, color: { type: "string" } },
      required: ["keyword"],
    },
  },
  {
    name: "apply_legal_format",
    description: "apply_legal_format",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { font_name: { type: "string" }, font_size: { type: "number" }, line_spacing: { type: "number" } },
      required: [],
    },
  },
  {
    name: "validate_citation",
    description: "validate_citation",
    isWriteOperation: false,
    parameterSchema: {
      type: "object",
      properties: { citation: { type: "string" } },
      required: ["citation"],
    },
  },
  {
    name: "insert_image",
    description: "insert_image",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { base64: { type: "string" }, alt_text: { type: "string" } },
      required: ["base64"],
    },
  },
  {
    name: "format_list",
    description: "format_list",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { list_type: { type: "string", enum: ["bullet", "number"] } },
      required: ["list_type"],
    },
  },
  {
    name: "page_setup",
    description: "page_setup",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: {
        margin_top: { type: "number" },
        margin_bottom: { type: "number" },
        margin_left: { type: "number" },
        margin_right: { type: "number" },
        orientation: { type: "string", enum: ["Portrait", "Landscape"] },
      },
      required: [],
    },
  },
  {
    name: "header_footer",
    description: "header_footer",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { element: { type: "string", enum: ["header", "footer"] }, text: { type: "string" } },
      required: ["element", "text"],
    },
  },
  {
    name: "update_toc",
    description: "update_toc",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["update", "insert"] } },
      required: ["action"],
    },
  },
  {
    name: "replace_exact_text",
    description: "replace_exact_text",
    isWriteOperation: true,
    parameterSchema: {
      type: "object",
      properties: { find: { type: "string" }, replace: { type: "string" } },
      required: ["find", "replace"],
    },
  },
  {
    name: "ask_human",
    description: "ask_human",
    isWriteOperation: false,
    parameterSchema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
];

export class OfficeJsToolRegistry {
  private readonly word: OfficeJsWordAdapter;

  constructor(word: OfficeJsWordAdapter) {
    this.word = word;
  }

  list(): OfficeToolDescriptor[] {
    return descriptors.filter((descriptor) => this.word.supportsTool(descriptor.name)).map((descriptor) => ({
      ...descriptor,
      description: i18n.t(`taskpane.toolDescriptions.${descriptor.description}`),
      // Tool schemas are JSON values. A JSON clone keeps WPS WebViews that do
      // not yet expose structuredClone from failing during task-pane startup.
      parameterSchema: JSON.parse(JSON.stringify(descriptor.parameterSchema)) as Record<string, unknown>,
    }));
  }

  async execute(name: string, args: ToolArguments = {}): Promise<unknown> {
    if (!this.word.supportsTool(name)) {
      throw new Error(i18n.t("taskpane.wordAdapter.errors.toolUnsupported", { name }));
    }
    switch (name) {
      case "get_selection":
        return this.word.getSelection();
      case "search_text":
        return this.word.searchText(this.requireString(args, "keyword"));
      case "get_doc_overview":
        return this.word.getDocumentOverview();
      case "insert_text_at_end":
        await this.word.insertTextAtEnd(this.requireString(args, "text"));
        return { inserted: true };
      case "read_paragraphs":
        return this.word.readParagraphs(this.requireInt(args, "start"), this.requireInt(args, "end"));
      case "read_large_chunk":
        return this.word.readLargeChunk(this.requireInt(args, "start_paragraph"));
      case "build_semantic_map":
        return this.word.buildSemanticMap();
      case "read_comments":
        return this.word.readComments();
      case "read_bookmarks":
        return this.word.readBookmarks();
      case "apply_style":
        await this.word.applyStyle(this.requireInt(args, "paragraph_index"), this.requireString(args, "style_name"));
        return { applied: true };
      case "replace_paragraph":
        await this.word.replaceParagraph(this.requireInt(args, "paragraph_index"), this.requireString(args, "new_text"));
        return { replaced: true };
      case "insert_at_cursor":
        await this.word.insertAtCursor(this.requireString(args, "text"));
        return { inserted: true };
      case "add_comment":
        await this.word.addComment(this.requireString(args, "text"));
        return { added: true };
      case "find_replace":
        return this.word.findReplace(this.requireString(args, "find"), this.requireString(args, "replace"));
      case "format_paragraph":
        await this.word.formatParagraph(
          this.requireInt(args, "paragraph_index"),
          this.optionalString(args, "alignment"),
          this.optionalNumber(args, "space_before"),
          this.optionalNumber(args, "space_after"),
        );
        return { formatted: true };
      case "format_text":
        await this.word.formatText({
          bold: this.optionalBoolean(args, "bold"),
          italic: this.optionalBoolean(args, "italic"),
          underline: this.optionalBoolean(args, "underline"),
          fontName: this.optionalString(args, "font_name"),
          fontSize: this.optionalNumber(args, "font_size"),
          color: this.optionalString(args, "color"),
        });
        return { formatted: true };
      case "insert_page_break":
        await this.word.insertPageBreak();
        return { inserted: true };
      case "read_table":
        return this.word.readTable(this.requireInt(args, "table_index"));
      case "insert_table":
        await this.word.insertTable(
          this.requireInt(args, "rows"),
          this.requireInt(args, "columns"),
          this.optionalStringArray(args, "header_row"),
        );
        return { inserted: true };
      case "table_insert_row":
        await this.word.insertTableRow(
          this.requireInt(args, "table_index"),
          this.optionalInt(args, "after_row"),
        );
        return { inserted: true };
      case "table_set_cell":
        await this.word.setTableCell(
          this.requireInt(args, "table_index"),
          this.requireInt(args, "row"),
          this.requireInt(args, "column"),
          this.requireString(args, "text"),
        );
        return { updated: true };
      case "get_document_outline":
        return this.word.getDocumentOutline();
      case "read_clause":
        return this.word.readClause(this.requireString(args, "keyword"));
      case "extract_definitions":
        return this.word.extractDefinitions();
      case "check_cross_references":
        return this.word.checkCrossReferences();
      case "insert_clause_after":
        await this.word.insertClauseAfter(this.requireString(args, "anchor"), this.requireString(args, "text"));
        return { inserted: true };
      case "highlight_risk":
        return this.word.highlightRisk(this.requireString(args, "keyword"), this.optionalString(args, "color"));
      case "apply_legal_format":
        await this.word.applyLegalFormat({
          fontName: this.optionalString(args, "font_name"),
          fontSize: this.optionalNumber(args, "font_size"),
          lineSpacing: this.optionalNumber(args, "line_spacing"),
        });
        return { formatted: true };
      case "validate_citation":
        return this.word.validateCitation(this.requireString(args, "citation"));
      case "insert_image":
        await this.word.insertImage(this.requireString(args, "base64"), this.optionalString(args, "alt_text"));
        return { inserted: true };
      case "format_list":
        await this.word.formatList(this.requireString(args, "list_type"));
        return { formatted: true };
      case "page_setup":
        await this.word.pageSetup({
          marginTop: this.optionalNumber(args, "margin_top"),
          marginBottom: this.optionalNumber(args, "margin_bottom"),
          marginLeft: this.optionalNumber(args, "margin_left"),
          marginRight: this.optionalNumber(args, "margin_right"),
          orientation: this.optionalString(args, "orientation"),
        });
        return { updated: true };
      case "header_footer":
        await this.word.headerFooter(this.requireString(args, "element"), this.requireString(args, "text"));
        return { updated: true };
      case "update_toc":
        return this.word.updateToc(this.requireString(args, "action"));
      case "replace_exact_text":
        return this.word.findReplace(this.requireString(args, "find"), this.requireString(args, "replace"));
      case "ask_human":
        return this.word.askHuman(this.requireString(args, "question"));
      default:
        throw new Error(`Office.js tool is not registered: ${name}`);
    }
  }

  private requireString(args: ToolArguments, name: string): string {
    const value = args[name];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${name} is required`);
    }
    return value;
  }

  private requireInt(args: ToolArguments, name: string): number {
    const value = args[name];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`${name} must be an integer`);
    }
    return value;
  }

  private optionalString(args: ToolArguments, name: string): string | undefined {
    const value = args[name];
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  private optionalNumber(args: ToolArguments, name: string): number | undefined {
    const value = args[name];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  private optionalBoolean(args: ToolArguments, name: string): boolean | undefined {
    const value = args[name];
    return typeof value === "boolean" ? value : undefined;
  }

  private optionalInt(args: ToolArguments, name: string): number | undefined {
    const value = args[name];
    return typeof value === "number" && Number.isInteger(value) ? value : undefined;
  }

  private optionalStringArray(args: ToolArguments, name: string): string[] | undefined {
    const value = args[name];
    return Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value as string[]
      : undefined;
  }
}
