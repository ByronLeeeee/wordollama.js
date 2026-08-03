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

assert(
  compactManifest.includes('<bt:SetName="AddinCommands"MinVersion="1.1"/>') &&
    !compactManifest.includes('<bt:SetName="WordApi"MinVersion="1.1"/>'),
  "Ribbon VersionOverrides must require AddinCommands 1.1 instead of repeating WordApi",
);
assert(
  compactManifest.includes('<CustomTabid="WordOllama.JS.Tab">'),
  "WordOllama.JS commands must be installed as a persistent custom Ribbon tab",
);

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

for (const group of ["CreateGroup", "EditGroup", "EditMoreGroup", "TranslateGroup", "LegalGroup", "SettingsGroup"]) {
  assert(manifest.includes(`WordOllama.JS.${group}`), `missing Ribbon group ${group}`);
}

const routedWorkflows = [
  "writing", "modify", "image", "table", "html", "markdown", "agent",
  "polish", "expand", "simplify", "continue", "summarize", "fix", "compare",
  "translate", "risk", "fairness",
  "moot-court", "contract-compare", "law-search", "review", "custom-prompts",
];
for (const workflow of routedWorkflows) {
  assert(manifest.includes(`&amp;workflow=${workflow}`), `manifest route missing ${workflow}`);
  if (!["agent", "compare", "contract-compare", "review", "settings"].includes(workflow)) {
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
  ["Polish.Url", "PolishPane"],
  ["Expand.Url", "ExpandPane"],
  ["Simplify.Url", "SimplifyPane"],
  ["Continue.Url", "ContinuePane"],
  ["Summarize.Url", "SummarizePane"],
  ["Fix.Url", "FixPane"],
  ["Image.Url", "ImagePane"],
  ["Table.Url", "TablePane"],
  ["Html.Url", "HtmlPane"],
  ["Markdown.Url", "MarkdownPane"],
  ["Agent.Url", "AgentPane"],
  ["Compare.Url", "ComparePane"],
  ["Translate.Url", "TranslatePane"],
  ["Risk.Url", "RiskPane"],
  ["Fairness.Url", "FairnessPane"],
  ["MootCourt.Url", "MootCourtPane"],
  ["ContractCompare.Url", "ContractComparePane"],
  ["LawSearch.Url", "LawSearchPane"],
  ["Review.Url", "ReviewPane"],
  ["CustomPrompts.Url", "CustomPromptPane"],
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
    commands.includes('dialogUrl.searchParams.set("v", ADDIN_VERSION)') &&
    settingsHtml.includes('src="/src/settings/main.tsx"') &&
    commands.includes('Office.actions.associate("openSettingsDialog"'),
  "the function file must register the dedicated React settings Office Dialog",
);
assert(
  commands.includes("DialogMessageReceived") &&
    commands.includes("messageChild(") &&
    commands.includes("event.completed();") &&
    settingsRpc.includes("DialogParentMessageReceived") &&
    settingsRpc.includes("messageParent("),
  "Word-dependent settings actions must be proxied through the dialog parent runtime",
);
for (const control of ["Modify", "Polish", "Expand", "Simplify", "Continue", "Summarize", "Fix"]) {
  assert(
    compactManifest.includes(`<Controlxsi:type="Button"id="WordOllama.JS.${control}">`),
    `${control} must be a direct Ribbon button`,
  );
}
assert(!manifest.includes('id="WordOllama.JS.EditMenu"'), "editing commands must not be hidden in a menu");
assert(
  !manifest.includes('id="WordOllama.JS.Diagnostics"') &&
    !manifest.includes('id="Diagnostics.Url"'),
  "release Ribbon must not expose diagnostics",
);
assert(!manifest.includes("WordOllama.JS.EditPane"), "editing workflows must not share one Word task pane");
assert(
  !manifest.includes('id="WordOllama.JS.CreateMore"') &&
    !manifest.includes('id="WordOllama.JS.LegalMenu"'),
  "creation and legal workflows must be direct Ribbon buttons instead of menus",
);
for (const control of ["Image", "Table", "Html", "Markdown", "Risk", "Fairness", "MootCourt", "ContractCompare", "Compare", "LawSearch"]) {
  assert(
    compactManifest.includes(`<Controlxsi:type="Button"id="WordOllama.JS.${control}">`) &&
      compactManifest.includes(`resid="${control}.Icon16"`) &&
      compactManifest.includes(`resid="${control}.Icon32"`) &&
      compactManifest.includes(`resid="${control}.Icon80"`),
    `${control} must be a direct Ribbon button with its own icon set`,
  );
}
const legalGroupMarkup = manifest.slice(
  manifest.indexOf('<Group id="WordOllama.JS.LegalGroup">'),
  manifest.indexOf('<Group id="WordOllama.JS.SettingsGroup">'),
);
assert(
  legalGroupMarkup.includes('id="WordOllama.JS.Compare"'),
  "document comparison must be placed in the legal group",
);
assert(
  commands.includes('request.method === "settings.close"') &&
    commands.includes("dialog?.close()") &&
    settingsRpc.includes('method: "settings.close"'),
  "the Ribbon command host must close the settings Office Dialog when requested by the child window",
);
assert(main.includes("initializeWorkflowRoute()"), "workflow router is not initialized");
assert(
  main.includes('dataset.routePending = "true"') &&
    main.includes("delete document.documentElement.dataset.routePending"),
  "deep-linked workflows must hide the Agent shell until their route is ready",
);
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
assert(
  manifest.includes('id="CustomPrompts.Label" DefaultValue="My Commands"') &&
    manifest.includes('Locale="zh-CN" Value="我的指令"'),
  "the reusable command launcher must use the My Commands Ribbon label",
);

console.log("Office.js Ribbon parity smoke passed (creation, editing, translation, legal and settings routes).");
