import {
  runLongDocumentMatrix,
  type LongDocumentHost,
} from "../apps/addin/src/officejs-long-document-runner.ts";

const prepared: number[] = [];
const host: LongDocumentHost = {
  describeHost: () => ({ host: "mock-word", platform: "test" }),
  prepareFixture: async (paragraphCount) => {
    prepared.push(paragraphCount);
    return { characterCount: paragraphCount * 100 };
  },
  readOverview: async () => ({ paragraphCount: prepared.at(-1) ?? 0 }),
  readRange: async (start, end) => ({
    start,
    end,
    paragraphs: Array.from({ length: end - start + 1 }, (_, index) => `P${start + index}`),
  }),
  readChunk: async (start) => ({
    start,
    end: prepared.at(-1) ?? start,
    paragraphs: Array.from({ length: 50 }, (_, index) => `P${start + index}`),
  }),
  buildSemanticMap: async () => {
    const count = prepared.at(-1) ?? 0;
    return {
      paragraphCount: count,
      entries: Array.from({ length: Math.ceil(count / 10) }, (_, index) => ({
        start: index * 10 + 1,
        end: Math.min(count, index * 10 + 10),
        summary: `P${index * 10 + 1}`,
      })),
    };
  },
  verifyRelocation: async (targetIndex) => ({ resolvedIndex: targetIndex + 1 }),
};

const report = await runLongDocumentMatrix(host);
if (prepared.join(",") !== "1000,5000" ||
    report.cases.length !== 2 ||
    report.cases.some((result) => result.status !== "passed") ||
    report.cases[1].observedParagraphCount !== 5_000 ||
    report.cases[1].semanticEntryCount !== 500) {
  throw new Error(`long document runner regression: ${JSON.stringify(report)}`);
}

const brokenHost: LongDocumentHost = {
  ...host,
  readOverview: async () => ({ paragraphCount: 999 }),
};
const broken = await runLongDocumentMatrix(brokenHost, [1_000]);
if (broken.cases[0].status !== "failed" ||
    !broken.cases[0].errors.some((error) => error.includes("概览段落数"))) {
  throw new Error("long document runner must fail closed on paragraph-count drift");
}

console.log("Office.js long-document runner smoke passed (1,000/5,000 paragraphs and anchor relocation).");
