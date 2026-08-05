import i18n from "./i18n.ts";

export interface ReviewAnchor {
  originalIndex: number;
  textHash: string;
  previousHash: string;
  nextHash: string;
  bookmarkName?: string;
}

export function normalizeReviewText(value: string): string {
  return value.replace(/[\r\a]+$/g, "").replace(/\s+/g, " ").trim();
}

export function hashReviewText(value: string): string {
  const normalized = normalizeReviewText(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createReviewAnchors(paragraphs: string[], start = 1): ReviewAnchor[] {
  return paragraphs.map((text, index) => ({
    originalIndex: start + index,
    textHash: hashReviewText(text),
    previousHash: index > 0 ? hashReviewText(paragraphs[index - 1]) : "",
    nextHash: index + 1 < paragraphs.length ? hashReviewText(paragraphs[index + 1]) : "",
  }));
}

export function buildReviewChunks(
  paragraphs: string[],
  start: number,
  maximumCharacters = 90_000,
): Array<{ source: string; anchors: Map<number, ReviewAnchor> }> {
  const allAnchors = new Map(
    createReviewAnchors(paragraphs, start).map((anchor) => [anchor.originalIndex, anchor]),
  );
  const chunks: Array<{ source: string; anchors: Map<number, ReviewAnchor> }> = [];
  let lines: string[] = [];
  let chunkAnchors = new Map<number, ReviewAnchor>();
  let characters = 0;
  const flush = () => {
    if (!lines.length) return;
    chunks.push({ source: lines.join("\n"), anchors: chunkAnchors });
    lines = [];
    chunkAnchors = new Map();
    characters = 0;
  };
  paragraphs.forEach((text, offset) => {
    const paragraphIndex = start + offset;
    const line = `[P${paragraphIndex}] ${text}`;
    if (lines.length && characters + line.length + 1 > maximumCharacters) flush();
    lines.push(line);
    characters += line.length + 1;
    const anchor = allAnchors.get(paragraphIndex);
    if (anchor) chunkAnchors.set(paragraphIndex, anchor);
  });
  flush();
  return chunks;
}

export function resolveReviewAnchorIndex(
  paragraphs: string[],
  anchor: ReviewAnchor | undefined,
  excerpt: string,
  paragraphIndex: number,
): number {
  const normalized = paragraphs.map(normalizeReviewText);
  const normalizedExcerpt = normalizeReviewText(excerpt);
  if (anchor?.textHash) {
    const candidates = normalized
      .map((text, index) => ({ index, hash: hashReviewText(text) }))
      .filter((candidate) => candidate.hash === anchor.textHash);
    if (candidates.length === 1) return candidates[0].index + 1;
    if (candidates.length > 1) {
      const scored = candidates.map((candidate) => {
        const previousHash = candidate.index > 0 ? hashReviewText(normalized[candidate.index - 1]) : "";
        const nextHash = candidate.index + 1 < normalized.length
          ? hashReviewText(normalized[candidate.index + 1])
          : "";
        const contextScore =
          (anchor.previousHash && previousHash === anchor.previousHash ? 2 : 0) +
          (anchor.nextHash && nextHash === anchor.nextHash ? 2 : 0);
        const distance = Math.abs(candidate.index + 1 - anchor.originalIndex);
        return { index: candidate.index + 1, contextScore, distance };
      }).sort((left, right) =>
        right.contextScore - left.contextScore || left.distance - right.distance);
      if (scored[0].contextScore > 0 &&
          (scored.length === 1 ||
           scored[0].contextScore > scored[1].contextScore ||
           scored[0].distance < scored[1].distance)) {
        return scored[0].index;
      }
      throw new Error(i18n.t("taskpane.review.errors.ambiguousWithContext"));
    }
    throw new Error(i18n.t("taskpane.review.errors.anchorChanged"));
  }

  const direct = normalized[paragraphIndex - 1];
  if (direct && direct === normalizedExcerpt) return paragraphIndex;
  const exact = normalized
    .map((text, index) => ({ index: index + 1, text }))
    .filter((candidate) => candidate.text === normalizedExcerpt);
  if (exact.length === 1) return exact[0].index;
  if (exact.length > 1) throw new Error(i18n.t("taskpane.review.errors.ambiguousOriginal"));
  const containing = normalized
    .map((text, index) => ({ index: index + 1, text }))
    .filter((candidate) =>
      candidate.text.includes(normalizedExcerpt) || normalizedExcerpt.includes(candidate.text));
  if (containing.length === 1) return containing[0].index;
  throw new Error(i18n.t("taskpane.review.errors.relocationFailed"));
}

export function reviewDocumentFingerprint(paragraphs: string[]): string {
  const normalized = paragraphs.map(normalizeReviewText);
  return [
    normalized.length,
    hashReviewText(normalized.join("\n")),
  ].join(":");
}
