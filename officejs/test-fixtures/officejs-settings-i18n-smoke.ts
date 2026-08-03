import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const settingsRoot = resolve(repoRoot, "officejs/apps/addin/src/settings");
const app = readFileSync(resolve(settingsRoot, "SettingsApp.tsx"), "utf8");
const setupAssistant = readFileSync(resolve(settingsRoot, "SetupAssistant.tsx"), "utf8");
const bootstrap = readFileSync(resolve(settingsRoot, "main.tsx"), "utf8");
const localeRuntime = readFileSync(resolve(settingsRoot, "i18n.ts"), "utf8");
const sharedLocaleRuntime = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/i18n.ts"),
  "utf8",
);
const runtimeClient = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/runtime-client.ts"),
  "utf8",
);
const taskpaneRuntime = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/main.ts"),
  "utf8",
);
const settingsHtml = readFileSync(resolve(repoRoot, "officejs/apps/addin/settings.html"), "utf8");
const taskpaneHtml = readFileSync(resolve(repoRoot, "officejs/apps/addin/index.html"), "utf8");
const viteConfig = readFileSync(resolve(repoRoot, "officejs/apps/addin/vite.config.ts"), "utf8");
const english = JSON.parse(readFileSync(resolve(settingsRoot, "locales/en-US.json"), "utf8")) as object;
const chinese = JSON.parse(readFileSync(resolve(settingsRoot, "locales/zh-CN.json"), "utf8")) as object;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function flatten(value: object, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "string") result.set(path, item);
    else if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const [nestedKey, nestedValue] of flatten(item, path)) result.set(nestedKey, nestedValue);
    } else {
      throw new Error(`unsupported locale value at ${path}`);
    }
  }
  return result;
}

const en = flatten(english);
const zh = flatten(chinese);
const missingChinese = [...en.keys()].filter((key) => !zh.has(key));
const missingEnglish = [...zh.keys()].filter((key) => !en.has(key));
assert(missingChinese.length === 0, `zh-CN is missing keys: ${missingChinese.join(", ")}`);
assert(missingEnglish.length === 0, `en-US is missing keys: ${missingEnglish.join(", ")}`);

const usedKeys = [...`${app}\n${setupAssistant}`.matchAll(/\bt\(\s*"([^"]+)"/gu)].map((match) => match[1]);
const runtimeKeys = [...runtimeClient.matchAll(/\btr\(\s*"([^"]+)"/gu)].map((match) => match[1]);
const taskpaneRuntimeKeys = [...taskpaneRuntime.matchAll(/"(taskpane\.[^"]+)"/gu)]
  .map((match) => match[1]);
const taskpaneKeys = [
  ...taskpaneHtml.matchAll(
    /\bdata-i18n(?:-(?:placeholder|aria-label|title|alt|value))?="([^"]+)"/gu,
  ),
].map((match) => match[1]);
const missingUsedKeys = [...new Set([
  ...usedKeys,
  ...runtimeKeys,
  ...taskpaneKeys,
  ...taskpaneRuntimeKeys,
])]
  .filter((key) => !en.has(key));
assert(missingUsedKeys.length === 0, `SettingsApp uses missing i18n keys: ${missingUsedKeys.join(", ")}`);

for (const [key, value] of en) {
  assert(value.trim().length > 0, `en-US contains an empty value: ${key}`);
  assert(zh.get(key)?.trim(), `zh-CN contains an empty value: ${key}`);
}

const implementationSource = `${app}\n${setupAssistant}\n${bootstrap}\n${localeRuntime}\n${sharedLocaleRuntime}\n${settingsHtml}`;
assert(!/[\u3400-\u9fff]/u.test(implementationSource), "settings implementation contains hard-coded CJK text");
assert(
  !/[\u3400-\u9fff]/u.test(runtimeClient),
  "Bridge runtime client contains hard-coded CJK text",
);
assert(
  sharedLocaleRuntime.includes("Office.context?.displayLanguage"),
  "settings locale must follow the Office display language",
);
assert(sharedLocaleRuntime.includes("fallbackLng: \"en-US\""), "settings locale needs a stable English fallback");
assert(settingsHtml.includes('lang="en"'), "settings bootstrap HTML must remain locale-neutral");
assert(!/[\u3400-\u9fff]/u.test(taskpaneHtml), "task-pane HTML contains hard-coded CJK text");
const agentRuntimeStart = taskpaneRuntime.indexOf("function clearAgentImage");
const agentRuntimeEnd = taskpaneRuntime.indexOf("function paragraphSource");
assert(agentRuntimeStart > 0 && agentRuntimeEnd > agentRuntimeStart, "Agent runtime boundaries changed");
assert(
  !/[\u3400-\u9fff]/u.test(taskpaneRuntime.slice(agentRuntimeStart, agentRuntimeEnd)),
  "Agent runtime contains hard-coded CJK text",
);
const reviewRuntimeStart = taskpaneRuntime.indexOf("function paragraphSource");
const reviewRuntimeEnd = taskpaneRuntime.indexOf("const compareOriginalName");
assert(reviewRuntimeStart > 0 && reviewRuntimeEnd > reviewRuntimeStart, "Review runtime boundaries changed");
assert(
  !/[\u3400-\u9fff]/u.test(taskpaneRuntime.slice(reviewRuntimeStart, reviewRuntimeEnd)),
  "Review runtime contains hard-coded CJK text",
);
const utilityRuntimeStart = taskpaneRuntime.indexOf("const compareOriginalName");
assert(utilityRuntimeStart > 0, "Utility runtime boundary changed");
assert(
  !/[\u3400-\u9fff]/u.test(taskpaneRuntime.slice(utilityRuntimeStart)),
  "Diagnostics/compare runtime contains hard-coded CJK text",
);
assert(taskpaneHtml.includes('<html lang="en">'), "task pane bootstrap HTML must remain locale-neutral");
assert(
  viteConfig.includes('__BUNDLED_DEV__: "false"') &&
    viteConfig.includes('__SERVER_FORWARD_CONSOLE__: "false"'),
  "Vite 8 dev flags must be injected for a fresh Office Dialog WebView",
);

console.log(`Office.js settings i18n smoke passed (${en.size} keys in en-US and zh-CN).`);
