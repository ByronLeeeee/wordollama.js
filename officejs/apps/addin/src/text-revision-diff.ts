export interface TextRevisionHunk {
  originalStart: number;
  originalText: string;
  revisedText: string;
  leftAnchor: string;
  rightAnchor: string;
}

interface Token {
  value: string;
  start: number;
  end: number;
}

const TOKEN_PATTERN = /(\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_]+|[^\s])/gu;
const MAX_LCS_CELLS = 1_200_000;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const value = match[0];
    const start = match.index ?? 0;
    tokens.push({ value, start, end: start + value.length });
  }
  return tokens;
}

function contiguousFallback(original: string, revised: string): TextRevisionHunk[] {
  let prefix = 0;
  while (prefix < original.length && prefix < revised.length && original[prefix] === revised[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < revised.length - prefix &&
    original[original.length - 1 - suffix] === revised[revised.length - 1 - suffix]
  ) suffix += 1;
  if (prefix === original.length && prefix === revised.length) return [];
  return [{
    originalStart: prefix,
    originalText: original.slice(prefix, original.length - suffix),
    revisedText: revised.slice(prefix, revised.length - suffix),
    leftAnchor: original.slice(Math.max(0, prefix - 48), prefix),
    rightAnchor: original.slice(original.length - suffix, Math.min(original.length, original.length - suffix + 48)),
  }];
}

export function buildTextRevisionHunks(original: string, revised: string): TextRevisionHunk[] {
  if (original === revised) return [];
  const before = tokenize(original);
  const after = tokenize(revised);
  if (!before.length || !after.length || before.length * after.length > MAX_LCS_CELLS) {
    return contiguousFallback(original, revised);
  }

  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = before[i].value === after[j].value
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const hunks: TextRevisionHunk[] = [];
  let i = 0;
  let j = 0;
  let originalOffset = 0;
  let revisedOffset = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i].value === after[j].value) {
      originalOffset = before[i].end;
      revisedOffset = after[j].end;
      i += 1;
      j += 1;
      continue;
    }
    const hunkStart = originalOffset;
    const revisedStart = revisedOffset;
    while (i < before.length || j < after.length) {
      if (i < before.length && j < after.length && before[i].value === after[j].value) break;
      if (j >= after.length || (i < before.length && table[(i + 1) * width + j] >= table[i * width + j + 1])) {
        originalOffset = before[i].end;
        i += 1;
      } else {
        revisedOffset = after[j].end;
        j += 1;
      }
    }
    hunks.push({
      originalStart: hunkStart,
      originalText: original.slice(hunkStart, originalOffset),
      revisedText: revised.slice(revisedStart, revisedOffset),
      leftAnchor: original.slice(Math.max(0, hunkStart - 48), hunkStart),
      rightAnchor: original.slice(originalOffset, Math.min(original.length, originalOffset + 48)),
    });
  }
  return hunks;
}

export function occurrenceBefore(text: string, search: string, offset: number): number {
  if (!search) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor < offset) {
    const found = text.indexOf(search, cursor);
    if (found < 0 || found >= offset) break;
    count += 1;
    cursor = found + Math.max(1, search.length);
  }
  return count;
}
