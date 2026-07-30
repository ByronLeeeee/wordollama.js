import i18n from "./i18n.ts";

export interface ChangedParagraph {
  index: number;
  text: string;
}

export function findChangedParagraphs(
  previous: string[],
  current: string[],
  limit = 5,
): ChangedParagraph[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error(i18n.t("taskpane.review.errors.invalidSilentLimit"));
  }
  const changed: ChangedParagraph[] = [];
  const count = Math.max(previous.length, current.length);
  for (let index = 0; index < count && changed.length < limit; index += 1) {
    const text = current[index]?.trim() ?? "";
    if (text && text !== (previous[index]?.trim() ?? "")) {
      changed.push({ index: index + 1, text });
    }
  }
  return changed;
}
