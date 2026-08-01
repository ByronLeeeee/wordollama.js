import type { MarkdownConversionOptions } from "./markdown-workflow";

export interface MarkdownSettings extends MarkdownConversionOptions {
  h1: string;
  h2: string;
  h3: string;
  paragraph: string;
  codeStyle: string;
  blockquote: string;
  unorderedList: string;
  orderedList: string;
}

export const DEFAULT_MARKDOWN_SETTINGS: MarkdownSettings = {
  notePlacement: "footnote",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  paragraph: "Normal",
  codeStyle: "No Spacing",
  blockquote: "Quote",
  unorderedList: "List Paragraph",
  orderedList: "List Paragraph",
};

export function buildMarkdownStyleMappings(
  settings: MarkdownSettings,
): Record<string, string> {
  return {
    heading1: settings.h1 || DEFAULT_MARKDOWN_SETTINGS.h1,
    heading2: settings.h2 || DEFAULT_MARKDOWN_SETTINGS.h2,
    heading3: settings.h3 || DEFAULT_MARKDOWN_SETTINGS.h3,
    heading4: settings.h3 || DEFAULT_MARKDOWN_SETTINGS.h3,
    heading5: settings.h3 || DEFAULT_MARKDOWN_SETTINGS.h3,
    heading6: settings.h3 || DEFAULT_MARKDOWN_SETTINGS.h3,
    paragraph: settings.paragraph || DEFAULT_MARKDOWN_SETTINGS.paragraph,
    code: settings.codeStyle || DEFAULT_MARKDOWN_SETTINGS.codeStyle,
    blockquote: settings.blockquote || DEFAULT_MARKDOWN_SETTINGS.blockquote,
    unorderedList:
      settings.unorderedList || DEFAULT_MARKDOWN_SETTINGS.unorderedList,
    orderedList:
      settings.orderedList || DEFAULT_MARKDOWN_SETTINGS.orderedList,
  };
}
