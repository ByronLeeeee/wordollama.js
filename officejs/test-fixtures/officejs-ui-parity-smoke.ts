import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const legacyBaseline = JSON.parse(readFileSync(
  resolve(repoRoot, "officejs/test-fixtures/legacy-product-contracts.json"),
  "utf8",
)) as {
  agentPane: string[];
  settingsCapabilities: string[];
};
const html = readFileSync(resolve(repoRoot, "officejs/apps/addin/index.html"), "utf8");
const css = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/styles.css"), "utf8");
const taskpaneChrome = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/taskpane/TaskpaneChrome.tsx"),
  "utf8",
);
const agentWorkspace = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/taskpane/AgentWorkspace.tsx"),
  "utf8",
);
const reviewWorkspace = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/taskpane/ReviewWorkspace.tsx"),
  "utf8",
);
const contentWorkflows = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/taskpane/ContentWorkflows.tsx"),
  "utf8",
);
const translationWorkspace = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/taskpane/TranslationWorkspace.tsx"),
  "utf8",
);
const mediaWorkflows = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/taskpane/MediaWorkflows.tsx"),
  "utf8",
);
const legalWorkflows = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/taskpane/LegalWorkflows.tsx"),
  "utf8",
);
const utilityDialog = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/taskpane/UtilityDialog.tsx"),
  "utf8",
);
const taskpaneApp = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/taskpane/TaskpaneApp.tsx"),
  "utf8",
);
const taskpaneMarkup = `${html}\n${taskpaneApp}\n${taskpaneChrome}\n${contentWorkflows}\n${translationWorkspace}\n${mediaWorkflows}\n${legalWorkflows}\n${agentWorkspace}\n${reviewWorkspace}\n${utilityDialog}`
  .replaceAll("className=", "class=");
const compactTaskpaneMarkup = taskpaneMarkup.replace(/\s+/g, " ");
const settingsHtml = readFileSync(resolve(repoRoot, "officejs/apps/addin/settings.html"), "utf8");
const settingsApp = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/SettingsApp.tsx"), "utf8");
const setupAssistant = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/SetupAssistant.tsx"), "utf8");
const settingsDialogRpc = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/dialog-rpc.ts"), "utf8");
const runtimeClient = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/runtime-client.ts"), "utf8");
const updateStatus = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/update-status.ts"), "utf8");
const settingsCss = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/settings.css"), "utf8");
const settingsI18n = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/i18n.ts"), "utf8");
const settingsEnglish = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/locales/en-US.json"), "utf8");
const settingsChinese = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/locales/zh-CN.json"), "utf8");
const enLocale = JSON.parse(settingsEnglish) as { markdown?: Record<string, string> };
const zhLocale = JSON.parse(settingsChinese) as { markdown?: Record<string, string> };
const main = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/main.ts"), "utf8");
const activeModel = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/active-model.ts"), "utf8");
const manifest = readFileSync(resolve(repoRoot, "officejs/apps/addin/manifest.xml"), "utf8");
const wordAdapter = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/officejs-word-adapter.ts"),
  "utf8",
);

assert(
  settingsApp.includes("<SetupAssistantDialog") &&
    settingsApp.includes("<SetupHealthCenter") &&
    setupAssistant.includes("inspectSetup") &&
    setupAssistant.includes("runtime.fetchProviderModels") &&
    setupAssistant.includes("runtime.activateProvider"),
  "settings must keep the first-run guide and real diagnose/repair workflow",
);

assert(
  activeModel.includes('[model.trim(), provider.trim()]') &&
    main.includes("formatActiveModelLabel(") &&
    settingsApp.includes('className="settings-active-model"') &&
    settingsApp.includes("onProviderSettingsChange(view)") &&
    settingsApp.includes("formatActiveModelLabel(activeModel.model, activeModel.provider)") &&
    css.includes('.runtime-strip[data-state="connected"] { display: flex; }'),
  "the active model must stay visible as model · provider in both settings and the task pane",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Office.js UI parity smoke failed: ${message}`);
}

assert(
  translationWorkspace.includes('role="listbox"') &&
    translationWorkspace.includes('aria-controls="translation-source-language-options"') &&
    translationWorkspace.includes('aria-controls="translation-target-language-options"') &&
    !translationWorkspace.includes("<datalist"),
  "translation language selection must use the WPS-compatible searchable listbox instead of a native datalist",
);

for (const promptFieldId of [
  "agent-goal",
  "agent-requirement",
  "workflow-instruction",
  "workflow-prompt-content",
  "table-requirement",
  "translation-instructions",
  "translation-prompt-content",
  "html-app-prompt",
  "image-prompt",
  "custom-prompt-text",
  "review-instruction",
]) {
  assert(
    new RegExp(`<(?:input|textarea)[^>]*id="${promptFieldId}"[^>]*data-prompt-enhance`).test(compactTaskpaneMarkup),
    `prompt input ${promptFieldId} must expose the AI improve action`,
  );
}
assert(
  main.includes("initializePromptEnhancers()") &&
    main.includes("await runtime.chat([") &&
    main.includes('field.dispatchEvent(new Event("input"') &&
    css.includes(".prompt-enhance-button") &&
    settingsEnglish.includes('"promptEnhance"') &&
    settingsChinese.includes('"promptEnhance"'),
  "prompt improvement must call the active model, write back the result, and stay localized",
);

assert(
  html.includes('src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"'),
  "the real Word task pane must load Microsoft's Office.js runtime",
);

for (const originalContract of [
  "ChatTabItem",
  "IssuesTabItem",
  "ReviewTabItem",
  "btnCancelTask",
  "chatPanel",
  "txtInput",
  "suggestionList",
]) {
  assert(
    legacyBaseline.agentPane.includes(originalContract),
    `legacy product contract fixture lost Agent pane capability ${originalContract}`,
  );
}

function includesMigratedContract(contract: string): boolean {
  if (taskpaneMarkup.includes(contract)) return true;
  const generatedAcceptanceId = /^id="(golden|long-document|revision-host)-(confirm|run|copy|summary|output)"$/u.exec(
    contract,
  );
  if (!generatedAcceptanceId) return false;
  const [, kind, suffix] = generatedAcceptanceId;
  return (
    utilityDialog.includes(`kind="${kind}"`) &&
    utilityDialog.includes(`id={\`\${kind}-${suffix}\`}`)
  );
}

for (const migratedContract of [
  'id="surface-title"',
  'id="runtime-status"',
  'id="runtime-status-text"',
  'class="product-edition">WordOllama.JS',
  'data-tab="chat"',
  'data-tab="review"',
  'id="agent-stop"',
  'id="agent-output"',
  'id="agent-requirement"',
  'id="workflow-source-text"',
  'id="issue-list"',
  'id="review-batch-actions"',
  'id="tracked-revision-panel"',
  'id="refresh-tracked-revisions"',
  'id="accept-all-tracked-revisions"',
  'id="reject-all-tracked-revisions"',
  'id="tracked-revision-list"',
  'id="accept-all-suggestions"',
  'id="comment-all-suggestions"',
  'id="skip-all-suggestions"',
  'id="suggestion-list"',
  'id="settings-dialog"',
  'data-settings-panel="advanced"',
  'data-settings-panel="diagnostics"',
  'id="text-workflow-workspace"',
  'id="workflow-load-selection"',
  'id="workflow-generate"',
  'id="workflow-retry"',
  'id="workflow-replace"',
  'id="workflow-precise-revision"',
  'id="workflow-prompt-select"',
  'id="workflow-prompt-dialog"',
  'id="workflow-set-default-prompt"',
  'id="workflow-auto-apply"',
  'id="table-workflow-workspace"',
  'id="table-preview"',
  'id="table-insert"',
  'id="markdown-workflow-workspace"',
  'id="markdown-preview"',
  'id="markdown-insert"',
  'id="html-workflow-workspace"',
  'id="html-app-code"',
  'id="html-app-frame"',
  'id="html-app-library"',
  'id="image-workflow-workspace"',
  'id="image-file"',
  'id="image-preview"',
  'id="image-result"',
  'id="law-workflow-workspace"',
  'id="law-name"',
  'id="law-result"',
  'id="moot-workflow-workspace"',
  'id="moot-pleading-type"',
  'id="moot-result"',
  'id="custom-prompt-workspace"',
  'id="custom-prompt-list"',
  'id="custom-prompt-output"',
  'id="command-menu"',
  'id="agent-image-input"',
  'id="agent-image-preview"',
  'id="agent-image-remove"',
  'id="setting-diagnostic-logging"',
  'id="copy-diagnostic-log"',
  'id="agent-recovery"',
  'id="resume-agent-session"',
  'id="discard-agent-session"',
  'id="review-progress"',
  'id="review-progress-status"',
  'id="review-page-previous"',
  'id="review-page-next"',
  'id="review-page-status"',
  'id="golden-confirm"',
  'id="long-document-confirm"',
  'id="long-document-run"',
  'id="long-document-copy"',
  'id="long-document-summary"',
  'id="long-document-output"',
  'id="revision-host-confirm"',
  'id="revision-host-run"',
  'id="revision-host-copy"',
  'id="revision-host-output"',
  'id="compare-original-name"',
  'id="compare-revised-name"',
  'id="compare-analysis-status"',
  'id="compare-analysis"',
]) {
  assert(includesMigratedContract(migratedContract), `Office.js pane is missing ${migratedContract}`);
}

assert(
  legalWorkflows.includes('className="fieldset"') &&
    legalWorkflows.includes('className="fieldset-legend"') &&
    legalWorkflows.includes('className="label prompt-favorite-option"') &&
    legalWorkflows.includes('id="custom-prompt-manage" className="btn btn-outline btn-sm btn-square"') &&
    legalWorkflows.includes('id="custom-prompt-delete-selected" className="btn btn-error btn-outline btn-xs"') &&
    css.includes(":not(.checkbox):not(.toggle):not(.radio):not(.range)") &&
    css.includes("#custom-prompt-search.prompt-search-field {") &&
    css.includes("border: 0;") &&
    css.includes("--border: 1px;") &&
    css.includes("--line: #e4e4e7;") &&
    !css.includes("--border: #e4e4e7;") &&
    /setCustomPromptEditor\(prompt\);\r?\n  localizeStaticDocument\(\);/.test(main) &&
    legalWorkflows.includes('<span className="fieldset-legend" data-i18n="taskpane.prompts.name">') &&
    !legalWorkflows.includes("custom-prompt-category") &&
    !main.includes("prompt.category"),
  "My Commands must use DaisyUI fieldsets without legacy input styles stretching nested inputs or checkboxes",
);

assert(
  !reviewWorkspace.includes('id="tab-issues"') &&
    reviewWorkspace.includes('id="tab-review"') &&
    reviewWorkspace.includes('id="review-selection"') &&
    reviewWorkspace.includes('id="issue-list"') &&
    reviewWorkspace.includes('id="suggestion-list" className="empty-panel" hidden'),
  "issue scanning and suggestion review must share one review workspace",
);

assert(
  html.includes('id="taskpane-root"') &&
    main.includes('mountTaskpaneApp();') &&
    main.indexOf("mountTaskpaneApp();") < main.indexOf("localizeStaticDocument();") &&
    taskpaneApp.includes("flushSync") &&
    taskpaneApp.includes("createRoot(rootElement).render(<TaskpaneApp />)") &&
    taskpaneApp.includes("<TaskpaneChrome />") &&
    taskpaneApp.includes("<ContentWorkflows />") &&
    taskpaneApp.includes("<MediaWorkflows />") &&
    taskpaneApp.includes("<LegalWorkflows />") &&
    taskpaneApp.includes("<AgentWorkspace />") &&
    taskpaneApp.includes("<ReviewSurfaces />") &&
    taskpaneApp.includes("<UtilityDialog />"),
  "the complete React task pane must mount synchronously before localization and controller DOM binding",
);

for (const removedLegacySetting of [
  'data-settings-tab=',
  'id="setting-ai-mode"',
  'id="provider-profile-list"',
  'id="settings-skill-list"',
  'id="mcp-server-list"',
  'id="setting-agent-iterations"',
  'id="setting-markdown-tables"',
  'id="pairing-code"',
  'id="ollama-server-host"',
  'id="addin-version"',
]) {
  assert(!taskpaneMarkup.includes(removedLegacySetting), `legacy settings UI leaked into task pane: ${removedLegacySetting}`);
}

for (const removedDevelopmentCopy of [
  "对应现有 WordOllama",
  "迁移原版",
  "当前迁移状态以 UI parity matrix 为准",
  "WordOllama.JS 独立窗格",
  "生成结果会显示在这里",
  "结果将在这里显示",
  "完整 HTML 会显示在这里",
  "配对 Bridge 后刷新",
  "配对 Bridge 后载入",
  "保存后重启 Ollama 生效",
]) {
  assert(!taskpaneMarkup.includes(removedDevelopmentCopy), `user UI leaked redundant copy: ${removedDevelopmentCopy}`);
}
assert(
  main.includes("button.title = item.hint") &&
    settingsApp.includes("title={skill.description}") &&
    settingsApp.includes("title={tool.description}"),
  "long command, Skill and MCP descriptions must be available on demand instead of occupying pane space",
);
for (const focusedPaneTitle of [
  'writing: "taskpane.workflows.writing.title"',
  'modify: "taskpane.workflows.modify.title"',
  'polish: "taskpane.workflows.polish.title"',
  'translate: "taskpane.workflows.translate.title"',
  'risk: "taskpane.workflows.risk.title"',
  '"moot-court": "taskpane.moot.title"',
  '"law-search": "taskpane.law.title"',
  '"custom-prompts": "taskpane.prompts.title"',
]) {
  assert(main.includes(focusedPaneTitle), `focused pane title is missing: ${focusedPaneTitle}`);
}
assert(
  main.includes('message === i18n.t("taskpane.errors.selectionEmpty") || isBrowserPreview ? "" : message'),
  "an automatically empty selection must not occupy the pane with explanatory status copy",
);
assert(
  taskpaneMarkup.includes('<section id="workflow-output" class="card card-border generated-output task-panel task-output-panel" hidden>') &&
    main.includes('required<HTMLElement>("#workflow-output").hidden = !resultValue'),
  "generated text controls must stay hidden until a result exists",
);
assert(
  css.includes('[id$="-status"]:empty { display: none; }'),
  "empty status elements must not reserve vertical space",
);
for (const independentPane of [
  "WordOllama.JS.AgentPane",
  "WordOllama.JS.WritingPane",
  "WordOllama.JS.ModifyPane",
  "WordOllama.JS.ImagePane",
  "WordOllama.JS.TablePane",
  "WordOllama.JS.HtmlPane",
  "WordOllama.JS.MarkdownPane",
  "WordOllama.JS.PolishPane",
  "WordOllama.JS.ExpandPane",
  "WordOllama.JS.SimplifyPane",
  "WordOllama.JS.ContinuePane",
  "WordOllama.JS.SummarizePane",
  "WordOllama.JS.FixPane",
  "WordOllama.JS.TranslatePane",
  "WordOllama.JS.ComparePane",
  "WordOllama.JS.ReviewPane",
  "WordOllama.JS.RiskPane",
  "WordOllama.JS.FairnessPane",
  "WordOllama.JS.MootCourtPane",
  "WordOllama.JS.ContractComparePane",
  "WordOllama.JS.LawSearchPane",
  "WordOllama.JS.CustomPromptPane",
]) {
  assert(manifest.includes(`<TaskpaneId>${independentPane}</TaskpaneId>`), `manifest is missing independent pane ${independentPane}`);
}
assert(
  manifest.includes("<FunctionName>openSettingsDialog</FunctionName>") &&
    manifest.includes('DefaultValue="https://localhost:3000/settings.html"') &&
    !manifest.includes("<TaskpaneId>WordOllama.JS.SettingsPane</TaskpaneId>"),
  "settings must use a wide Office Dialog rather than another task pane",
);
assert(
  settingsHtml.includes('src="/src/settings/main.tsx"') &&
    settingsApp.includes('id: "skills"') &&
    settingsApp.includes('id: "mcp"') &&
    settingsApp.includes('t("nav.preferences")') &&
    settingsApp.includes('t("nav.extensions")') &&
    settingsApp.includes('t("nav.system")'),
  "the React settings dialog must separate Skills and MCP and group navigation",
);
assert(
  settingsApp.includes("<SettingsSaveContext.Provider") &&
    settingsApp.includes('className="settings-footer"') &&
    settingsApp.includes("hasUnsavedChanges") &&
    settingsApp.includes('t("common.saveAndClose")') &&
    settingsApp.includes('t("common.discardChanges")') &&
    settingsApp.includes("closeSettingsWindow()") &&
    settingsDialogRpc.includes('method: "settings.close"') &&
    main.includes('request.method === "settings.close"') &&
    main.includes("dialog.close()"),
  "settings must have one bottom save/close bar and a custom unsaved-changes close flow",
);
for (const settingsLayoutContract of [
  '@import "tailwindcss"',
  '@plugin "daisyui"',
  'name: "wordollama"',
  "--depth: 0",
  "width: min(820px, 100%)",
  "grid-template-columns: minmax(0, 1fr)",
  "background: var(--color-primary)",
  "color: var(--color-primary-content)",
  ".settings-mobile-nav-trigger",
  ".settings-sidebar.mobile-open .settings-nav-menu",
  "max-height: min(62vh, 460px)",
  ".settings-mobile-nav-backdrop",
  "@media (max-width: 760px)",
  ":where(button, input, select, textarea, summary):focus-visible",
]) {
  assert(settingsCss.includes(settingsLayoutContract), `settings visual system is missing: ${settingsLayoutContract}`);
}
assert(
  settingsApp.includes("mobileNavOpen") &&
    settingsApp.includes("setMobileNavOpen(false)") &&
    settingsApp.includes('aria-expanded={mobileNavOpen}'),
  "small settings windows must use a complete collapsible navigation menu",
);
assert(
  !settingsApp.includes('id="ai-mode"') &&
    !settingsApp.includes('id="output-language"') &&
    settingsApp.includes('id="output-preference"') &&
    settingsApp.includes("settings-memory-list") &&
    settingsApp.includes("selectedMemories") &&
    settingsApp.indexOf('id="output-preference"') < settingsApp.indexOf("function AgentPage()"),
  "general settings must own structured memories and output preferences without legacy AI controls",
);
assert(
  [...css.matchAll(/box-shadow:\s*([^;]+);/gu)].every((match) =>
    /^none(?:\s*!important)?$/u.test(match[1]?.trim() ?? "")
  ) &&
    css.includes('name: "wordollama-taskpane"') &&
    css.includes('@import "tailwindcss" source(none)') &&
    css.includes('@plugin "daisyui"') &&
    css.includes("--depth: 0") &&
    css.includes("box-shadow: none !important") &&
    settingsCss.includes("box-shadow: none !important"),
  "cards and controls must remain flat; box shadows are not part of the Word UI system",
);
assert(
  settingsI18n.includes("Office.context?.displayLanguage") &&
    settingsI18n.includes('fallbackLng: "en-US"') &&
    settingsEnglish.includes('"preferences": "Preferences"') &&
    settingsChinese.includes('"preferences": "偏好"') &&
    !/[\u3400-\u9fff]/u.test(settingsApp),
  "React settings copy must come from Office-aware en-US/zh-CN i18n resources",
);
assert(
  main.includes('new URL("/settings.html", window.location.origin)') &&
    main.includes('"#open-settings").addEventListener("click", openReactSettingsDialog)'),
  "the task-pane Settings button must open the React Office Dialog instead of the legacy inline panel",
);
assert(
  settingsApp.includes("runtime.autoPair()") &&
    settingsApp.includes("if (!runtime.hasPairing()) await runtime.autoPair()") &&
    setupAssistant.includes("runtime.clearPairing()") &&
    setupAssistant.includes("await runtime.autoPair()") &&
    setupAssistant.includes("await inspectSetup(runtime)") &&
    main.includes("if (!runtime.hasPairing()) await runtime.autoPair()") &&
    main.includes("runtime.registerOfficeTools(tools.list())"),
  "the trusted local add-in must automatically pair with Desktop Bridge and register Word tools",
);
for (const translationControl of [
  'id="translation-source"',
  'id="translation-result"',
  'id="translation-source-language"',
  'id="translation-target-language"',
  'id="translation-swap-languages"',
  'id="translation-replace"',
  'id="translation-insert"',
  'id="translation-retry"',
  'id="translation-precise-revision"',
  'id="translation-prompt-select"',
  'id="translation-prompt-dialog"',
  'id="translation-manage-prompts"',
]) {
  assert(
    taskpaneMarkup.includes(translationControl),
    `the dedicated translation workspace must provide ${translationControl}`,
  );
}
assert(
  settingsDialogRpc.includes('method: "word.listStyles"') &&
    settingsDialogRpc.includes('method: "word.createParagraphStyle"') &&
    main.includes("result = await word.listStyles()") &&
    main.includes("await word.createParagraphStyle(request.name)") &&
    main.includes("dialog.messageChild(JSON.stringify"),
  "the React settings dialog must round-trip Word style requests through its parent task pane",
);
for (const focusedRoute of [
  "surface=agent&amp;workflow=agent",
  "surface=create&amp;workflow=writing",
  "surface=edit&amp;workflow=polish",
  "surface=review&amp;workflow=review",
  "surface=legal&amp;workflow=law-search",
]) {
  assert(manifest.includes(focusedRoute), `manifest is missing focused route ${focusedRoute}`);
}
assert(
  !manifest.includes("<TaskpaneId>WordOllama.JS.Taskpane</TaskpaneId>"),
  "all commands must not reuse the old monolithic task pane",
);
assert(
  manifest.includes('<CustomTab id="WordOllama.JS.Tab">') &&
    manifest.includes('<bt:String id="Tab.Label" DefaultValue="WordOllama.JS" />') &&
    !manifest.includes('<OfficeTab id="TabHome">'),
  "Office.js commands must use a distinct WordOllama.JS tab instead of being mixed into Home or COM WordOllama",
);

for (const settingsBaseline of ["OllamaMode", "ChatGPTMode", "SkillDataGrid", "McpServerDataGrid", "AgentMaxIterationsBox"]) {
  assert(
    legacyBaseline.settingsCapabilities.includes(settingsBaseline),
    `legacy product contract fixture lost settings capability ${settingsBaseline}`,
  );
}

assert(
  taskpaneApp.includes("<UtilityDialog />") &&
    utilityDialog.includes('<dialog id="settings-dialog"') &&
    utilityDialog.includes("<ComparePanel />") &&
    utilityDialog.includes("<DiagnosticsPanel />"),
  "diagnostic/compare utility dialog is missing",
);
for (const diagnosticId of [
  'id="compare-run"',
  'id="golden-run"',
]) {
  assert(
    includesMigratedContract(diagnosticId) && utilityDialog.includes("function UtilityDialog()"),
    `${diagnosticId} must stay in the utility dialog instead of the primary Agent pane`,
  );
}

for (const styleContract of [
  '[hidden] { display: none !important; }',
  "overflow-x: hidden;",
  ".main-tabs",
  ".chat-thread",
  ".issue-list",
  ".review-item",
  ".severity-badge",
  ".chat-bubble",
  ".composer",
  ".settings-dialog",
  ".human-prompt-dialog",
  ':root[data-standalone-dialog="true"] .settings-dialog',
]) {
  assert(css.includes(styleContract), `missing visual contract ${styleContract}`);
}
assert(!/body\s*\{[^}]*min-width:\s*320px/.test(css), "the real Word task pane must not force a 320px viewport");
assert(
  /body\s*\{[^}]*font-size:\s*12px[^}]*line-height:\s*1\.5/.test(css),
  "task-pane DaisyUI controls must inherit the compact 12px Word UI type scale",
);
assert(
  !manifest.includes("WordOllama.JS.DiagnosticsPane") &&
    !manifest.includes('id="Diagnostics.Url"'),
  "diagnostics must stay out of the release Ribbon and remain available through advanced settings",
);
assert(
  css.includes(".agent-shell .btn {") &&
    css.includes(".agent-shell .btn-sm { font-size: 11px; }") &&
    css.includes(".agent-shell .btn-xs { font-size: 10px; }"),
  "task-pane DaisyUI buttons must follow the compact body, small, and extra-small type scale",
);
assert(
  /\.composer textarea\s*\{[^}]*min-width:\s*0/.test(css),
  "the Agent composer must shrink inside a narrow Word task pane",
);
assert(
  /\.agent-shell\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/.test(css),
  "the Agent shell must fit the real Word task-pane viewport",
);
assert(
  /\.chat-thread\s*\{[^}]*min-height:\s*0/.test(css),
  "the chat thread must yield vertical space so the composer remains visible",
);
assert(
  main.includes('actions.className = "action-row wrap"') &&
    css.includes(".action-row.wrap { flex-wrap: wrap; }"),
  "the three-choice Agent permission prompt must wrap in a narrow task pane",
);
assert(
  !css.includes("@media (prefers-color-scheme: dark)"),
  "the default pane must match the light VSTO baseline even when Office uses a dark shell",
);
assert(
  css.includes(':root[data-theme="dark"]') &&
    css.includes("--color-base-100: #1d1d1f;") &&
    css.includes("--color-base-content: #f4f4f5;") &&
    css.includes(':root[data-theme="dark"] button.secondary-button') &&
    css.includes(':root[data-theme="dark"] button.danger-button'),
  "dark task-pane controls must use the dark DaisyUI palette instead of light component defaults",
);
assert(
  css.includes("--accent: #185abd;") &&
    css.includes("--accent-hover: #0f4c9c;") &&
    css.includes("background: linear-gradient(145deg, #2b7cd3, #185abd);"),
  "the Office.js UI must use the Word blue and white visual system",
);
assert(
  css.includes(':root[data-surface="create"] .workflow-workspace-header') &&
    css.includes(':root[data-surface="edit"] .workflow-workspace-header') &&
    css.includes(':root[data-surface="legal"] .workflow-workspace-header'),
  "focused task panes must not repeat their page title inside the workspace",
);
assert(
  main.includes("runtime.getProviderRuntime()") &&
    main.includes('window.addEventListener("focus"') &&
    main.includes('document.addEventListener("visibilitychange"') &&
    main.includes("UI_LOCALE_STORAGE_KEY") &&
    main.includes("setUiLocalePreference(preference)") &&
    main.includes('runtimeStatus.dataset.state = "connected"'),
  "the task pane must refresh and display the actually running Provider/model instead of relying on static labels",
);
for (const interactionContract of [
  "requestDecision(",
  "requestPermissionDecision(",
  "buildPermissionScopeKey(",
  'decision === "agent-run"',
  'decision !== "deny"',
  "requestHumanInput(",
  "requestConfirmation(",
  "showCopyFallback(",
  "runLongDocumentMatrix(",
  "runRevisionHostMatrix(",
  "analyzeCompareChanges(",
  "renderCompareAnalysis(",
  "new OfficeLongDocumentHost(word)",
  "runtime.confirmAgentPlan",
  "runtime.submitPermission",
  "runtime.cancelAgent",
  "runtime.listAgentRecoveries(",
  'activateTab("chat")',
  "generateReviewIssues(",
  "generateReviewSuggestions(",
  "word.focusReviewTarget",
  "word.commentReviewTarget",
  "performSuggestionAction(",
  "assertSuggestionTargetUnchanged(",
  "word.insertAfterSelection(",
  "configureSilentLinter(",
  "findChangedParagraphs(",
  "appendDiagnostic(",
  "markdownToBlocks(",
  "word.insertStyledHtmlBlocksAtSelection(",
  "word.listStyles(",
  "word.createParagraphStyle(",
  "word.resolveReviewParagraph(",
  "word.applyReviewSuggestionsBatch(",
  "word.listTrackedRevisions(",
  "word.applyTrackedRevision(",
  "word.applyAllTrackedRevisions(",
  "successfulWordWrites",
  "taskpane.agent.encryptedRecovery",
  "settings.suppressDiff",
  "restoreReviewState(",
  "buildReviewChunks(",
  "runtime.listSkills(",
  "selectedAgentSkillName",
  "skillName,",
  "word.applyPreciseRevision(",
  "loadTextPromptPresets(",
  "saveTextPromptPresets(",
  'activeSurface === "review"',
  "wordollama-review-handoff-v1",
  "allowExternalTools:",
  "allowLocalTools:",
  "allowNetworkTools:",
  "allowMcpTools:",
  "openTextWorkflow(",
  "generateTextWorkflow(",
  "assertTextWorkflowSelectionUnchanged(",
  "applyAutomaticTextWorkflowResult(",
  "generateStructuredTable(",
  "word.insertStructuredTable(",
  "markdownToHtml(",
  "generateHtmlApp(",
  "buildSandboxedPreview(",
  "saveHtmlLibrary(",
  "readImageDataUrl(",
  "analyzeImage(",
  "runtime.searchLawArticle(",
  "investigatePleading(",
  "loadCustomPrompts(",
  "runCustomPrompt(",
  "renderCommandMenu(",
  "setAgentImage(",
  "clearAgentImage(",
  "restoreAgentImage(",
  "planRevisionRequested",
  "saveAgentRecovery(",
  "offerAgentRecovery(",
  "consumeAgentSession(",
  "runtime.getAgentCheckpoint(",
  "regenerateSuggestion(",
  "runtime.getReviewSettings(",
  "runtime.saveReviewSettings(",
  "imageDataUrl: imageDataUrl || undefined",
  'label: "/clear"',
  'label: "/new"',
  'label: "/goal"',
  'label: "/selection"',
  'label: "/skills"',
  'label: "/status"',
  'refreshAgentSkillsInBackground',
]) {
  assert(main.includes(interactionContract), `missing migrated interaction ${interactionContract}`);
}

for (const settingsInteractionContract of [
  "runtime.fetchProviderModels(",
  "runtime.saveProviderProfile(",
  "runtime.activateProvider(",
  "runtime.deleteProvider(",
  "runtime.loadOllamaModel(",
  "runtime.listSkills(",
  "runtime.readSkill(",
  "runtime.importSkill(",
  "runtime.deleteSkill(",
  "runtime.saveMcpServer(",
  "runtime.importMcpJson(",
  "runtime.connectMcpServer(",
  "runtime.disconnectMcpServer(",
  "runtime.saveMcpPermissions(",
  "runtime.authorizeGoogleProvider(",
  "runtime.checkForUpdates(",
  "runtime.installUpdate(",
]) {
  assert(
    settingsApp.includes(settingsInteractionContract),
    `React settings is missing migrated interaction ${settingsInteractionContract}`,
  );
}
assert(
  !taskpaneMarkup.includes('id="translation-save-prompt"') &&
    !taskpaneMarkup.includes('id="translation-set-default-prompt"') &&
    !taskpaneMarkup.includes('id="translation-auto-apply"'),
  "translation prompt management must not expose quick-save, default-prompt, or automatic document modification controls",
);
assert(
  !settingsApp.includes("getOllamaServerSettings") &&
    !settingsApp.includes("saveOllamaServerSettings") &&
    !settingsApp.includes('t("advanced.ollama")'),
  "the add-in must leave Ollama server configuration to Ollama instead of exposing it in settings",
);
assert(
  settingsApp.includes('t("skills.preview")') &&
    settingsApp.includes("settings-skill-preview-modal") &&
    settingsApp.includes("markdownToHtml(preview.content") &&
    settingsApp.includes("renderFrontMatter: true") &&
    settingsCss.includes(".settings-skill-preview .markdown-frontmatter") &&
    runtimeClient.includes('"/skills/read"'),
  "installed Skills must expose a full rendered SKILL.md preview with YAML front matter",
);
assert(
  settingsApp.includes("const changeLocale = async") &&
    settingsApp.includes("await setUiLocalePreference(value)") &&
    settingsApp.includes("void changeLocale(value)") &&
    settingsChinese.includes('"uiLanguage": "界面语言 / Language"') &&
    settingsEnglish.includes('"uiLanguage": "Language / 界面语言"'),
  "the settings language selector must switch immediately and remain identifiable bilingually",
);
assert(
  settingsApp.includes("function FilePicker(") &&
    settingsApp.includes('t("common.chooseFile")') &&
    settingsApp.includes('t("common.noFileChosen")') &&
    settingsApp.includes("translatedStatus(fallbackKey, undefined, true)") &&
    settingsCss.includes(".settings-file-picker-input") &&
    settingsEnglish.includes('"chooseFile": "Choose file"'),
  "settings file inputs and persistent statuses must follow the selected UI language",
);
assert(
  !settingsApp.includes("runtime.pullOllamaModel(") &&
    !settingsApp.includes("runtime.deleteOllamaModel(") &&
    !settingsApp.includes('t("models.profiles")') &&
    !settingsApp.includes('t("models.connectionTest")') &&
    !settingsApp.includes('t("models.sendTest")') &&
    !settingsApp.includes("streamText(") &&
    !settingsApp.includes('t("models.downloadModel")') &&
    !settingsApp.includes('t("models.clearKey")') &&
    settingsApp.includes("settings-saved-model-list") &&
    settingsApp.includes("settings-model-editor-modal") &&
    settingsApp.includes('t("models.addModel")') &&
    settingsApp.includes('t("models.details")') &&
    settingsApp.includes('t("models.switch")'),
  "model settings must manage saved configurations through a list and editable modal without managing Ollama files",
);
for (const providerBase of [
  "https://api.openai.com/v1",
  "https://api.deepseek.com",
  "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "https://ark.cn-beijing.volces.com/api/v3",
  "https://open.bigmodel.cn/api/paas/v4",
  "https://api.moonshot.cn/v1",
  "https://api.siliconflow.cn/v1",
  "https://api.minimaxi.chat/v1",
  "https://api.anthropic.com/v1",
  "https://generativelanguage.googleapis.com/v1beta",
]) {
  assert(settingsApp.includes(providerBase), `model settings is missing provider API base ${providerBase}`);
}
assert(
  updateStatus.includes("!result.configured") &&
    updateStatus.includes("result.updateAvailable && !result.artifact") &&
    settingsApp.includes('"updates.notConfigured"') &&
    settingsApp.includes('"updates.noArtifact"'),
  "the update page must distinguish an unconfigured source and a missing platform installer",
);
assert(
  settingsApp.includes("settings-update-confirmation") &&
    settingsApp.includes("update.artifact.publisherSubject") &&
    settingsApp.includes('t("updates.confirmInstall")') &&
    !settingsApp.includes("window.confirm("),
  "signed installer launch must use an in-page publisher confirmation instead of a native dialog",
);
assert(
  settingsApp.includes("runtime.getUpdateRollbackStatus()") &&
    settingsApp.includes("runtime.rollbackUpdate()") &&
    settingsApp.includes('t("updates.rollbackConfirmation"') &&
    settingsApp.includes('t("updates.confirmRollback")') &&
    runtimeClient.includes('async getUpdateRollbackStatus(): Promise<UpdateRollbackStatus>') &&
    runtimeClient.includes('async rollbackUpdate(): Promise<UpdateRollbackResult>') &&
    runtimeClient.includes('settingsRequest("/updates/rollback", { method: "POST" })'),
  "the update page must expose a validated, confirmed platform rollback flow",
);
assert(
  settingsApp.includes('["unorderedList", "unorderedList"]') &&
    settingsApp.includes('["orderedList", "orderedList"]') &&
    settingsApp.includes('value="footnote"') &&
    settingsApp.includes('value="endnote"') &&
    !settingsApp.includes('t("markdown.conversion")') &&
    !settingsApp.includes("createWordParagraphStyle") &&
    zhLocale.markdown?.unorderedList === "无序列表" &&
    zhLocale.markdown?.orderedList === "有序列表" &&
    enLocale.markdown?.unorderedList === "Bulleted list" &&
    enLocale.markdown?.orderedList === "Numbered list",
  "Markdown settings must keep list style mappings, native note placement, and no conversion toggles or style creator",
);

assert(wordAdapter.includes("async insertAfterSelection("), "selection suggestions need a safe insert-after implementation");
assert(
  wordAdapter.includes("resolveReviewAnchorIndex("),
  "review actions must resolve stable anchors instead of trusting stale paragraph indexes",
);
assert(
  wordAdapter.includes("this.askHumanHandler") && !wordAdapter.includes("globalThis.prompt"),
  "ask_human must use an in-pane handler because Word WebView does not reliably support window.prompt",
);
for (const [name, source] of [
  ["settings", settingsApp],
  ["setup assistant", setupAssistant],
  ["content workflows", contentWorkflows],
  ["translation", translationWorkspace],
  ["custom prompts", legalWorkflows],
] as const) {
  const dialogCount = [...source.matchAll(/<dialog\b/gu)].length;
  const modalDialogCount = [...source.matchAll(/<dialog\b[^>]*className="[^"]*\bmodal\b/gu)].length;
  const modalBoxCount = [...source.matchAll(/className="modal-box\b/gu)].length;
  assert(
    dialogCount === modalDialogCount && dialogCount === modalBoxCount,
    `${name} dialogs must use an outer modal with one inner modal-box`,
  );
  assert(
    !/<dialog\b[^>]*className="[^"]*\bmodal-box\b/gu.test(source),
    `${name} must not apply modal-box directly to a dialog element`,
  );
}
assert(
  main.includes('dialog.className = "human-prompt-dialog"') &&
    main.includes('dialog.className = "human-prompt-dialog copy-fallback-dialog"') &&
    !main.includes('dialog.className = "modal-box human-prompt-dialog') &&
    [...main.matchAll(/document\.createElement\("dialog"\)/gu)].length === 3 &&
    css.includes(".human-prompt-dialog {") &&
    css.includes("opacity: 1;") &&
    css.includes("scale: 1;"),
  "native ask_human dialogs must remain visible instead of inheriting DaisyUI modal-box opacity",
);
assert(
  !main.includes("window.confirm(") && !main.includes("window.prompt("),
  "Word task panes must not depend on unsupported native confirm/prompt dialogs",
);

console.log("Office.js WordOllama UI parity smoke passed (Agent, unified review, and diagnostics separation).");
