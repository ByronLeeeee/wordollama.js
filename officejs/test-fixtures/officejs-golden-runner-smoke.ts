import {
  GOLDEN_CASES,
  runOfficeGoldenMatrix,
  type GoldenHostHarness,
  type GoldenRegistry,
} from "../apps/addin/src/officejs-golden-runner.ts";
import type { OfficeToolDescriptor } from "../apps/addin/src/contracts.ts";
import { resolveBuiltInStyleName } from "../apps/addin/src/officejs-word-adapter.ts";

if (resolveBuiltInStyleName("Heading 1") !== "Heading1" ||
    resolveBuiltInStyleName("标题 2") !== "Heading2" ||
    resolveBuiltInStyleName("正文") !== "Normal" ||
    resolveBuiltInStyleName("自定义样式") !== undefined) {
  throw new Error("built-in style aliases are not locale independent");
}


const names = GOLDEN_CASES.map((testCase) => testCase.name);
if (names.length !== 38 || new Set(names).size !== 38) {
  throw new Error(`golden runner must contain 38 unique tools, got ${names.length}`);
}

const unsupportedName = "update_toc";
const failedName = "header_footer";
const executed: string[] = [];
const selected: string[] = [];
let progressEvents = 0;

const descriptors: OfficeToolDescriptor[] = GOLDEN_CASES
  .filter((testCase) => testCase.name !== unsupportedName)
  .map((testCase) => ({
    name: testCase.name,
    description: "golden fixture",
    isWriteOperation: false,
    parameterSchema: { type: "object", properties: {}, required: [] },
  }));

const registry: GoldenRegistry = {
  list: () => descriptors,
  execute: async (name) => {
    executed.push(name);
    if (name === failedName) throw new Error("intentional fixture failure");
    return { ok: true };
  },
};

const harness: GoldenHostHarness = {
  describeHost: () => ({ host: "mock-word", platform: "test" }),
  prepareDisposableFixture: async () => undefined,
  selectText: async (text) => {
    selected.push(text);
  },
};

const report = await runOfficeGoldenMatrix(registry, harness, () => {
  progressEvents += 1;
});
if (report.results.length !== 38 || progressEvents !== 38) {
  throw new Error("golden runner did not report every tool");
}
if (report.supportedToolCount !== 37 || report.passed !== 36 || report.failed !== 1 ||
    report.unsupported !== 1 || report.blocked !== 0) {
  throw new Error(`unexpected golden summary: ${JSON.stringify(report)}`);
}
if (executed.includes(unsupportedName) || !executed.includes(failedName) || selected.length === 0) {
  throw new Error("golden runner capability filtering, failure isolation, or selection setup failed");
}

const blockedHarness: GoldenHostHarness = {
  describeHost: () => ({ host: "mock-word", platform: "test" }),
  prepareDisposableFixture: async () => {
    throw new Error("fixture unavailable");
  },
  selectText: async () => undefined,
};
const blockedReport = await runOfficeGoldenMatrix(registry, blockedHarness);
if (blockedReport.blocked !== 37 || blockedReport.unsupported !== 1 ||
    blockedReport.passed !== 0 || blockedReport.failed !== 0) {
  throw new Error("fixture failure did not block all supported tools");
}
if (blockedReport.results.find((result) => result.status === "blocked")?.error !== "fixture unavailable") {
  throw new Error("fixture failure reason was not preserved");
}

console.log("Office.js golden runner smoke passed (38 tools, locale-safe styles, capability and failure isolation).");
