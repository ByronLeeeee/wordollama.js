export interface MarkdownConversionOptions {
  notePlacement: "footnote" | "endnote";
}

export interface MarkdownHtmlOptions {
  renderFrontMatter?: boolean;
}

export type MarkdownBlockKind =
  | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6"
  | "paragraph" | "code" | "blockquote" | "unorderedList" | "orderedList" | "table";

export interface MarkdownBlock {
  kind: MarkdownBlockKind;
  html: string;
  notes?: MarkdownNoteReference[];
}

export interface MarkdownNoteReference {
  marker: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeLink(url: string): string | null {
  const trimmed = url.trim();
  return /^(?:https?:|mailto:)/i.test(trimmed) ? escapeHtml(trimmed) : null;
}

type InlineContext = {
  definitions: Map<string, string>;
  notes: MarkdownNoteReference[];
  nextMarker: () => string;
};

function renderInline(value: string, context?: InlineContext): string {
  const token = /(\[\^[^\]\n]+\]|`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]+\]\([^) \n]+\))/g;
  let html = "";
  let offset = 0;
  for (const match of value.matchAll(token)) {
    const index = match.index ?? 0;
    html += escapeHtml(value.slice(offset, index));
    const part = match[0];
    const footnote = /^\[\^([^\]]+)\]$/.exec(part);
    if (footnote && context?.definitions.has(footnote[1])) {
      const marker = context.nextMarker();
      context.notes.push({ marker, text: context.definitions.get(footnote[1]) ?? "" });
      html += escapeHtml(marker);
    }
    else if (part.startsWith("`")) html += `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    else if (part.startsWith("**")) html += `<strong>${escapeHtml(part.slice(2, -2))}</strong>`;
    else if (part.startsWith("~~")) html += `<s>${escapeHtml(part.slice(2, -2))}</s>`;
    else if (part.startsWith("*")) html += `<em>${escapeHtml(part.slice(1, -1))}</em>`;
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      const href = link ? safeLink(link[2]) : null;
      html += link && href
        ? `<a href="${href}">${escapeHtml(link[1])}</a>`
        : escapeHtml(part);
    }
    offset = index + part.length;
  }
  return html + escapeHtml(value.slice(offset));
}

export function markdownInlineToHtml(value: string): string {
  return renderInline(value);
}

function extractFootnoteDefinitions(markdown: string): {
  lines: string[];
  definitions: Map<string, string>;
} {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const definitions = new Map<string, string>();
  const content = [...lines];
  for (let index = 0; index < lines.length; index += 1) {
    const definition = /^ {0,3}\[\^([^\]]+)\]:\s*(.*)$/.exec(lines[index]);
    if (!definition) continue;
    const parts = [definition[2]];
    content[index] = "";
    while (index + 1 < lines.length) {
      const continuation = /^(?: {2,4}|\t)(\S.*)$/.exec(lines[index + 1]);
      if (!continuation) break;
      index += 1;
      parts.push(continuation[1]);
      content[index] = "";
    }
    definitions.set(definition[1], parts.join("\n").trim());
  }
  return { lines: content, definitions };
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function extractYamlFrontMatter(markdown: string): { body: string; lines: string[] } | null {
  const lines = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line.trim()));
  if (end < 0) return null;
  return {
    lines: lines.slice(1, end),
    body: lines.slice(end + 1).join("\n"),
  };
}

function renderYamlFrontMatter(lines: string[]): string {
  const rows = lines.flatMap((line) => {
    if (!line.trim() || /^\s*#/.test(line)) return [];
    const property = /^(\s*)([^:#][^:]*?):(?:\s*(.*))?$/.exec(line);
    const listItem = /^(\s*)-\s+(.+)$/.exec(line);
    if (property) {
      const depth = Math.min(4, Math.floor(property[1].replace(/\t/g, "  ").length / 2));
      const key = escapeHtml(property[2].trim());
      const value = property[3]?.trim() ?? "";
      const groupClass = value ? "" : " markdown-frontmatter-group";
      return [`<div class="markdown-frontmatter-row markdown-frontmatter-depth-${depth}${groupClass}">`
        + `<span class="markdown-frontmatter-key">${key}</span>`
        + `<span class="markdown-frontmatter-value">${escapeHtml(value)}</span></div>`];
    }
    if (listItem) {
      const depth = Math.min(4, Math.floor(listItem[1].replace(/\t/g, "  ").length / 2));
      return [`<div class="markdown-frontmatter-row markdown-frontmatter-depth-${depth}">`
        + `<span class="markdown-frontmatter-key">•</span>`
        + `<span class="markdown-frontmatter-value">${escapeHtml(listItem[2].trim())}</span></div>`];
    }
    return [`<div class="markdown-frontmatter-row markdown-frontmatter-continuation">`
      + `<span class="markdown-frontmatter-value">${escapeHtml(line.trim())}</span></div>`];
  });
  return rows.length ? `<section class="markdown-frontmatter">${rows.join("")}</section>` : "";
}

export function markdownToBlocks(
  markdown: string,
  options: MarkdownConversionOptions = { notePlacement: "footnote" },
): MarkdownBlock[] {
  void options;
  const { lines, definitions } = extractFootnoteDefinitions(markdown);
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  let markerIndex = 0;

  const withInline = (render: (inline: (value: string) => string) => Omit<MarkdownBlock, "notes">): MarkdownBlock => {
    const notes: MarkdownNoteReference[] = [];
    const context: InlineContext = {
      definitions,
      notes,
      nextMarker: () => `[[WORDOLLAMA_NOTE_${++markerIndex}]]`,
    };
    return { ...render((value) => renderInline(value, context)), ...(notes.length ? { notes } : {}) };
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index++;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const language = trimmed.slice(3).trim();
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index].trim())) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push({
        kind: "code",
        html: `<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`,
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      blocks.push(withInline((inline) => ({
        kind: `heading${level}` as MarkdownBlockKind,
        html: `<h${level}>${inline(heading[2])}</h${level}>`,
      })));
      index++;
      continue;
    }

    if (trimmed.startsWith("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = parseTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) rows.push(parseTableRow(lines[index++]));
      blocks.push(withInline((inline) => {
        const headerHtml = headers.map((cell) => `<th>${inline(cell)}</th>`).join("");
        const rowsHtml = rows.map((row) =>
          `<tr>${headers.map((_, cellIndex) => `<td>${inline(row[cellIndex] ?? "")}</td>`).join("")}</tr>`,
        ).join("");
        return {
          kind: "table",
          html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`,
        };
      }));
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const tag = orderedList ? "ol" : "ul";
      const itemValues: string[] = [];
      while (index < lines.length) {
        const next = (orderedList ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/).exec(lines[index].trim());
        if (!next) break;
        itemValues.push(next[1]);
        index++;
      }
      blocks.push(withInline((inline) => ({
        kind: orderedList ? "orderedList" : "unorderedList",
        html: `<${tag}>${itemValues.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`,
      })));
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quotes: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quotes.push(lines[index++].trim().replace(/^>\s?/, ""));
      }
      blocks.push(withInline((inline) => ({
        kind: "blockquote",
        html: `<blockquote>${inline(quotes.join("\n")).replace(/\n/g, "<br>")}</blockquote>`,
      })));
      continue;
    }

    const paragraph = [trimmed];
    index++;
    while (index < lines.length && lines[index].trim() &&
      !/^(?:#{1,6}\s|```|[-*+]\s|\d+[.)]\s|>\s?|\|)/.test(lines[index].trim())) {
      paragraph.push(lines[index++].trim());
    }
    blocks.push(withInline((inline) => ({
      kind: "paragraph",
      html: `<p>${inline(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`,
    })));
  }

  return blocks;
}

export function markdownToHtml(
  markdown: string,
  options: MarkdownConversionOptions = { notePlacement: "footnote" },
  htmlOptions: MarkdownHtmlOptions = {},
): string {
  const frontMatter = htmlOptions.renderFrontMatter ? extractYamlFrontMatter(markdown) : null;
  const frontMatterHtml = frontMatter ? renderYamlFrontMatter(frontMatter.lines) : "";
  const previewNotes: string[] = [];
  const contentHtml = markdownToBlocks(frontMatter?.body ?? markdown, options).map((block) => {
    let blockHtml = block.html;
    for (const note of block.notes ?? []) {
      previewNotes.push(note.text);
      blockHtml = blockHtml.replace(
        note.marker,
        `<sup class="markdown-note-reference">${previewNotes.length}</sup>`,
      );
    }
    return blockHtml;
  }).join("\n");
  const html = [frontMatterHtml, contentHtml].filter(Boolean).join("\n");
  if (!previewNotes.length) return html;
  const notes = previewNotes
    .map((note) => `<li>${markdownInlineToHtml(note).replace(/\n/g, "<br>")}</li>`)
    .join("");
  return `${html}\n<section class="markdown-notes"><ol>${notes}</ol></section>`;
}
