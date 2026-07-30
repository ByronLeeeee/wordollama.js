import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const legacyBaseline = JSON.parse(readFileSync(
  resolve(repoRoot, "officejs/test-fixtures/legacy-product-contracts.json"),
  "utf8",
)) as { ribbonControls: string[] };
const manifest = readFileSync(resolve(repoRoot, "officejs/apps/addin/manifest.xml"), "utf8");
const compactManifest = manifest.replace(/\s+/g, "");
const main = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/main.ts"), "utf8");
const commandsHtml = readFileSync(resolve(repoRoot, "officejs/apps/addin/commands.html"), "utf8");
const commands = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/commands.ts"), "utf8");
const settingsHtml = readFileSync(resolve(repoRoot, "officejs/apps/addin/settings.html"), "utf8");
const settingsRpc = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/settings/dialog-rpc.ts"),
  "utf8",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Office.js Ribbon smoke failed: ${message}`);
}

for (const baseline of [
  "CreateButton",
  "BtnModifyText",
  "AgentBtn",
  "TranslatePane",
  "RiskAssessment",
  "PleadingReview",
  "SettingButton",
]) {
  assert(
    legacyBaseline.ribbonControls.includes(baseline),
    `legacy product contract fixture lost Ribbon control ${baseline}`,
  );
}

for (const group of ["CreateGroup", "EditGroup", "TranslateGroup", "LegalGroup", "SettingsGroup"]) {
  assert(manifest.includes(`WordOllama.JS.${group}`), `missing Ribbon group ${group}`);
}

const routedWorkflows = [
  "writing", "modify", "image", "table", "html", "markdown", "agent",
  "polish", "expand", "simplify", "continue", "summarize", "fix", "compare",
  "translate", "risk", "fairness",
  "moot-court", "contract-compare", "law-search", "review", "custom-prompts",
  "diagnostics",
];
for (const workflow of routedWorkflows) {
  assert(manifest.includes(`&amp;workflow=${workflow}`), `manifest route missing ${workflow}`);
  if (!["agent", "compare", "contract-compare", "review", "settings", "diagnostics"].includes(workflow)) {
    assert(main.includes(`"${workflow}"`) || main.includes(`${workflow}:`), `task pane route missing ${workflow}`);
  }
}
assert(
  !manifest.includes("TranslateZh") && !manifest.includes("TranslateEn"),
  "translation Ribbon must not include fixed Chinese/English shortcuts",
);
assert(
  compactManifest.includes('<Controlxsi:type="Button"id="WordOllama.JS.Translate">')
    && !manifest.includes("WordOllama.JS.TranslateMenu"),
  "translation Ribbon entry must be one direct button instead of a menu",
);

for (const [resource, taskpane] of [
  ["Writing.Url", "WritingPane"],
  ["Modify.Url", "ModifyPane"],
  ["Image.Url", "ImagePane"],
  ["Table.Url", "TablePane"],
  ["Html.Url", "HtmlPane"],
  ["Markdown.Url", "MarkdownPane"],
  ["Agent.Url", "AgentPane"],
  ["Compare.Url", "ComparePane"],
  ["Translate.Url", "TranslatePane"],
  ["MootCourt.Url", "MootCourtPane"],
  ["ContractCompare.Url", "ComparePane"],
  ["LawSearch.Url", "LawSearchPane"],
  ["Review.Url", "ReviewPane"],
  ["CustomPrompts.Url", "CustomPromptPane"],
  ["Diagnostics.Url", "DiagnosticsPane"],
] as const) {
  const actionPattern =
    `<TaskpaneId>WordOllama.JS.${taskpane}</TaskpaneId><SourceLocationresid="${resource}"/>`;
  assert(compactManifest.includes(actionPattern), `${resource} must use independent ${taskpane}`);
}
assert(
  compactManifest.includes(
    '<Controlxsi:type="Button"id="WordOllama.JS.Settings">' +
    '<Labelresid="Settings.Label"/><Supertip><Titleresid="Settings.Label"/>' +
    '<Descriptionresid="Workflow.Tooltip"/></Supertip>',
  ) &&
    compactManifest.includes(
      '<Actionxsi:type="ExecuteFunction"><FunctionName>openSettingsDialog</FunctionName></Action>',
    ),
  "settings must open as an Office dialog command instead of a narrow task pane",
);
assert(
  commandsHtml.includes('src="/src/commands.ts"') &&
    commands.includes("Office.context.ui.displayDialogAsync(") &&
    commands.includes('"/settings.html"') &&
    settingsHtml.includes('src="/src/settings/main.tsx"') &&
    commands.includes('Office.actions.associate("openSettingsDialog"'),
  "the function file must register the dedicated React settings Office Dialog",
);
assert(
  commands.includes("DialogMessageReceived") &&
    commands.includes("messageChild(") &&
    settingsRpc.includes("DialogParentMessageReceived") &&
    settingsRpc.includes("messageParent("),
  "Word-dependent settings actions must be proxied through the dialog parent runtime",
);
assert(main.includes("applyWorkflowRoute()"), "workflow router is not initialized");
assert(main.includes("activeSurface"), "focused task-pane surface router is not initialized");
assert(!manifest.includes('<Items>\n                    <Control'), "menu children must use schema-valid Item elements");

const manifestDefaultValues = Array.from(
  manifest.matchAll(/\bDefaultValue="([^"]*)"/gu),
  (match) => match[1],
);
assert(
  manifest.includes("<DefaultLocale>en-US</DefaultLocale>") &&
  manifestDefaultValues.every((value) => !/[\u3400-\u9fff]/u.test(value)),
  "manifest DefaultLocale and DefaultValue strings must use the en-US fallback instead of hard-coded Chinese",
);
const chineseOverrides = Array.from(
  manifest.matchAll(/<bt:Override Locale="zh-CN" Value="([^"]+)"\s*\/>/gu),
  (match) => match[1],
);
assert(
  chineseOverrides.length === 33 &&
    chineseOverrides.every((value) => /[\u3400-\u9fff]/u.test(value)),
  "all localized Ribbon labels and descriptions must provide zh-CN overrides",
);

console.log("Office.js Ribbon parity smoke passed (creation, editing, translation, legal and settings routes).");
