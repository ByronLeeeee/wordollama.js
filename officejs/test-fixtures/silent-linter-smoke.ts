import { findChangedParagraphs } from "../apps/addin/src/silent-linter.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Silent linter smoke failed: ${message}`);
}

const previous = ["same", "old", "kept", "", "removed"];
const current = ["same", "new", "kept", "inserted", ""];
const changed = findChangedParagraphs(previous, current);
assert(changed.length === 2, "only non-empty changed paragraphs should be reviewed");
assert(changed[0].index === 2 && changed[0].text === "new", "changed paragraph index was lost");
assert(changed[1].index === 4 && changed[1].text === "inserted", "inserted paragraph was not found");

const capped = findChangedParagraphs([], Array.from({ length: 10 }, (_, index) => `P${index}`), 5);
assert(capped.length === 5, "review must be capped to prevent token bursts");

console.log("Office.js silent changed-paragraph linter smoke passed.");
