import {
  buildReviewChunks,
  createReviewAnchors,
  resolveReviewAnchorIndex,
  reviewDocumentFingerprint,
} from "../apps/addin/src/review-anchor.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Review anchor smoke failed: ${message}`);
}

const original = ["标题", "重复条款", "甲方义务", "重复条款", "乙方义务"];
const anchors = createReviewAnchors(original);
const secondDuplicate = anchors[3];

const inserted = ["新增说明", ...original];
assert(
  resolveReviewAnchorIndex(inserted, secondDuplicate, "重复条款", 4) === 5,
  "an insertion before the target must not move the review action to the wrong paragraph",
);

assert(
  resolveReviewAnchorIndex(original, secondDuplicate, "重复条款", 2) === 4,
  "neighbor fingerprints must disambiguate repeated paragraph text",
);

let ambiguousRejected = false;
try {
  resolveReviewAnchorIndex(
    ["重复条款", "相同上下文", "重复条款", "相同上下文"],
    {
      originalIndex: 2,
      textHash: createReviewAnchors(["重复条款"])[0].textHash,
      previousHash: "",
      nextHash: "",
    },
    "重复条款",
    2,
  );
} catch {
  ambiguousRejected = true;
}
assert(ambiguousRejected, "ambiguous duplicate paragraphs must be rejected instead of guessed");

let changedRejected = false;
try {
  resolveReviewAnchorIndex(
    ["标题", "已被用户修改", "甲方义务"],
    anchors[1],
    "重复条款",
    2,
  );
} catch {
  changedRejected = true;
}
assert(changedRejected, "a modified target paragraph must be rejected before destructive review actions");

assert(
  reviewDocumentFingerprint(original) !== reviewDocumentFingerprint(
    ["标题", "重复条款", "已修改的中间段落", "重复条款", "乙方义务"],
  ),
  "document fingerprint must detect edits in the middle of a document",
);

const longChunks = buildReviewChunks(
  Array.from({ length: 12 }, (_, index) => `${index + 1}-${"长文本".repeat(2_000)}`),
  301,
  20_000,
);
assert(longChunks.length > 1, "large review pages must be split before the provider input limit");
assert(longChunks[0].source.startsWith("[P301]"), "chunking must preserve absolute paragraph indexes");
assert(
  longChunks.at(-1)?.anchors.has(312),
  "the last large-document chunk must retain a stable anchor for its final paragraph",
);

console.log("Review stable anchor and document fingerprint smoke passed.");
