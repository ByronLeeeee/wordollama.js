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
    compactManifest.includes('<bt:SetName="SharedRuntime"MinVersion="1.1"/>') &&
    !compactManifest.includes('<bt:SetName="WordApi"MinVersion="1.1"/>'),
  "Ribbon VersionOverrides must require AddinCommands 1.1 and SharedRuntime 1.1",
);
assert(
  compactManifest.includes('<Runtimes><Runtimeresid="Taskpane.Url"lifetime="long"/></Runtimes>') &&
    compactManifest.includes('<FunctionFileresid="Taskpane.Url"/>'),
  "Ribbon commands and the task pane must share one long-lived runtime",
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

for (const [control, functionName] of [
  ["Writing", "openWriting"], ["Modify", "openModify"], ["Polish", "openPolish"],
  ["Expand", "openExpand"], ["Simplify", "openSimplify"], ["Continue", "openContinue"],
  ["Summarize", "openSummarize"], ["Fix", "openFix"], ["Image", "openImage"],
  ["Table", "openTable"], ["Html", "openHtml"], ["Markdown", "openMarkdown"],
  ["Agent", "openAgent"], ["Compare", "openCompare"], ["Translate", "openTranslate"],
  ["Risk", "openRisk"], ["Fairness", "openFairness"], ["MootCourt", "openMootCourt"],
  ["ContractCompare", "openContractCompare"], ["LawSearch", "openLawSearch"],
  ["Review", "openReview"], ["CustomPrompts", "openCustomPrompts"],
] as const) {
  const controlStart = compactManifest.indexOf(`<Controlxsi:type="Button"id="WordOllama.JS.${control}">`);
  const controlEnd = compactManifest.indexOf("</Control>", controlStart);
  const controlMarkup = compactManifest.slice(controlStart, controlEnd);
  assert(
    controlStart >= 0 && controlMarkup.includes(
      `<Actionxsi:type="ExecuteFunction"><FunctionName>${functionName}</FunctionName></Action>`,
    ),
    `${control} must dispatch ${functionName} through the shared runtime`,
  );
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
    main.includes('from "./commands"') &&
    commands.includes("Office.context.ui.displayDialogAsync(") &&
    commands.includes('"/settings.html"') &&
    commands.includes('dialogUrl.searchParams.set("v", ADDIN_VERSION)') &&
    settingsHtml.includes('src="/src/settings/main.tsx"') &&
    commands.includes('Office.actions.associate("openSettingsDialog"'),
  "the shared function file must register workflow commands and the dedicated React settings dialog",
);
assert(
  commands.includes("Office.addin?.showAsTaskpane?.()") &&
    commands.includes("SHARED_RUNTIME_NAVIGATION_EVENT") &&
    main.includes("Office.addin.setStartupBehavior(Office.StartupBehavior.load)"),
  "the shared runtime must reveal the pane on demand and auto-load on document reopen",
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
