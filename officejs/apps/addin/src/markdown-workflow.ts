export interface MarkdownConversionOptions {
  headings: boolean;
  tables: boolean;
  code: boolean;
}

export type MarkdownBlockKind =
  | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6"
  | "paragraph" | "code" | "blockquote" | "unorderedList" | "orderedList" | "table";

export interface MarkdownBlock {
  kind: MarkdownBlockKind;
  html: string;
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

export function markdownInlineToHtml(value: string): string {
  const token = /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]+\]\([^) \n]+\))/g;
  let html = "";
  let offset = 0;
  for (const match of value.matchAll(token)) {
    const index = match.index ?? 0;
    html += escapeHtml(value.slice(offset, index));
    const part = match[0];
    if (part.startsWith("`")) html += `<code>${escapeHtml(part.slice(1, -1))}</code>`;
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

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function markdownToBlocks(markdown: string, options: MarkdownConversionOptions): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index++;
      continue;
    }

    if (options.code && /^```/.test(trimmed)) {
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
    if (options.headings && heading) {
      const level = heading[1].length;
      blocks.push({
        kind: `heading${level}` as MarkdownBlockKind,
        html: `<h${level}>${markdownInlineToHtml(heading[2])}</h${level}>`,
      });
      index++;
      continue;
    }

    if (options.tables && trimmed.startsWith("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = parseTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) rows.push(parseTableRow(lines[index++]));
      const headerHtml = headers.map((cell) => `<th>${markdownInlineToHtml(cell)}</th>`).join("");
      const rowsHtml = rows.map((row) =>
        `<tr>${headers.map((_, cellIndex) => `<td>${markdownInlineToHtml(row[cellIndex] ?? "")}</td>`).join("")}</tr>`,
      ).join("");
      blocks.push({
        kind: "table",
        html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`,
      });
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const tag = orderedList ? "ol" : "ul";
      const items: string[] = [];
      while (index < lines.length) {
        const next = (orderedList ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/).exec(lines[index].trim());
        if (!next) break;
        items.push(`<li>${markdownInlineToHtml(next[1])}</li>`);
        index++;
      }
      blocks.push({ kind: orderedList ? "orderedList" : "unorderedList", html: `<${tag}>${items.join("")}</${tag}>` });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quotes: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quotes.push(lines[index++].trim().replace(/^>\s?/, ""));
      }
      blocks.push({
        kind: "blockquote",
        html: `<blockquote>${markdownInlineToHtml(quotes.join("\n")).replace(/\n/g, "<br>")}</blockquote>`,
      });
      continue;
    }

    const paragraph = [trimmed];
    index++;
    while (index < lines.length && lines[index].trim() &&
      !/^(?:#{1,6}\s|```|[-*+]\s|\d+[.)]\s|>\s?|\|)/.test(lines[index].trim())) {
      paragraph.push(lines[index++].trim());
    }
    blocks.push({
      kind: "paragraph",
      html: `<p>${markdownInlineToHtml(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`,
    });
  }

  return blocks;
}

export function markdownToHtml(markdown: string, options: MarkdownConversionOptions): string {
  return markdownToBlocks(markdown, options).map((block) => block.html).join("\n");
}
