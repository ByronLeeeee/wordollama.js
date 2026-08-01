import {
  generateReviewIssues,
  generateReviewSuggestions,
  parseReviewIssues,
  parseReviewSuggestions,
} from "../apps/addin/src/review-workspace.ts";
import { trackedRevisionIdentity } from "../apps/addin/src/officejs-word-adapter.ts";
import type { ChatMessage, ProviderChatResponse } from "../apps/addin/src/contracts.ts";
import i18n from "../apps/addin/src/i18n.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Review workspace smoke failed: ${message}`);
}

await i18n.changeLanguage("zh-CN");
const issues = parseReviewIssues(`\n\`\`\`json\n{
  "issues": [
    {
      "类型": "legal",
      "严重程度": "高",
      "段落": 7,
      "标题": "责任范围不明确",
      "问题": "责任上限缺失",
      "建议": "增加责任上限",
      "原文": "乙方承担全部责任"
    },
    {
      "category": "clarity",
      "severity": "minor",
      "paragraphIndex": "8",
      "title": "表达含糊",
      "description": "时间点不明确",
      "suggestion": "写明日期",
      "excerpt": "尽快完成"
    }
  ]
}\n\`\`\``);
assert(issues.length === 2, "two bilingual issues should parse");
assert(issues[0].severity === "high" && issues[0].paragraphIndex === 7, "Chinese severity and paragraph normalize");
assert(issues[1].severity === "low" && issues[1].suggestion === "写明日期", "minor severity normalizes to low");

const suggestions = parseReviewSuggestions(JSON.stringify({
  suggestions: [
    {
      paragraph_index: 3,
      original: "付款期限为三十天。",
      suggestion: "付款期限为收到发票后三十个自然日。",
      reason: "明确起算点",
    },
    { paragraphIndex: 4, originalText: "缺少建议", suggestedText: "" },
  ],
}));
assert(suggestions.length === 1, "empty replacement suggestions are rejected");
assert(suggestions[0].status === "pending" && suggestions[0].paragraphIndex === 3, "suggestion state and location parse");

let invalidRejected = false;
try { parseReviewIssues("not json"); } catch { invalidRejected = true; }
assert(invalidRejected, "non-JSON model output must fail clearly");

class FakeRuntime {
  calls: ChatMessage[][] = [];
  profileIds: Array<string | undefined> = [];
  private readonly responses: string[];
  constructor(responses: string[]) {
    this.responses = responses;
  }
  async chat(
    messages: ChatMessage[],
    _model?: string,
    _signal?: AbortSignal,
    providerProfileId?: string,
  ): Promise<ProviderChatResponse> {
    this.calls.push(messages);
    this.profileIds.push(providerProfileId);
    return { provider: "fake", model: "fake", content: this.responses.shift() ?? "[]" };
  }
}

const fake = new FakeRuntime([
  '{"issues":[{"category":"grammar","severity":"medium","paragraphIndex":1,"title":"语法","description":"问题","suggestion":"修复","excerpt":"原文"}]}',
  '{"suggestions":[{"paragraphIndex":1,"originalText":"原文","suggestedText":"新文","reason":"清晰"}]}',
]);
const generatedIssues = await generateReviewIssues(fake as never, "[P1] 原文", "全文", "silent-review-model");
const generatedSuggestions = await generateReviewSuggestions(fake as never, "[P1] 原文", "提升清晰度", "正式", undefined);
assert(generatedIssues.length === 1 && generatedSuggestions.length === 1, "generation helpers parse provider responses");
assert(fake.calls[0][0].content.includes("只返回 JSON"), "issue prompt requires strict JSON");
assert(fake.profileIds[0] === "silent-review-model", "silent review must route through its saved provider profile");
assert(fake.calls[1][1].content.includes("写作画像：正式"), "suggestion prompt carries writing profile");

await i18n.changeLanguage("en-US");
const englishFake = new FakeRuntime([
  '{"issues":[{"paragraphIndex":1,"title":"Clarity","description":"Ambiguous"}]}',
]);
await generateReviewIssues(englishFake as never, "[P1] Source", "Selection");
assert(englishFake.calls[0][0].content.includes("Return JSON only"),
  "English review prompt was not localized");
assert(englishFake.calls[0][1].content.includes("Review scope: Selection"),
  "English review scope was not localized");

const revisionIdentity = trackedRevisionIdentity({
  type: "Insert",
  author: "Reviewer",
  date: "2026-07-29T08:00:00.000Z",
  formatDescription: "",
  text: "新增条款",
});
assert(revisionIdentity === trackedRevisionIdentity({
  type: "Insert",
  author: "Reviewer",
  date: "2026-07-29T08:00:00.000Z",
  formatDescription: "",
  text: "新增条款",
}), "tracked revision identity is deterministic");
assert(revisionIdentity !== trackedRevisionIdentity({
  type: "Delete",
  author: "Reviewer",
  date: "2026-07-29T08:00:00.000Z",
  formatDescription: "",
  text: "新增条款",
}), "tracked revision identity distinguishes revision semantics");

console.log("Office.js structured issue and review suggestion smoke passed.");
