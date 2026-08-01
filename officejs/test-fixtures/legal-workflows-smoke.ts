import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatLawArticle,
  investigatePleading,
} from "../apps/addin/src/legal-workflows.ts";
import i18n from "../apps/addin/src/i18n.ts";
import type { RuntimeClient } from "../apps/addin/src/runtime-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Legal workflow smoke failed: ${message}`);
}

let captured = "";
await i18n.changeLanguage("zh-CN");
const runtime = {
  async *streamChat(messages: Array<{ content: string }>) {
    captured = messages.map((message) => message.content).join("\n");
    yield { provider: "fake", model: "legal", delta: "1. 核实", done: false };
    yield { provider: "fake", model: "legal", delta: "合同原件", done: true };
  },
} as unknown as RuntimeClient;
const investigation = await investigatePleading(runtime, "indictment", "原告主张被告欠款。");
assert(investigation.includes("核实"), "moot-court result was not returned");
for (const contract of ["起诉状", "原告主张被告欠款", "evidence gaps", "Do not fabricate"]) {
  assert(captured.includes(contract), `moot-court prompt lost ${contract}`);
}
assert(
  formatLawArticle({ lawName: "中华人民共和国民法典", articleNumber: "第五百七十七条", content: "当事人一方不履行..." })
    .startsWith("【中华人民共和国民法典】第五百七十七条"),
  "law article copy format changed",
);

const repoRoot = resolve(import.meta.dirname, "../..");
const service = readFileSync(resolve(repoRoot, "src/WordOllama.DesktopBridge/LegalArticleService.cs"), "utf8");
const program = readFileSync(resolve(repoRoot, "src/WordOllama.DesktopBridge/Program.cs"), "utf8");
const runtimeClient = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/runtime-client.ts"), "utf8");
assert(service.includes('private const string ApiBase = "https://lawapi.lslby.com/api/v1/article"'), "law API endpoint differs from original");
assert(service.includes("FormatArticleNumber") && service.includes("NumberToChinese"), "article number normalization is missing");
assert(program.includes('app.MapGet("/legal/article"'), "authenticated Bridge legal endpoint is missing");
assert(program.includes("sessions.TryGet(token, origin"), "legal endpoint does not enforce a paired session");
assert(runtimeClient.includes("async searchLawArticle("), "Office.js client lacks legal search");

console.log("Unified law search and moot-court workflow smoke passed.");

