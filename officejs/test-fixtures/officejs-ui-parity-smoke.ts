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
const settingsHtml = readFileSync(resolve(repoRoot, "officejs/apps/addin/settings.html"), "utf8");
const settingsApp = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/SettingsApp.tsx"), "utf8");
const settingsDialogRpc = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/dialog-rpc.ts"), "utf8");
const updateStatus = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/update-status.ts"), "utf8");
const settingsCss = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/settings.css"), "utf8");
const settingsI18n = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/i18n.ts"), "utf8");
const settingsEnglish = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/locales/en-US.json"), "utf8");
const settingsChinese = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/settings/locales/zh-CN.json"), "utf8");
const enLocale = JSON.parse(settingsEnglish) as { markdown?: Record<string, string> };
const zhLocale = JSON.parse(settingsChinese) as { markdown?: Record<string, string> };
const main = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/main.ts"), "utf8");
const manifest = readFileSync(resolve(repoRoot, "officejs/apps/addin/manifest.xml"), "utf8");
const wordAdapter = readFileSync(
  resolve(repoRoot, "officejs/apps/addin/src/officejs-word-adapter.ts"),
  "utf8",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Office.js UI parity smoke failed: ${message}`);
}

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
  'data-tab="issues"',
  'data-tab="review"',
  'id="agent-stop"',
  'id="agent-output"',
  'id="agent-requirement"',
  'id="workflow-apply-default"',
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
  'id="workflow-replace"',
  'id="workflow-comment"',
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
  'id="compare-review-list"',
  'id="compare-apply-confirm"',
  'id="compare-apply"',
  'id="compare-apply-status"',
]) {
  assert(includesMigratedContract(migratedContract), `Office.js pane is missing ${migratedContract}`);
}

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
  taskpaneMarkup.includes('<section id="workflow-output" class="generated-output" hidden>') &&
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
  "WordOllama.JS.EditPane",
  "WordOllama.JS.TranslatePane",
  "WordOllama.JS.ComparePane",
  "WordOllama.JS.ReviewPane",
  "WordOllama.JS.LegalPane",
  "WordOllama.JS.MootCourtPane",
  "WordOllama.JS.LawSearchPane",
  "WordOllama.JS.CustomPromptPane",
  "WordOllama.JS.DiagnosticsPane",
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
for (const settingsLayoutContract of [
  '@import "tailwindcss"',
  '@plugin "daisyui"',
  'name: "wordollama"',
  "--depth: 0",
  "grid-template-columns: minmax(260px, .75fr) minmax(480px, 1.45fr)",
  "background: var(--color-primary)",
  "color: var(--color-primary-content)",
  ".settings-sidebar > div > .grid",
  "display: contents",
  "overflow-y: hidden",
  "scrollbar-width: none",
]) {
  assert(settingsCss.includes(settingsLayoutContract), `settings visual system is missing: ${settingsLayoutContract}`);
}
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
    settingsApp.includes('t("advanced.automaticPairing")') &&
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
  "surface=diagnostics&amp;workflow=diagnostics",
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
  "buildCompareReviewItems(",
  "word.applyCompareChangesBatch(",
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
  "word.beginTrackedChanges(",
  "word.restoreTrackedChanges(",
  "resolveTextWorkflowOutputMode(",
  'activeSurface === "review"',
  "wordollama-review-handoff-v1",
  "allowExternalTools:",
  "openTextWorkflow(",
  "generateTextWorkflow(",
  "assertTextWorkflowSelectionUnchanged(",
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
  'label: "/newchat"',
  'label: "/review"',
  'label: "/refreshskills"',
  'loadReviewScope("selection")',
]) {
  assert(main.includes(interactionContract), `missing migrated interaction ${interactionContract}`);
}

for (const settingsInteractionContract of [
  "runtime.listProviderModels(",
  "runtime.saveProviderProfile(",
  "runtime.testProvider(",
  "runtime.activateProvider(",
  "runtime.deleteProvider(",
  "runtime.pullOllamaModel(",
  "runtime.loadOllamaModel(",
  "runtime.deleteOllamaModel(",
  "runtime.listSkills(",
  "runtime.importSkill(",
  "runtime.deleteSkill(",
  "runtime.saveMcpServer(",
  "runtime.connectMcpServer(",
  "runtime.disconnectMcpServer(",
  "runtime.saveMcpPermissions(",
  "runtime.getOllamaServerSettings(",
  "runtime.saveOllamaServerSettings(",
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
  updateStatus.includes("!result.configured") &&
    updateStatus.includes("result.updateAvailable && !result.artifact") &&
    settingsApp.includes('t("updates.notConfigured")') &&
    settingsApp.includes('t("updates.noArtifact")'),
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
  settingsApp.includes('["unorderedList", "unorderedList"]') &&
    settingsApp.includes('["orderedList", "orderedList"]') &&
    zhLocale.markdown?.unorderedList === "无序列表" &&
    zhLocale.markdown?.orderedList === "有序列表" &&
    enLocale.markdown?.unorderedList === "Bulleted list" &&
    enLocale.markdown?.orderedList === "Numbered list",
  "Markdown settings must expose separate ordered and unordered list style controls",
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
assert(
  !main.includes("window.confirm(") && !main.includes("window.prompt("),
  "Word task panes must not depend on unsupported native confirm/prompt dialogs",
);

console.log("Office.js WordOllama UI parity smoke passed (Agent, chat, issues, review, diagnostics separation). ");
