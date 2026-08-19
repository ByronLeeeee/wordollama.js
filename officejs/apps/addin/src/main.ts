import "./styles.css";
import {
  SHARED_RUNTIME_NAVIGATION_EVENT,
  type SharedRuntimeRoute,
} from "./commands";
import {
  ADDIN_VERSION,
  BRIDGE_PROTOCOL_VERSION,
  type ReleaseTestIdentity,
} from "./contracts";
import {
  OfficeJsWordAdapter,
  type TrackedRevision,
} from "./officejs-word-adapter";
import { WpsWordAdapter } from "./wps-word-adapter";
import { isWpsHost } from "./wps-host";
import { OfficeJsToolRegistry } from "./officejs-tool-registry";
import { OfficeGoldenHostHarness, runOfficeGoldenMatrix } from "./officejs-golden-runner";
import {
  OfficeLongDocumentHost,
  runLongDocumentMatrix,
} from "./officejs-long-document-runner";
import {
  OfficeRevisionHost,
  runRevisionHostMatrix,
} from "./officejs-revision-runner";
import {
  analyzeCompareChanges,
  fileToBase64,
  formatCompareSummary,
  validateCompareFiles,
} from "./document-compare";
import { RuntimeClient } from "./runtime-client";
import { formatActiveModelLabel } from "./active-model";
import type {
  PairResponse,
  LawArticleResult,
  ToolCatalogResponse,
} from "./contracts";
import {
  generateReviewIssues,
  generateReviewSuggestions,
  type ReviewIssue,
  type ReviewSuggestion,
} from "./review-workspace";
import {
  generateTextWorkflow,
  resolveTextWorkflowOutputPreference,
  TEXT_WORKFLOWS,
  type TextWorkflowDefinition,
} from "./text-workflow";
import {
  createTextPromptPreset,
  loadTextPromptPresets,
  saveTextPromptPresets,
  type TextPromptPreset,
} from "./text-prompt-presets";
import {
  loadTextWorkflowPreferences,
  saveTextWorkflowPreferences,
  workflowPreference,
} from "./text-workflow-preferences";
import {
  generateStructuredTable,
  type StructuredTable,
} from "./table-workflow";
import {
  markdownToBlocks,
  markdownToHtml,
  type MarkdownConversionOptions,
} from "./markdown-workflow";
import {
  buildMarkdownStyleMappings,
  DEFAULT_MARKDOWN_SETTINGS,
  type MarkdownSettings,
} from "./markdown-settings";
import {
  buildSandboxedPreview,
  generateHtmlApp,
  loadHtmlLibrary,
  normalizeHtmlDocument,
  saveHtmlLibrary,
  type SavedHtmlApp,
} from "./html-workflow";
import {
  analyzeImage,
  readImageDataUrl,
} from "./image-workflow";
import {
  formatLawArticle,
  investigatePleading,
  type PleadingType,
} from "./legal-workflows";
import {
  loadCustomPrompts,
  runCustomPrompt,
  saveCustomPrompts,
  type CustomPromptDefinition,
  type CustomPromptOutputMode,
} from "./custom-prompts";
import { findChangedParagraphs } from "./silent-linter";
import {
  buildReviewChunks,
  createReviewAnchors,
  normalizeReviewText,
  type ReviewAnchor,
} from "./review-anchor";
import i18n, {
  setUiLocalePreference,
  UI_LOCALE_STORAGE_KEY,
  type UiLocalePreference,
} from "./i18n";
import { mountTaskpaneApp } from "./taskpane/TaskpaneApp";
import { PAIRING_SESSION_STORAGE_KEY } from "./pairing-session";
import { initializeTranslationWorkspace } from "./translation-workspace";
import {
  beginStreamingText,
  endStreamingText,
  updateStreamingText,
} from "./streaming-ui";
import {
  buildPermissionScopeKey,
  formatPermissionParams,
} from "./permission-scope";

type AddinSurface = "agent" | "create" | "edit" | "review" | "legal" | "settings" | "diagnostics" | "compare";

const wpsHost = isWpsHost();
if (wpsHost) {
  document.documentElement.dataset.host = "wps";
}

const routeParams = new URLSearchParams(window.location.search);
let requestedSurface = routeParams.get("surface");
let requestedWorkflow = routeParams.get("workflow");
let activeSurface: AddinSurface = (
  requestedSurface === "create" ||
  requestedSurface === "edit" ||
  requestedSurface === "review" ||
  requestedSurface === "legal" ||
  requestedSurface === "settings" ||
  requestedSurface === "diagnostics" ||
  requestedSurface === "compare"
) ? requestedSurface : "agent";
document.documentElement.dataset.surface = activeSurface;
if (requestedWorkflow && requestedWorkflow !== "agent") {
  document.documentElement.dataset.routePending = "true";
}
if (activeSurface === "settings" || activeSurface === "diagnostics" || activeSurface === "compare") {
  document.documentElement.dataset.standaloneDialog = "true";
}

mountTaskpaneApp();

function localizeStaticDocument(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = i18n.t(element.dataset.i18n!);
  }
  const localizedAttributes = [
    ["data-i18n-placeholder", "placeholder"],
    ["data-i18n-aria-label", "aria-label"],
    ["data-i18n-title", "title"],
    ["data-i18n-alt", "alt"],
    ["data-i18n-value", "value"],
  ] as const;
  for (const [dataAttribute, targetAttribute] of localizedAttributes) {
    for (const element of document.querySelectorAll<HTMLElement>(`[${dataAttribute}]`)) {
      const key = element.getAttribute(dataAttribute);
      if (key) element.setAttribute(targetAttribute, i18n.t(key));
    }
  }
}

localizeStaticDocument();
i18n.on("languageChanged", () => {
  localizeStaticDocument();
  localizePromptEnhancers();
  if (activeTextWorkflow) {
    renderWorkflowPromptSelect(required<HTMLSelectElement>("#workflow-prompt-select").value);
    renderWorkflowPromptList();
    syncTextWorkflowPreferenceUi();
  }
  void refreshRuntimeStatus();
});

const word = wpsHost
  ? new WpsWordAdapter(requestHumanInput)
  : new OfficeJsWordAdapter(requestHumanInput);
const tools = new OfficeJsToolRegistry(word);
const runtime = new RuntimeClient();

type PromptEnhanceField = HTMLInputElement | HTMLTextAreaElement;

function localizePromptEnhancers(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".prompt-enhance-button")) {
    const label = button.querySelector<HTMLElement>(".prompt-enhance-label");
    const text = button.dataset.loading === "true"
      ? i18n.t("taskpane.promptEnhance.optimizing")
      : i18n.t("taskpane.promptEnhance.action");
    if (label) label.textContent = text;
    button.title = i18n.t("taskpane.promptEnhance.title");
    button.setAttribute("aria-label", button.title);
  }
}

async function enhancePrompt(field: PromptEnhanceField, button: HTMLButtonElement): Promise<void> {
  const prompt = field.value.trim();
  if (!prompt) {
    showError(new Error(i18n.t("taskpane.promptEnhance.required")));
    field.focus();
    return;
  }

  clearError();
  button.disabled = true;
  button.dataset.loading = "true";
  localizePromptEnhancers();
  try {
    if (!runtime.hasPairing()) await activateBridgeSession();
    const maxLength = field.maxLength > 0 ? field.maxLength : 20_000;
    const result = await runtime.chat([
      {
        role: "system",
        content: i18n.t("taskpane.promptEnhance.system"),
      },
      {
        role: "user",
        content: i18n.t("taskpane.promptEnhance.request", { prompt, maxLength }),
      },
    ]);
    const enhanced = result.content.trim();
    if (!enhanced) throw new Error(i18n.t("taskpane.promptEnhance.empty"));
    if (enhanced.length > maxLength) {
      throw new Error(i18n.t("taskpane.promptEnhance.tooLong", { maxLength }));
    }
    field.value = enhanced;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.focus();
    field.setSelectionRange(enhanced.length, enhanced.length);
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
    delete button.dataset.loading;
    localizePromptEnhancers();
  }
}

function initializePromptEnhancers(): void {
  for (const field of document.querySelectorAll<PromptEnhanceField>("[data-prompt-enhance]")) {
    if (field.parentElement?.classList.contains("prompt-enhance-field")) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "prompt-enhance-field";
    field.before(wrapper);
    wrapper.append(field);

    const button = document.createElement("button");
    button.className = "btn btn-ghost btn-xs prompt-enhance-button";
    button.type = "button";
    const icon = document.createElement("span");
    icon.className = "prompt-enhance-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "✨";
    const label = document.createElement("span");
    label.className = "prompt-enhance-label";
    button.append(icon, label);
    button.addEventListener("click", () => void enhancePrompt(field, button));
    wrapper.append(button);
  }
  localizePromptEnhancers();
}

initializePromptEnhancers();

async function getReleaseTestIdentity(): Promise<ReleaseTestIdentity> {
  try {
    const health = await runtime.health();
    return {
      addinVersion: ADDIN_VERSION,
      bridgeVersion: health.bridgeVersion,
      protocolVersion: health.protocolVersion,
    };
  } catch {
    return {
      addinVersion: ADDIN_VERSION,
      bridgeVersion: "unavailable",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    };
  }
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(i18n.t("taskpane.errors.missingElement", { selector }));
  return element;
}

const hostStatus = required<HTMLSpanElement>("#host-status");
const runtimeStatus = required<HTMLElement>("#runtime-status");
const runtimeStatusText = required<HTMLSpanElement>("#runtime-status-text");
const agentOutput = required<HTMLDivElement>("#agent-output");
const emptyChatState = required<HTMLDivElement>("#empty-chat-state");
const agentRequirement = required<HTMLTextAreaElement>("#agent-requirement");
const agentGoal = required<HTMLInputElement>("#agent-goal");
const agentGoalRow = required<HTMLDivElement>("#agent-goal-row");
const toggleAgentGoal = required<HTMLButtonElement>("#toggle-agent-goal");
const agentRunButton = required<HTMLButtonElement>("#agent-run");
const agentUndoTaskButton = required<HTMLButtonElement>("#agent-undo-task");
const agentImageInput = required<HTMLInputElement>("#agent-image-input");
const agentImagePreview = required<HTMLDivElement>("#agent-image-preview");
const agentImagePreviewImage = required<HTMLImageElement>("#agent-image-preview-img");
const agentStopButton = required<HTMLButtonElement>("#agent-stop");
const agentStatusBar = required<HTMLElement>("#agent-status-bar");
const agentStatusText = required<HTMLElement>("#agent-status-text");
const errorText = required<HTMLParagraphElement>("#error");
const settingsDialog = required<HTMLDialogElement>("#settings-dialog");
const surfaceTitle = required<HTMLHeadingElement>("#surface-title");
const dialogTitle = required<HTMLHeadingElement>("#dialog-title");
const reviewScopeStatus = required<HTMLParagraphElement>("#review-scope-status");
const suggestionList = required<HTMLDivElement>("#suggestion-list");
const trackedRevisionList = required<HTMLDivElement>("#tracked-revision-list");
const trackedRevisionStatus = required<HTMLParagraphElement>("#tracked-revision-status");
const goldenSummary = required<HTMLParagraphElement>("#golden-summary");
const goldenOutput = required<HTMLPreElement>("#golden-output");
const goldenConfirm = required<HTMLInputElement>("#golden-confirm");
const goldenRunButton = required<HTMLButtonElement>("#golden-run");
const goldenCopyButton = required<HTMLButtonElement>("#golden-copy");
const longDocumentSummary = required<HTMLParagraphElement>("#long-document-summary");
const longDocumentOutput = required<HTMLPreElement>("#long-document-output");
const longDocumentConfirm = required<HTMLInputElement>("#long-document-confirm");
const longDocumentRunButton = required<HTMLButtonElement>("#long-document-run");
const longDocumentCopyButton = required<HTMLButtonElement>("#long-document-copy");
const revisionHostSummary = required<HTMLParagraphElement>("#revision-host-summary");
const revisionHostOutput = required<HTMLPreElement>("#revision-host-output");
const revisionHostConfirm = required<HTMLInputElement>("#revision-host-confirm");
const revisionHostRunButton = required<HTMLButtonElement>("#revision-host-run");
const revisionHostCopyButton = required<HTMLButtonElement>("#revision-host-copy");
const compareOriginalInput = required<HTMLInputElement>("#compare-original");
const compareRevisedInput = required<HTMLInputElement>("#compare-revised");
const compareRunButton = required<HTMLButtonElement>("#compare-run");
const compareNativeWordButton = required<HTMLButtonElement>("#compare-native-word");
const compareSummary = required<HTMLParagraphElement>("#compare-summary");
const compareAnalysisStatus = required<HTMLElement>("#compare-analysis-status");
const compareAnalysis = required<HTMLElement>("#compare-analysis");

const surfaceTitleKeys: Record<AddinSurface, string> = {
  agent: "taskpane.surfaces.agent",
  create: "taskpane.surfaces.create",
  edit: "taskpane.surfaces.edit",
  review: "taskpane.surfaces.review",
  legal: "taskpane.surfaces.legal",
  settings: "taskpane.surfaces.settings",
  diagnostics: "taskpane.surfaces.diagnostics",
  compare: "taskpane.surfaces.compare",
};
const workflowSurfaceTitleKeys: Record<string, string> = {
  agent: "taskpane.surfaces.agent",
  writing: "taskpane.workflows.writing.title",
  modify: "taskpane.workflows.modify.title",
  image: "taskpane.image.title",
  table: "taskpane.table.title",
  html: "taskpane.html.title",
  markdown: "taskpane.markdown.title",
  polish: "taskpane.workflows.polish.title",
  expand: "taskpane.workflows.expand.title",
  simplify: "taskpane.workflows.simplify.title",
  continue: "taskpane.workflows.continue.title",
  summarize: "taskpane.workflows.summarize.title",
  fix: "taskpane.workflows.fix.title",
  translate: "taskpane.workflows.translate.title",
  compare: "taskpane.surfaces.compare",
  review: "taskpane.surfaces.review",
  risk: "taskpane.workflows.risk.title",
  fairness: "taskpane.workflows.fairness.title",
  "contract-compare": "taskpane.workflows.contractCompare.title",
  "moot-court": "taskpane.moot.title",
  "law-search": "taskpane.law.title",
  "custom-prompts": "taskpane.prompts.title",
  settings: "taskpane.common.settings",
  diagnostics: "taskpane.surfaces.diagnostics",
};
const surfaceFeatureIcon = required<HTMLElement>("#surface-feature-icon");
function updateRoutePresentation(): void {
  document.documentElement.dataset.surface = activeSurface;
  if (activeSurface === "settings" || activeSurface === "diagnostics" || activeSurface === "compare") {
    document.documentElement.dataset.standaloneDialog = "true";
  } else {
    delete document.documentElement.dataset.standaloneDialog;
  }
  surfaceTitle.textContent = i18n.t(
    (requestedWorkflow && workflowSurfaceTitleKeys[requestedWorkflow]) || surfaceTitleKeys[activeSurface],
  );
  const surfaceFeatureName = requestedWorkflow && workflowSurfaceTitleKeys[requestedWorkflow]
    ? requestedWorkflow === "diagnostics" ? "settings" : requestedWorkflow
    : activeSurface === "legal" ? "risk"
      : activeSurface === "create" ? "writing"
        : activeSurface === "edit" ? "modify"
          : activeSurface === "compare" ? "compare"
            : activeSurface === "review" ? "review"
              : activeSurface === "settings" || activeSurface === "diagnostics" ? "settings" : "agent";
  const surfaceFeatureUrl = `url("/assets/ribbon/${surfaceFeatureName}.svg")`;
  surfaceFeatureIcon.dataset.featureIcon = surfaceFeatureName;
  surfaceFeatureIcon.style.maskImage = surfaceFeatureUrl;
  surfaceFeatureIcon.style.webkitMaskImage = surfaceFeatureUrl;
  if (activeSurface === "diagnostics") {
    dialogTitle.textContent = i18n.t("taskpane.surfaces.diagnostics");
  } else if (activeSurface === "compare") {
    dialogTitle.textContent = i18n.t("taskpane.surfaces.compare");
  }
}
updateRoutePresentation();
let lastGoldenReport = "";
let lastLongDocumentReport = "";
let lastRevisionHostReport = "";
let compareAnalysisAbortController: AbortController | null = null;
let activeSessionId: string | null = null;
let lastAgentDocumentSnapshot: string | null = null;
let reviewScope = "";
let reviewScopeLabel = "";
let reviewScopeKind: "selection" | "paragraphs" | "document" | "" = "";
let reviewIssues: ReviewIssue[] = [];
let reviewSuggestions: ReviewSuggestion[] = [];
let reviewAbortController: AbortController | null = null;
let reviewScopeAnchors = new Map<number, ReviewAnchor>();
let reviewScopeChunks: Array<{ source: string; anchors: Map<number, ReviewAnchor> }> = [];
let reviewPageStart = 1;
let currentReviewFingerprint = "";
let activeTextWorkflow: TextWorkflowDefinition | null = null;
let textWorkflowSource = "";
let textWorkflowScope: "selection" | "document" | "none" = "none";
let textWorkflowAbortController: AbortController | null = null;
let textWorkflowAutoApplyPending = false;
let textPromptPresets: TextPromptPreset[] = loadTextPromptPresets(localStorage);
let textWorkflowPreferences = loadTextWorkflowPreferences(localStorage);
let generatedTable: StructuredTable | null = null;
let tableAbortController: AbortController | null = null;
let convertedMarkdownHtml = "";
let htmlAbortController: AbortController | null = null;
let htmlLibrary: SavedHtmlApp[] = [];
let selectedHtmlAppId = "";
let selectedImageDataUrl = "";
let agentImageDataUrl = "";
let imageAbortController: AbortController | null = null;
let currentLawArticle: LawArticleResult | null = null;
let lawAbortController: AbortController | null = null;
let mootAbortController: AbortController | null = null;
let customPrompts: CustomPromptDefinition[] = [];
let selectedCustomPromptId = "";
let customPromptSource = "";
let customPromptAbortController: AbortController | null = null;
let settingsOfficeDialog: Office.Dialog | null = null;
let settingsPopup: Window | null = null;
let commandMenuItems: Array<{ label: string; hint?: string; action: () => void }> = [];
let selectedCommandIndex = -1;
let availableSkills: Array<{ name: string; description: string }> = [];
let availableSkillsRefreshedAt = 0;
let skillRefreshPending: Promise<void> | null = null;
let selectedAgentSkillName = "";
let forceSkillCreationForNextRun = false;
let bridgePaired = false;
let bridgeCatalog: ToolCatalogResponse | null = null;
let bridgeActivation: Promise<ToolCatalogResponse> | null = null;
let externalOfficeToolLoop: Promise<void> | null = null;
let bridgeReconnectTimer: number | null = null;
let bridgeReconnectDelayMs = 1_000;
let officeReady = typeof Office === "undefined";
let silentLinterTimer: number | null = null;
let silentLinterRunning = false;
let silentLinterSnapshot: string[] = [];
let diagnosticLog: string[] = readLocalSettings<string[]>("wordollama-diagnostic-log", []);
const AGENT_RECOVERY_KEY = "wordollama-active-agent";
interface AgentRecoveryState {
  sessionId: string;
  requirement: string;
  imageDataUrl: string;
  executionMode: "ViewOnly" | "ProposeChanges" | "TrackedChanges";
  iteration: number;
  updatedAt: string;
  persisted?: boolean;
  goal?: string;
}

toggleAgentGoal.addEventListener("click", () => {
  const expanded = toggleAgentGoal.getAttribute("aria-expanded") === "true";
  toggleAgentGoal.setAttribute("aria-expanded", String(!expanded));
  agentGoalRow.hidden = expanded;
  if (!expanded) agentGoal.focus();
});

function appendDiagnostic(category: string, message: string): void {
  const settings = readLocalSettings("wordollama-diagnostic-settings", { enabled: false });
  if (!settings.enabled) return;
  diagnosticLog.push(`${new Date().toISOString()} [${category}] ${message}`);
  if (diagnosticLog.length > 200) diagnosticLog = diagnosticLog.slice(-200);
  writeLocalSettings("wordollama-diagnostic-log", diagnosticLog);
}

function ensureExternalOfficeToolLoop(): void {
  if (externalOfficeToolLoop || !bridgeCatalog?.externalMcpEnabled) return;
  externalOfficeToolLoop = (async () => {
    while (bridgePaired && bridgeCatalog?.externalMcpEnabled && runtime.hasPairing()) {
      try {
        const call = await runtime.waitForExternalOfficeTool();
        if (!call) continue;
        try {
          const result = await tools.execute(call.name, call.arguments || {});
          await runtime.submitExternalOfficeToolResult(call.callId, result);
        } catch (toolError) {
          const message = toolError instanceof Error ? toolError.message : String(toolError);
          await runtime.submitExternalOfficeToolResult(call.callId, message, true);
        }
      } catch (error) {
        appendDiagnostic(
          "external-word-mcp",
          error instanceof Error ? error.message : String(error),
        );
        if (!runtime.hasPairing()) {
          bridgePaired = false;
          bridgeCatalog = null;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
    }
  })().finally(() => {
    externalOfficeToolLoop = null;
    if (!bridgePaired && officeReady) scheduleBridgeReconnect();
  });
}

function scheduleBridgeReconnect(): void {
  if (bridgeReconnectTimer !== null || !officeReady) return;
  bridgeReconnectTimer = window.setTimeout(() => {
    bridgeReconnectTimer = null;
    void activateBridgeSession().catch((error) => {
      appendDiagnostic(
        "bridge",
        `background re-pairing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      bridgeReconnectDelayMs = Math.min(30_000, bridgeReconnectDelayMs * 2);
      scheduleBridgeReconnect();
    });
  }, bridgeReconnectDelayMs);
}

async function activateBridgeSession(): Promise<ToolCatalogResponse> {
  if (bridgePaired && bridgeCatalog) {
    ensureExternalOfficeToolLoop();
    return bridgeCatalog;
  }
  if (bridgeActivation) return bridgeActivation;

  bridgeActivation = (async () => {
    try {
      if (!runtime.hasPairing()) await runtime.autoPair();
      let catalog: ToolCatalogResponse;
      try {
        catalog = await runtime.registerOfficeTools(tools.list());
      } catch (error) {
        if (runtime.hasPairing()) throw error;
        await runtime.autoPair();
        catalog = await runtime.registerOfficeTools(tools.list());
      }
      bridgeCatalog = catalog;
      bridgePaired = true;
      bridgeReconnectDelayMs = 1_000;
      if (bridgeReconnectTimer !== null) {
        window.clearTimeout(bridgeReconnectTimer);
        bridgeReconnectTimer = null;
      }
      ensureExternalOfficeToolLoop();
      configureSilentLinter();
      await refreshAvailableSkills().catch((error) =>
        appendDiagnostic("skills", `automatic refresh failed: ${error instanceof Error ? error.message : String(error)}`));
      await offerAgentRecovery();
      await refreshRuntimeStatus();
      return catalog;
    } catch (error) {
      bridgeCatalog = null;
      bridgePaired = false;
      setRuntimeStatus("disconnected", "attention");
      throw error;
    } finally {
      bridgeActivation = null;
    }
  })();
  return bridgeActivation;
}

window.addEventListener("storage", (event) => {
  if (event.key === UI_LOCALE_STORAGE_KEY) {
    const preference: UiLocalePreference =
      event.newValue === "en-US" || event.newValue === "zh-CN"
        ? event.newValue
        : "auto";
    void setUiLocalePreference(preference);
    return;
  }
  if (event.key !== PAIRING_SESSION_STORAGE_KEY || !officeReady) return;
  bridgePaired = false;
  bridgeCatalog = null;
  if (!runtime.refreshPairing()) {
    setRuntimeStatus("connecting", "connecting");
    void activateBridgeSession().catch((error) =>
      appendDiagnostic("bridge", `automatic re-pairing failed: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }
  void activateBridgeSession().catch((error) =>
    appendDiagnostic("bridge", `shared pairing failed: ${error instanceof Error ? error.message : String(error)}`));
});

type RuntimeStatusState = "connecting" | "connected" | "attention";

function setRuntimeStatus(
  key: "connecting" | "disconnected" | "providerRequired",
  state: RuntimeStatusState,
): void {
  const text = i18n.t(`taskpane.runtime.${key}`);
  runtimeStatus.dataset.state = state;
  runtimeStatusText.textContent = text;
  runtimeStatus.title = text;
}

async function refreshRuntimeStatus(): Promise<void> {
  if (!runtime.hasPairing()) {
    setRuntimeStatus("connecting", "connecting");
    try {
      await activateBridgeSession();
    } catch {
      setRuntimeStatus("disconnected", "attention");
    }
    return;
  }
  try {
    const active = await runtime.getProviderRuntime();
    const model = active.models.join(", ");
    const text = formatActiveModelLabel(
      model || i18n.t("taskpane.runtime.noLoadedModel"),
      active.provider,
    );
    runtimeStatus.dataset.state = "connected";
    runtimeStatusText.textContent = text;
    runtimeStatus.title = i18n.t("taskpane.runtime.activeProviderDetail", {
      provider: active.provider,
      model: model || i18n.t("taskpane.runtime.noLoadedModel"),
    });
  } catch {
    setRuntimeStatus(
      "disconnected",
      "attention",
    );
  }
}

window.addEventListener("focus", () => {
  if (officeReady) void refreshRuntimeStatus();
});
document.addEventListener("visibilitychange", () => {
  if (officeReady && document.visibilityState === "visible") {
    void refreshRuntimeStatus();
  }
});

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  errorText.textContent = message;
  appendDiagnostic("error", message);
}

function clearError(): void {
  errorText.textContent = "";
}

function activateTab(name: string): void {
  document.querySelectorAll<HTMLButtonElement>(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  document.querySelectorAll<HTMLElement>(".tab-panel").forEach((panel) => {
    const active = panel.dataset.panel === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

document.querySelectorAll<HTMLButtonElement>(".tab-button").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab ?? "chat"));
});

function openUtilityDialog(): void {
  if (settingsDialog.open) return;
  if (document.documentElement.dataset.standaloneDialog === "true") {
    settingsDialog.setAttribute("open", "");
    return;
  }
  if (typeof settingsDialog.showModal === "function") settingsDialog.showModal();
  else settingsDialog.setAttribute("open", "");
}

function openReactSettingsDialog(): void {
  if (wpsHost) {
    const application = window.wps ?? window.Application;
    const settingsUrl = new URL("/settings.html?wpsDialog=1", window.location.origin);
    settingsUrl.searchParams.set("wpsNavigation", Date.now().toString(36));
    const opened = application?.ShowDialog?.(
      settingsUrl.href,
      "WordOllama.JS 设置",
      1080,
      760,
      false,
      true,
      2,
      "",
      0,
      false,
      true,
      true,
    );
    if (!opened) showError(new Error(i18n.t("taskpane.settings.openFailed")));
    return;
  }
  if (settingsOfficeDialog || (settingsPopup && !settingsPopup.closed)) return;
  const url = new URL("/settings.html", window.location.origin).href;
  if (typeof Office === "undefined" || !Office.context?.ui?.displayDialogAsync) {
    settingsPopup = window.open(url, "wordollama-settings", "popup,width=1120,height=760,resizable=yes");
    if (!settingsPopup) showError(new Error(i18n.t("taskpane.settings.openFailed")));
    return;
  }
  Office.context.ui.displayDialogAsync(
    url,
    { height: 82, width: 78, displayInIframe: true, promptBeforeOpen: false },
    (result) => {
      if (result.status !== Office.AsyncResultStatus.Succeeded || !result.value) {
        showError(new Error(result.error?.message || i18n.t("taskpane.settings.openFailed")));
        return;
      }
      const dialog = result.value;
      settingsOfficeDialog = dialog;
      dialog.addEventHandler(Office.EventType.DialogMessageReceived, (event) => {
        if ("message" in event) {
          void handleReactSettingsMessage(dialog, event.message, event.origin);
        }
      });
      dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
        settingsOfficeDialog = null;
      });
    },
  );
}

type ReactSettingsRequest =
  | { id: string; method: "word.listStyles" }
  | { id: string; method: "word.createParagraphStyle"; name: string }
  | { id: string; method: "runtime.adoptPairing"; pairing: PairResponse }
  | { id: string; method: "settings.close" };

async function handleReactSettingsMessage(
  dialog: Office.Dialog,
  message: string,
  origin?: string,
): Promise<void> {
  if (origin && origin !== window.location.origin) return;
  let request: ReactSettingsRequest;
  try {
    request = JSON.parse(message) as ReactSettingsRequest;
  } catch {
    return;
  }

  if (request.method === "settings.close") {
    dialog.close();
    settingsOfficeDialog = null;
    return;
  }

  try {
    let result: unknown;
    if (request.method === "word.listStyles") {
      result = await word.listStyles();
    } else if (request.method === "word.createParagraphStyle") {
      await word.createParagraphStyle(request.name);
    } else if (request.method === "runtime.adoptPairing") {
      runtime.adoptPairing(request.pairing);
      bridgePaired = false;
      bridgeCatalog = null;
      result = await activateBridgeSession();
    } else {
      return;
    }
    dialog.messageChild(JSON.stringify({ id: request.id, ok: true, result }));
  } catch (error) {
    dialog.messageChild(JSON.stringify({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

required<HTMLButtonElement>("#open-settings").addEventListener("click", openReactSettingsDialog);
required<HTMLButtonElement>("#close-settings").addEventListener("click", () => settingsDialog.close());
required<HTMLButtonElement>("#agent-empty-setup").addEventListener("click", openReactSettingsDialog);
document.querySelectorAll<HTMLButtonElement>("[data-agent-example-key]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.agentExampleKey;
    if (!key) return;
    agentRequirement.value = i18n.t(key);
    agentRequirement.focus();
  });
});

function activateUtilityPanel(name: "advanced" | "diagnostics"): void {
  document.querySelectorAll<HTMLElement>(".settings-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.settingsPanel === name);
  });
  settingsDialog.scrollTop = 0;
}

const WORKFLOW_ROUTES: Record<string, { titleKey: string; promptKey: string }> = {
  writing: { titleKey: "taskpane.workflows.writing.title", promptKey: "taskpane.workflows.writing.prompt" },
  modify: { titleKey: "taskpane.workflows.modify.title", promptKey: "taskpane.workflows.modify.prompt" },
  image: { titleKey: "taskpane.image.title", promptKey: "taskpane.workflows.image.prompt" },
  table: { titleKey: "taskpane.table.generate", promptKey: "taskpane.workflows.table.prompt" },
  html: { titleKey: "taskpane.html.title", promptKey: "taskpane.workflows.html.prompt" },
  markdown: { titleKey: "taskpane.markdown.title", promptKey: "taskpane.workflows.markdown.prompt" },
  polish: { titleKey: "taskpane.workflows.polish.title", promptKey: "taskpane.workflows.polish.prompt" },
  expand: { titleKey: "taskpane.workflows.expand.title", promptKey: "taskpane.workflows.expand.prompt" },
  simplify: { titleKey: "taskpane.workflows.simplify.title", promptKey: "taskpane.workflows.simplify.prompt" },
  continue: { titleKey: "taskpane.workflows.continue.title", promptKey: "taskpane.workflows.continue.prompt" },
  summarize: { titleKey: "taskpane.workflows.summarize.title", promptKey: "taskpane.workflows.summarize.prompt" },
  fix: { titleKey: "taskpane.workflows.fix.title", promptKey: "taskpane.workflows.fix.prompt" },
  translate: { titleKey: "taskpane.workflows.translate.title", promptKey: "taskpane.workflows.translate.prompt" },
  risk: { titleKey: "taskpane.workflows.risk.title", promptKey: "taskpane.workflows.risk.prompt" },
  fairness: { titleKey: "taskpane.workflows.fairness.title", promptKey: "taskpane.workflows.fairness.prompt" },
  "moot-court": { titleKey: "taskpane.moot.title", promptKey: "taskpane.workflows.moot.prompt" },
  "law-search": { titleKey: "taskpane.law.title", promptKey: "taskpane.workflows.law.prompt" },
};

type PrimaryWorkspace =
  | "text"
  | "translation"
  | "table"
  | "markdown"
  | "html"
  | "image"
  | "law"
  | "moot"
  | "custom";

function setPrimaryWorkspace(workspace: PrimaryWorkspace | null): void {
  const workspaceSelectors: Record<Exclude<PrimaryWorkspace, null>, string> = {
    text: "#text-workflow-workspace",
    translation: "#translation-workspace",
    table: "#table-workflow-workspace",
    markdown: "#markdown-workflow-workspace",
    html: "#html-workflow-workspace",
    image: "#image-workflow-workspace",
    law: "#law-workflow-workspace",
    moot: "#moot-workflow-workspace",
    custom: "#custom-prompt-workspace",
  };
  for (const [name, selector] of Object.entries(workspaceSelectors)) {
    required<HTMLElement>(selector).hidden = workspace !== name;
  }
  required<HTMLElement>(".main-tabs").hidden = workspace !== null;
  document.querySelectorAll<HTMLElement>(".tab-panel").forEach((panel) => {
    if (workspace !== null) panel.hidden = true;
  });
  if (workspace === null) {
    activateTab("chat");
    return;
  }
  const activeWorkspace = required<HTMLElement>(workspaceSelectors[workspace]);
  activeWorkspace.scrollTop = 0;
  activeWorkspace.querySelectorAll<HTMLDetailsElement>("details[data-default-collapsed]")
    .forEach((details) => { details.open = false; });
  requestAnimationFrame(() => { activeWorkspace.scrollTop = 0; });
}

const translationWorkspace = initializeTranslationWorkspace({
  runtime,
  word,
  showError,
  clearError,
  refreshRuntimeStatus,
  showWorkspace: () => setPrimaryWorkspace("translation"),
  closeWorkspace: () => setPrimaryWorkspace(null),
});

function updateTextWorkflowActions(): void {
  const resultValue = required<HTMLTextAreaElement>("#workflow-result").value.trim();
  const hasResult = textWorkflowAbortController === null && Boolean(resultValue);
  required<HTMLElement>("#workflow-output").hidden = !resultValue;
  const selectionTarget = textWorkflowScope === "selection";
  required<HTMLButtonElement>("#workflow-retry").disabled = textWorkflowAbortController !== null;
  required<HTMLButtonElement>("#workflow-replace").disabled = !hasResult || !selectionTarget;
  required<HTMLButtonElement>("#workflow-precise-revision").disabled = !hasResult || !selectionTarget;
  required<HTMLButtonElement>("#workflow-insert").disabled = !hasResult;
  required<HTMLButtonElement>("#workflow-copy").disabled = !hasResult;
}

const REVIEW_HANDOFF_KEY = "wordollama-review-handoff-v1";

interface ReviewHandoff {
  fingerprint: string;
  originalText: string;
  suggestedText: string;
  reason: string;
  createdAt: string;
}

function setTextWorkflowSource(
  scope: "selection" | "document" | "none",
  source: string,
  label: string,
): void {
  textWorkflowScope = scope;
  textWorkflowSource = source;
  required<HTMLElement>("#workflow-source-status").textContent = label;
  required<HTMLTextAreaElement>("#workflow-source-text").value = source;
  updateTextWorkflowActions();
}

function workflowPresets(): TextPromptPreset[] {
  if (!activeTextWorkflow) return [];
  return textPromptPresets.filter((preset) => preset.workflowKey === activeTextWorkflow!.key);
}

function renderWorkflowPromptSelect(selectedId = "builtin"): void {
  if (!activeTextWorkflow) return;
  const select = required<HTMLSelectElement>("#workflow-prompt-select");
  select.replaceChildren();
  const builtin = document.createElement("option");
  builtin.value = "builtin";
  builtin.textContent = i18n.t("taskpane.text.builtinPrompt");
  select.appendChild(builtin);
  for (const preset of workflowPresets()) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    select.appendChild(option);
  }
  select.value = Array.from(select.options).some((option) => option.value === selectedId)
    ? selectedId
    : "builtin";
}

function applySelectedWorkflowPrompt(): void {
  if (!activeTextWorkflow) return;
  const id = required<HTMLSelectElement>("#workflow-prompt-select").value;
  const preset = textPromptPresets.find((item) => item.id === id);
  required<HTMLTextAreaElement>("#workflow-instruction").value =
    preset?.instruction ?? activeTextWorkflow.defaultInstruction;
}

function syncTextWorkflowPreferenceUi(): void {
  if (!activeTextWorkflow) return;
  const preference = workflowPreference(textWorkflowPreferences, activeTextWorkflow.key);
  const selectedId = required<HTMLSelectElement>("#workflow-prompt-select").value;
  const defaultButton = required<HTMLButtonElement>("#workflow-set-default-prompt");
  const active = selectedId === preference.defaultPresetId;
  defaultButton.classList.toggle("btn-primary", active);
  defaultButton.classList.toggle("btn-ghost", !active);
  defaultButton.textContent = i18n.t(active
    ? "taskpane.text.defaultPromptActive"
    : "taskpane.text.setDefaultPrompt");
  const autoApply = required<HTMLInputElement>("#workflow-auto-apply");
  const autoApplyOption = required<HTMLElement>(".workflow-auto-apply-option");
  autoApplyOption.hidden = !activeTextWorkflow.supportsAutoApply;
  autoApply.checked = activeTextWorkflow.supportsAutoApply && preference.autoApply;
  autoApply.disabled = !activeTextWorkflow.supportsAutoApply;
}

function renderWorkflowPromptList(): void {
  const list = required<HTMLUListElement>("#workflow-prompt-list");
  list.replaceChildren();
  const presets = workflowPresets();
  if (!presets.length) {
    const empty = document.createElement("li");
    empty.className = "p-4 text-xs opacity-60 tracking-wide workflow-prompt-empty";
    empty.textContent = i18n.t("taskpane.text.noSavedPrompts");
    list.appendChild(empty);
    return;
  }
  for (const preset of presets) {
    const row = document.createElement("li");
    row.className = "list-row workflow-prompt-row";
    const content = document.createElement("div");
    content.className = "list-col-grow workflow-prompt-row-main";
    const title = document.createElement("div");
    title.className = "font-semibold";
    title.textContent = preset.name;
    const detail = document.createElement("div");
    detail.className = "text-xs opacity-60 workflow-prompt-detail";
    detail.textContent = preset.instruction;
    content.append(title, detail);
    const edit = document.createElement("button");
    edit.className = "btn btn-square btn-ghost btn-xs";
    edit.type = "button";
    edit.title = i18n.t("taskpane.common.edit");
    edit.setAttribute("aria-label", edit.title);
    edit.innerHTML = '<svg class="size-[1em]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    edit.addEventListener("click", () => {
      required<HTMLInputElement>("#workflow-prompt-name").value = preset.name;
      required<HTMLTextAreaElement>("#workflow-prompt-content").value = preset.instruction;
      required<HTMLButtonElement>("#workflow-prompt-create").dataset.editId = preset.id;
    });
    const remove = document.createElement("button");
    remove.className = "btn btn-square btn-ghost btn-xs text-error";
    remove.type = "button";
    remove.title = i18n.t("taskpane.common.delete");
    remove.setAttribute("aria-label", remove.title);
    remove.innerHTML = '<svg class="size-[1em]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>';
    remove.addEventListener("click", () => {
      textPromptPresets = saveTextPromptPresets(localStorage, textPromptPresets.filter((item) => item.id !== preset.id));
      renderWorkflowPromptSelect();
      syncTextWorkflowPreferenceUi();
      renderWorkflowPromptList();
    });
    row.append(content, edit, remove);
    list.appendChild(row);
  }
}

function openWorkflowPromptDialog(prefillCurrent = false): void {
  const name = required<HTMLInputElement>("#workflow-prompt-name");
  const content = required<HTMLTextAreaElement>("#workflow-prompt-content");
  name.value = "";
  content.value = prefillCurrent ? required<HTMLTextAreaElement>("#workflow-instruction").value : "";
  delete required<HTMLButtonElement>("#workflow-prompt-create").dataset.editId;
  renderWorkflowPromptList();
  required<HTMLDialogElement>("#workflow-prompt-dialog").showModal();
}

async function loadTextWorkflowSelection(): Promise<void> {
  const selection = await word.getSelection();
  if (!selection.text.trim()) throw new Error(i18n.t("taskpane.errors.selectionEmpty"));
  setTextWorkflowSource(
    "selection",
    selection.text,
    i18n.t("taskpane.status.selectionLoaded", { count: selection.text.length }),
  );
}

async function readTextWorkflowDocument(): Promise<string> {
  const overview = await word.getDocumentOverview();
  const count = Math.min(overview.paragraphCount, 300);
  const paragraphs: string[] = [];
  for (let start = 1; start <= count; start += 50) {
    const result = await word.readParagraphs(start, Math.min(start + 49, count));
    paragraphs.push(...result.paragraphs);
  }
  return paragraphs.join("\n");
}

async function loadTextWorkflowDocument(): Promise<void> {
  const source = await readTextWorkflowDocument();
  if (!source.trim()) throw new Error(i18n.t("taskpane.errors.documentEmpty"));
  setTextWorkflowSource(
    "document",
    source,
    i18n.t("taskpane.status.documentLoaded", { count: source.length, paragraphs: 300 }),
  );
}

async function openTextWorkflow(definition: TextWorkflowDefinition): Promise<void> {
  activeTextWorkflow = definition;
  textPromptPresets = loadTextPromptPresets(localStorage);
  textWorkflowPreferences = loadTextWorkflowPreferences(localStorage);
  textWorkflowAbortController?.abort();
  required<HTMLElement>("#text-workflow-title").textContent = definition.title;
  const featureIcon = required<HTMLElement>("#text-workflow-feature-icon");
  const featureIconUrl = `url("/assets/ribbon/${definition.key}.svg")`;
  featureIcon.dataset.featureIcon = definition.key;
  featureIcon.style.maskImage = featureIconUrl;
  featureIcon.style.webkitMaskImage = featureIconUrl;
  required<HTMLTextAreaElement>("#workflow-instruction").value = definition.defaultInstruction;
  required<HTMLTextAreaElement>("#workflow-result").value = "";
  const preference = workflowPreference(textWorkflowPreferences, definition.key);
  renderWorkflowPromptSelect(preference.defaultPresetId);
  applySelectedWorkflowPrompt();
  syncTextWorkflowPreferenceUi();
  setTextWorkflowSource("none", "", "");
  setPrimaryWorkspace("text");
  try {
    if (definition.defaultScope === "selection") await loadTextWorkflowSelection();
    else if (definition.defaultScope === "document") await loadTextWorkflowDocument();
    else setTextWorkflowSource("none", "", "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isBrowserPreview = message === "Word is not defined";
    required<HTMLElement>("#workflow-source-status").textContent =
      message === i18n.t("taskpane.errors.selectionEmpty") || isBrowserPreview ? "" : message;
  }
  if (definition.supportsAutoApply && preference.autoApply && textWorkflowScope === "selection" && textWorkflowSource.trim()) {
    textWorkflowAutoApplyPending = true;
    queueMicrotask(() => required<HTMLButtonElement>("#workflow-generate").click());
  }
}

async function currentTextWorkflowSelection(): Promise<string> {
  const current = await word.getSelection();
  if (!current.text.trim()) throw new Error(i18n.t("taskpane.errors.selectionEmpty"));
  return current.text;
}

required<HTMLButtonElement>("#close-text-workflow").addEventListener("click", () => {
  textWorkflowAbortController?.abort();
  activeTextWorkflow = null;
  setPrimaryWorkspace(null);
});
required<HTMLButtonElement>("#workflow-load-selection").addEventListener("click", async () => {
  try { clearError(); await loadTextWorkflowSelection(); } catch (error) { showError(error); }
});
required<HTMLButtonElement>("#workflow-load-document").addEventListener("click", async () => {
  try { clearError(); await loadTextWorkflowDocument(); } catch (error) { showError(error); }
});
required<HTMLTextAreaElement>("#workflow-source-text").addEventListener("input", (event) => {
  textWorkflowSource = (event.currentTarget as HTMLTextAreaElement).value;
});
required<HTMLTextAreaElement>("#workflow-result").addEventListener("input", updateTextWorkflowActions);
required<HTMLSelectElement>("#workflow-prompt-select").addEventListener("change", (event) => {
  if (!activeTextWorkflow) return;
  void event;
  applySelectedWorkflowPrompt();
  syncTextWorkflowPreferenceUi();
});
required<HTMLButtonElement>("#workflow-set-default-prompt").addEventListener("click", () => {
  if (!activeTextWorkflow) return;
  const current = workflowPreference(textWorkflowPreferences, activeTextWorkflow.key);
  textWorkflowPreferences[activeTextWorkflow.key] = {
    ...current,
    defaultPresetId: required<HTMLSelectElement>("#workflow-prompt-select").value,
  };
  saveTextWorkflowPreferences(localStorage, textWorkflowPreferences);
  syncTextWorkflowPreferenceUi();
});
required<HTMLInputElement>("#workflow-auto-apply").addEventListener("change", (event) => {
  if (!activeTextWorkflow) return;
  const current = workflowPreference(textWorkflowPreferences, activeTextWorkflow.key);
  textWorkflowPreferences[activeTextWorkflow.key] = {
    ...current,
    autoApply: (event.currentTarget as HTMLInputElement).checked,
  };
  saveTextWorkflowPreferences(localStorage, textWorkflowPreferences);
  syncTextWorkflowPreferenceUi();
});
required<HTMLButtonElement>("#workflow-save-prompt").addEventListener("click", () => openWorkflowPromptDialog(true));
required<HTMLButtonElement>("#workflow-manage-prompts").addEventListener("click", () => openWorkflowPromptDialog());
required<HTMLButtonElement>("#workflow-prompt-close").addEventListener("click", () => {
  required<HTMLDialogElement>("#workflow-prompt-dialog").close();
});
required<HTMLButtonElement>("#workflow-prompt-create").addEventListener("click", (event) => {
  if (!activeTextWorkflow) return;
  const button = event.currentTarget as HTMLButtonElement;
  const name = required<HTMLInputElement>("#workflow-prompt-name").value.trim();
  const instruction = required<HTMLTextAreaElement>("#workflow-prompt-content").value.trim();
  if (!name || !instruction) {
    showError(new Error(i18n.t("taskpane.text.promptRequired")));
    return;
  }
  const editingId = button.dataset.editId;
  let savedId = editingId;
  if (editingId) {
    textPromptPresets = textPromptPresets.map((preset) =>
      preset.id === editingId ? { ...preset, name, instruction } : preset,
    );
  } else {
    const preset = createTextPromptPreset(activeTextWorkflow.key, name, instruction);
    textPromptPresets.push(preset);
    savedId = preset.id;
  }
  textPromptPresets = saveTextPromptPresets(localStorage, textPromptPresets);
  renderWorkflowPromptSelect(savedId);
  required<HTMLTextAreaElement>("#workflow-instruction").value = instruction;
  syncTextWorkflowPreferenceUi();
  renderWorkflowPromptList();
  required<HTMLInputElement>("#workflow-prompt-name").value = "";
  required<HTMLTextAreaElement>("#workflow-prompt-content").value = "";
  delete button.dataset.editId;
});

async function applyPreciseTextWorkflowResult(original?: string): Promise<void> {
  const currentSelection = original ?? await currentTextWorkflowSelection();
  const result = required<HTMLTextAreaElement>("#workflow-result").value;
  const precise = await word.applyPreciseRevision(currentSelection, result);
  required<HTMLElement>("#workflow-source-status").textContent = i18n.t(
    precise ? "taskpane.status.preciseRevisionApplied" : "taskpane.status.trackedReplaceApplied",
  );
}

async function applyAutomaticTextWorkflowResult(): Promise<void> {
  if (!activeTextWorkflow) return;
  const currentSelection = await currentTextWorkflowSelection();
  const result = required<HTMLTextAreaElement>("#workflow-result").value;
  if (activeTextWorkflow.preferredAction === "comment") {
    await word.addComment(result);
    required<HTMLElement>("#workflow-source-status").textContent =
      i18n.t("taskpane.status.defaultCommented");
    return;
  }
  if (activeTextWorkflow.preferredAction === "insert") {
    await word.insertAfterSelection(result);
    required<HTMLElement>("#workflow-source-status").textContent =
      i18n.t("taskpane.status.defaultInserted");
    return;
  }
  await applyPreciseTextWorkflowResult(currentSelection);
}

required<HTMLButtonElement>("#workflow-generate").addEventListener("click", async () => {
  if (!activeTextWorkflow) return;
  const generate = required<HTMLButtonElement>("#workflow-generate");
  const cancel = required<HTMLButtonElement>("#workflow-cancel");
  const result = required<HTMLTextAreaElement>("#workflow-result");
  clearError();
  textWorkflowAbortController = new AbortController();
  generate.disabled = true;
  cancel.disabled = false;
  beginStreamingText(result);
  updateTextWorkflowActions();
  try {
    let outputPreference = "";
    try {
      outputPreference = (await runtime.getReviewSettings()).outputPreference;
    } catch {
      // A preference lookup failure must not block the requested editing task.
    }
    const finalResult = await generateTextWorkflow(
      runtime,
      activeTextWorkflow,
      textWorkflowSource,
      textWorkflowScope === "selection"
        ? i18n.t("taskpane.scope.selection")
        : textWorkflowScope === "document"
          ? i18n.t("taskpane.scope.document")
          : "",
      required<HTMLTextAreaElement>("#workflow-instruction").value.trim(),
      i18n.t("taskpane.language.auto"),
      resolveTextWorkflowOutputPreference(activeTextWorkflow, outputPreference),
      textWorkflowAbortController.signal,
      (content) => {
        updateStreamingText(result, content);
        updateTextWorkflowActions();
      },
    );
    endStreamingText(result, finalResult);
    if (textWorkflowAutoApplyPending) {
      textWorkflowAutoApplyPending = false;
      await applyAutomaticTextWorkflowResult();
    }
  } catch (error) {
    endStreamingText(result);
    if ((error as { name?: string }).name !== "AbortError") showError(error);
  } finally {
    textWorkflowAutoApplyPending = false;
    endStreamingText(result);
    textWorkflowAbortController = null;
    generate.disabled = false;
    cancel.disabled = true;
    updateTextWorkflowActions();
  }
});
required<HTMLButtonElement>("#workflow-cancel").addEventListener("click", () => textWorkflowAbortController?.abort());
required<HTMLButtonElement>("#workflow-retry").addEventListener("click", () => {
  required<HTMLButtonElement>("#workflow-generate").click();
});
required<HTMLButtonElement>("#workflow-replace").addEventListener("click", async () => {
  try {
    await currentTextWorkflowSelection();
    const result = required<HTMLTextAreaElement>("#workflow-result").value;
    await word.replaceSelection(result);
    required<HTMLElement>("#workflow-source-status").textContent = i18n.t("taskpane.status.selectionReplaced");
  } catch (error) { showError(error); }
});
required<HTMLButtonElement>("#workflow-insert").addEventListener("click", async () => {
  try {
    const result = required<HTMLTextAreaElement>("#workflow-result").value;
    if (textWorkflowScope === "selection") {
      await currentTextWorkflowSelection();
      await word.insertAfterSelection(result);
    } else {
      await word.insertAtCursor(result);
    }
  } catch (error) { showError(error); }
});
required<HTMLButtonElement>("#workflow-precise-revision").addEventListener("click", async () => {
  try {
    await applyPreciseTextWorkflowResult();
  } catch (error) { showError(error); }
});
required<HTMLButtonElement>("#workflow-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(required<HTMLTextAreaElement>("#workflow-result").value); }
  catch (error) { showError(error); }
});
function renderStructuredTable(table: StructuredTable | null): void {
  const preview = required<HTMLDivElement>("#table-preview");
  const insert = required<HTMLButtonElement>("#table-insert");
  preview.replaceChildren();
  generatedTable = table;
  insert.disabled = !table;
  if (!table) {
    preview.classList.add("empty-panel");
    required<HTMLElement>("#table-preview-status").textContent = "";
    return;
  }
  preview.classList.remove("empty-panel");
  const tableElement = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  table.headers.forEach((header) => {
    const cell = document.createElement("th");
    cell.textContent = header;
    headRow.appendChild(cell);
  });
  head.appendChild(headRow);
  tableElement.appendChild(head);
  const body = document.createElement("tbody");
  table.rows.forEach((row) => {
    const rowElement = document.createElement("tr");
    table.headers.forEach((_, index) => {
      const cell = document.createElement("td");
      cell.textContent = row[index] ?? "";
      rowElement.appendChild(cell);
    });
    body.appendChild(rowElement);
  });
  tableElement.appendChild(body);
  preview.appendChild(tableElement);
  required<HTMLElement>("#table-preview-status").textContent =
    i18n.t("taskpane.table.dimensions", {
      rows: table.rows.length,
      columns: table.headers.length,
    });
}

async function openTableWorkflow(): Promise<void> {
  tableAbortController?.abort();
  renderStructuredTable(null);
  setPrimaryWorkspace("table");
  try {
    const selection = await word.getSelection();
    required<HTMLTextAreaElement>("#table-source").value = selection.text.trim();
  } catch {
    // Browser preview and hosts without a document can still use manual input.
  }
}

required<HTMLButtonElement>("#close-table-workflow").addEventListener("click", () => {
  tableAbortController?.abort();
  setPrimaryWorkspace(null);
});
required<HTMLButtonElement>("#table-load-selection").addEventListener("click", async () => {
  try {
    clearError();
    const selection = await word.getSelection();
    if (!selection.text.trim()) throw new Error(i18n.t("taskpane.errors.selectionEmpty"));
    required<HTMLTextAreaElement>("#table-source").value = selection.text;
    renderStructuredTable(null);
  } catch (error) { showError(error); }
});
required<HTMLButtonElement>("#table-clear").addEventListener("click", () => {
  required<HTMLTextAreaElement>("#table-source").value = "";
  renderStructuredTable(null);
});
required<HTMLSelectElement>("#table-template").addEventListener("change", (event) => {
  const value = (event.currentTarget as HTMLSelectElement).value;
  if (value) required<HTMLTextAreaElement>("#table-requirement").value = value;
});
required<HTMLTextAreaElement>("#table-source").addEventListener("input", () => renderStructuredTable(null));
required<HTMLButtonElement>("#table-generate").addEventListener("click", async () => {
  const generate = required<HTMLButtonElement>("#table-generate");
  const cancel = required<HTMLButtonElement>("#table-cancel");
  clearError();
  tableAbortController = new AbortController();
  generate.disabled = true;
  cancel.disabled = false;
  renderStructuredTable(null);
  required<HTMLElement>("#table-preview-status").textContent =
    i18n.t("taskpane.status.generating");
  try {
    const table = await generateStructuredTable(
      runtime,
      required<HTMLTextAreaElement>("#table-source").value,
      required<HTMLTextAreaElement>("#table-requirement").value,
      tableAbortController.signal,
    );
    renderStructuredTable(table);
  } catch (error) {
    if ((error as { name?: string }).name !== "AbortError") showError(error);
  } finally {
    tableAbortController = null;
    generate.disabled = false;
    cancel.disabled = true;
  }
});
required<HTMLButtonElement>("#table-cancel").addEventListener("click", () => tableAbortController?.abort());
required<HTMLButtonElement>("#table-insert").addEventListener("click", async () => {
  try {
    if (!generatedTable) throw new Error(i18n.t("taskpane.errors.generateTableFirst"));
    await word.insertStructuredTable(generatedTable.headers, generatedTable.rows);
    required<HTMLElement>("#table-preview-status").textContent =
      i18n.t("taskpane.status.insertedAtCursor");
  } catch (error) { showError(error); }
});

function currentMarkdownSettings(): MarkdownSettings {
  return {
    ...DEFAULT_MARKDOWN_SETTINGS,
    ...readLocalSettings<Partial<MarkdownSettings>>(
      "wordollama-markdown-settings",
      DEFAULT_MARKDOWN_SETTINGS,
    ),
  };
}

function currentMarkdownOptions(): MarkdownConversionOptions {
  return currentMarkdownSettings();
}

function currentMarkdownStyleMappings(): Record<string, string> {
  return buildMarkdownStyleMappings(currentMarkdownSettings());
}

function updateMarkdownPreview(): void {
  const source = required<HTMLTextAreaElement>("#markdown-source").value;
  const preview = required<HTMLDivElement>("#markdown-preview");
  convertedMarkdownHtml = source.trim() ? markdownToHtml(source, currentMarkdownOptions()) : "";
  required<HTMLButtonElement>("#markdown-insert").disabled = !convertedMarkdownHtml;
  preview.classList.toggle("empty-panel", !convertedMarkdownHtml);
  if (!convertedMarkdownHtml) {
    preview.replaceChildren();
    required<HTMLElement>("#markdown-preview-status").textContent = "";
    return;
  }
  preview.innerHTML = convertedMarkdownHtml;
  required<HTMLElement>("#markdown-preview-status").textContent =
    i18n.t("taskpane.status.markdownConverted");
}

async function openMarkdownWorkflow(): Promise<void> {
  setPrimaryWorkspace("markdown");
  try {
    const selection = await word.getSelection();
    if (selection.text.trim()) required<HTMLTextAreaElement>("#markdown-source").value = selection.text;
  } catch {
    // Manual input remains available outside Word.
  }
  updateMarkdownPreview();
}

required<HTMLButtonElement>("#close-markdown-workflow").addEventListener("click", () => setPrimaryWorkspace(null));
required<HTMLButtonElement>("#markdown-paste").addEventListener("click", async () => {
  try {
    clearError();
    required<HTMLTextAreaElement>("#markdown-source").value = await navigator.clipboard.readText();
    updateMarkdownPreview();
  } catch {
    showError(new Error(i18n.t("taskpane.errors.clipboardReadFailed")));
  }
});
required<HTMLButtonElement>("#markdown-load-selection").addEventListener("click", async () => {
  try {
    clearError();
    const selection = await word.getSelection();
    if (!selection.text.trim()) throw new Error(i18n.t("taskpane.errors.selectionEmpty"));
    required<HTMLTextAreaElement>("#markdown-source").value = selection.text;
    updateMarkdownPreview();
  } catch (error) { showError(error); }
});
required<HTMLButtonElement>("#markdown-clear").addEventListener("click", () => {
  required<HTMLTextAreaElement>("#markdown-source").value = "";
  updateMarkdownPreview();
});
required<HTMLTextAreaElement>("#markdown-source").addEventListener("input", updateMarkdownPreview);
required<HTMLButtonElement>("#markdown-insert").addEventListener("click", async () => {
  try {
    if (!convertedMarkdownHtml) throw new Error(i18n.t("taskpane.errors.markdownRequired"));
    const markdown = required<HTMLTextAreaElement>("#markdown-source").value;
    await word.insertStyledHtmlBlocksAtSelection(
      markdownToBlocks(markdown, currentMarkdownOptions()),
      currentMarkdownStyleMappings(),
      currentMarkdownOptions().notePlacement,
    );
    required<HTMLElement>("#markdown-preview-status").textContent =
      i18n.t("taskpane.status.insertedWord");
  } catch (error) { showError(error); }
});

function updateHtmlAppActions(): void {
  const hasCode = Boolean(required<HTMLTextAreaElement>("#html-app-code").value.trim());
  const hasName = Boolean(required<HTMLInputElement>("#html-app-name").value.trim());
  const idle = htmlAbortController === null;
  required<HTMLButtonElement>("#html-app-preview").disabled = !hasCode || !idle;
  required<HTMLButtonElement>("#html-app-download").disabled = !hasCode || !idle;
  required<HTMLButtonElement>("#html-app-save").disabled = !hasCode || !hasName || !idle;
  required<HTMLButtonElement>("#html-app-delete").disabled = !selectedHtmlAppId || !idle;
}

function renderHtmlLibrary(): void {
  const select = required<HTMLSelectElement>("#html-app-library");
  select.replaceChildren(new Option(i18n.t("taskpane.html.selectSaved"), ""));
  htmlLibrary
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .forEach((app) => select.add(new Option(app.name, app.id)));
  select.value = selectedHtmlAppId;
  required<HTMLElement>("#html-library-status").textContent =
    htmlLibrary.length
      ? i18n.t("taskpane.html.savedCount", { count: htmlLibrary.length })
      : i18n.t("taskpane.html.noneSaved");
  updateHtmlAppActions();
}

function openHtmlWorkflow(): void {
  htmlAbortController?.abort();
  try { htmlLibrary = loadHtmlLibrary(localStorage); } catch { htmlLibrary = []; }
  selectedHtmlAppId = "";
  required<HTMLSelectElement>("#html-app-library").value = "";
  required<HTMLElement>("#html-preview-section").hidden = true;
  setPrimaryWorkspace("html");
  renderHtmlLibrary();
}

function previewHtmlApp(): void {
  const html = normalizeHtmlDocument(required<HTMLTextAreaElement>("#html-app-code").value);
  required<HTMLIFrameElement>("#html-app-frame").srcdoc = buildSandboxedPreview(html);
  required<HTMLElement>("#html-preview-section").hidden = false;
}

required<HTMLButtonElement>("#close-html-workflow").addEventListener("click", () => {
  htmlAbortController?.abort();
  required<HTMLIFrameElement>("#html-app-frame").srcdoc = "";
  setPrimaryWorkspace(null);
});
required<HTMLTextAreaElement>("#html-app-code").addEventListener("input", () => {
  required<HTMLElement>("#html-preview-section").hidden = true;
  updateHtmlAppActions();
});
required<HTMLInputElement>("#html-app-name").addEventListener("input", updateHtmlAppActions);
required<HTMLButtonElement>("#html-app-generate").addEventListener("click", async () => {
  const generate = required<HTMLButtonElement>("#html-app-generate");
  const cancel = required<HTMLButtonElement>("#html-app-cancel");
  const code = required<HTMLTextAreaElement>("#html-app-code");
  clearError();
  htmlAbortController = new AbortController();
  generate.disabled = true;
  cancel.disabled = false;
  beginStreamingText(code);
  updateHtmlAppActions();
  try {
    const finalResult = await generateHtmlApp(
      runtime,
      required<HTMLTextAreaElement>("#html-app-prompt").value,
      htmlAbortController.signal,
      (content) => {
        updateStreamingText(code, content);
        updateHtmlAppActions();
      },
    );
    endStreamingText(code, finalResult);
    previewHtmlApp();
  } catch (error) {
    endStreamingText(code);
    if ((error as { name?: string }).name !== "AbortError") showError(error);
  } finally {
    endStreamingText(code);
    htmlAbortController = null;
    generate.disabled = false;
    cancel.disabled = true;
    updateHtmlAppActions();
  }
});
required<HTMLButtonElement>("#html-app-cancel").addEventListener("click", () => htmlAbortController?.abort());
required<HTMLButtonElement>("#html-app-preview").addEventListener("click", () => {
  try { clearError(); previewHtmlApp(); } catch (error) { showError(error); }
});
required<HTMLSelectElement>("#html-app-library").addEventListener("change", (event) => {
  selectedHtmlAppId = (event.currentTarget as HTMLSelectElement).value;
  const app = htmlLibrary.find((candidate) => candidate.id === selectedHtmlAppId);
  if (app) {
    required<HTMLInputElement>("#html-app-name").value = app.name;
    required<HTMLTextAreaElement>("#html-app-code").value = app.html;
    required<HTMLElement>("#html-preview-section").hidden = true;
  }
  updateHtmlAppActions();
});
required<HTMLButtonElement>("#html-app-save").addEventListener("click", async () => {
  try {
    clearError();
    const name = required<HTMLInputElement>("#html-app-name").value.trim();
    const html = normalizeHtmlDocument(required<HTMLTextAreaElement>("#html-app-code").value);
    if (!name) throw new Error(i18n.t("taskpane.errors.appNameRequired"));
    const sameName = htmlLibrary.find((app) =>
      app.id !== selectedHtmlAppId && app.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
    if (sameName && !await requestConfirmation(
      i18n.t("taskpane.confirm.appOverwrite", { name }),
      i18n.t("taskpane.confirm.overwrite"),
    )) return;
    const id = selectedHtmlAppId || sameName?.id ||
      (globalThis.crypto?.randomUUID?.() ?? `html-${Date.now()}`);
    const next: SavedHtmlApp = { id, name, html, updatedAt: new Date().toISOString() };
    htmlLibrary = [next, ...htmlLibrary.filter((app) => app.id !== id && app.id !== sameName?.id)];
    saveHtmlLibrary(localStorage, htmlLibrary);
    selectedHtmlAppId = id;
    renderHtmlLibrary();
    required<HTMLElement>("#html-library-status").textContent =
      i18n.t("taskpane.status.appSaved", { name });
  } catch (error) { showError(error); }
});
required<HTMLButtonElement>("#html-app-delete").addEventListener("click", async () => {
  try {
    const app = htmlLibrary.find((candidate) => candidate.id === selectedHtmlAppId);
    if (!app) throw new Error(i18n.t("taskpane.errors.selectAppToDelete"));
    if (!await requestConfirmation(
      i18n.t("taskpane.confirm.deleteNamed", { name: app.name }),
      i18n.t("taskpane.common.delete"),
    )) return;
    htmlLibrary = htmlLibrary.filter((candidate) => candidate.id !== app.id);
    saveHtmlLibrary(localStorage, htmlLibrary);
    selectedHtmlAppId = "";
    required<HTMLInputElement>("#html-app-name").value = "";
    required<HTMLTextAreaElement>("#html-app-code").value = "";
    required<HTMLElement>("#html-preview-section").hidden = true;
    renderHtmlLibrary();
  } catch (error) { showError(error); }
});
required<HTMLButtonElement>("#html-app-download").addEventListener("click", () => {
  try {
    const html = normalizeHtmlDocument(required<HTMLTextAreaElement>("#html-app-code").value);
    const name = required<HTMLInputElement>("#html-app-name").value.trim() || "WordOllama-App";
    const filename = `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")}.html`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) { showError(error); }
});

function updateImageActions(): void {
  const idle = imageAbortController === null;
  const hasImage = Boolean(selectedImageDataUrl);
  const hasResult = Boolean(required<HTMLTextAreaElement>("#image-result").value.trim());
  required<HTMLButtonElement>("#image-analyze").disabled = !hasImage || !idle;
  required<HTMLButtonElement>("#image-insert").disabled = !hasResult || !idle;
  required<HTMLButtonElement>("#image-copy").disabled = !hasResult || !idle;
}

function openImageWorkflow(): void {
  setPrimaryWorkspace("image");
  updateImageActions();
}

required<HTMLButtonElement>("#close-image-workflow").addEventListener("click", () => {
  imageAbortController?.abort();
  setPrimaryWorkspace(null);
});
required<HTMLInputElement>("#image-file").addEventListener("change", async (event) => {
  try {
    clearError();
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    selectedImageDataUrl = await readImageDataUrl(file);
    const preview = required<HTMLImageElement>("#image-preview");
    preview.src = selectedImageDataUrl;
    preview.hidden = false;
    required<HTMLElement>("#image-empty-state").hidden = true;
    required<HTMLElement>("#image-file-status").textContent =
      `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
    required<HTMLElement>("#image-file-status").classList.add("has-file");
    required<HTMLTextAreaElement>("#image-result").value = "";
    updateImageActions();
  } catch (error) {
    selectedImageDataUrl = "";
    (event.currentTarget as HTMLInputElement).value = "";
    const status = required<HTMLElement>("#image-file-status");
    status.textContent = i18n.t("taskpane.image.noneSelected");
    status.classList.remove("has-file");
    showError(error);
    updateImageActions();
  }
});
required<HTMLTextAreaElement>("#image-result").addEventListener("input", updateImageActions);
required<HTMLButtonElement>("#image-analyze").addEventListener("click", async () => {
  const analyze = required<HTMLButtonElement>("#image-analyze");
  const cancel = required<HTMLButtonElement>("#image-cancel");
  const result = required<HTMLTextAreaElement>("#image-result");
  clearError();
  imageAbortController = new AbortController();
  analyze.disabled = true;
  cancel.disabled = false;
  beginStreamingText(result);
  updateImageActions();
  try {
    const finalResult = await analyzeImage(
      runtime,
      selectedImageDataUrl,
      required<HTMLTextAreaElement>("#image-prompt").value,
      imageAbortController.signal,
      (content) => {
        updateStreamingText(result, content);
        updateImageActions();
      },
    );
    endStreamingText(result, finalResult);
  } catch (error) {
    endStreamingText(result);
    if ((error as { name?: string }).name !== "AbortError") showError(error);
  } finally {
    endStreamingText(result);
    imageAbortController = null;
    analyze.disabled = false;
    cancel.disabled = true;
    updateImageActions();
  }
});
required<HTMLButtonElement>("#image-cancel").addEventListener("click", () => imageAbortController?.abort());
required<HTMLButtonElement>("#image-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(required<HTMLTextAreaElement>("#image-result").value); }
  catch (error) { showError(error); }
});
required<HTMLButtonElement>("#image-insert").addEventListener("click", async () => {
  try { await word.insertAtCursor(required<HTMLTextAreaElement>("#image-result").value); }
  catch (error) { showError(error); }
});

function renderLawArticle(article: LawArticleResult | null): void {
  currentLawArticle = article;
  const card = required<HTMLElement>("#law-result");
  card.hidden = !article;
  required<HTMLButtonElement>("#law-copy").disabled = !article;
  required<HTMLButtonElement>("#law-insert").disabled = !article;
  if (!article) return;
  required<HTMLElement>("#law-result-title").textContent = `${article.lawName} ${article.articleNumber}`;
  required<HTMLElement>("#law-result-category").textContent = article.category;
  required<HTMLElement>("#law-result-content").textContent = article.content;
}

function openLawWorkflow(): void {
  renderLawArticle(null);
  setPrimaryWorkspace("law");
}

async function searchLawArticle(): Promise<void> {
  const search = required<HTMLButtonElement>("#law-search");
  const cancel = required<HTMLButtonElement>("#law-cancel");
  const status = required<HTMLElement>("#law-status");
  clearError();
  renderLawArticle(null);
  lawAbortController = new AbortController();
  search.disabled = true;
  cancel.disabled = false;
  status.textContent = i18n.t("taskpane.status.searching");
  try {
    const article = await runtime.searchLawArticle(
      required<HTMLInputElement>("#law-name").value.trim(),
      required<HTMLInputElement>("#law-article").value.trim(),
      lawAbortController.signal,
    );
    renderLawArticle(article);
    status.textContent = i18n.t("taskpane.status.searchSucceeded");
  } catch (error) {
    status.textContent = (error as { name?: string }).name === "AbortError"
      ? i18n.t("taskpane.status.cancelled")
      : i18n.t("taskpane.status.searchFailed");
    if ((error as { name?: string }).name !== "AbortError") showError(error);
  } finally {
    lawAbortController = null;
    search.disabled = false;
    cancel.disabled = true;
  }
}

required<HTMLButtonElement>("#close-law-workflow").addEventListener("click", () => {
  lawAbortController?.abort();
  setPrimaryWorkspace(null);
});
required<HTMLButtonElement>("#law-search").addEventListener("click", searchLawArticle);
for (const selector of ["#law-name", "#law-article"]) {
  required<HTMLInputElement>(selector).addEventListener("keydown", (event) => {
    if (event.key === "Enter") void searchLawArticle();
  });
}
required<HTMLButtonElement>("#law-cancel").addEventListener("click", () => lawAbortController?.abort());
required<HTMLButtonElement>("#law-copy").addEventListener("click", async () => {
  try {
    if (!currentLawArticle) throw new Error(i18n.t("taskpane.errors.noArticleToCopy"));
    await navigator.clipboard.writeText(formatLawArticle(currentLawArticle));
    required<HTMLElement>("#law-status").textContent = i18n.t("taskpane.status.articleCopied");
  } catch (error) { showError(error); }
});
required<HTMLButtonElement>("#law-insert").addEventListener("click", async () => {
  try {
    if (!currentLawArticle) throw new Error(i18n.t("taskpane.errors.noArticleToInsert"));
    await word.insertAtCursor(formatLawArticle(currentLawArticle));
    required<HTMLElement>("#law-status").textContent = i18n.t("taskpane.status.insertedWord");
  } catch (error) { showError(error); }
});

function updateMootActions(): void {
  const hasResult = Boolean(required<HTMLTextAreaElement>("#moot-result").value.trim());
  const idle = mootAbortController === null;
  required<HTMLButtonElement>("#moot-insert").disabled = !hasResult || !idle;
  required<HTMLButtonElement>("#moot-copy").disabled = !hasResult || !idle;
}

async function openMootWorkflow(): Promise<void> {
  setPrimaryWorkspace("moot");
  try {
    required<HTMLTextAreaElement>("#moot-source").value = await readTextWorkflowDocument();
  } catch {
    // Manual input remains available outside Word.
  }
  updateMootActions();
}

required<HTMLButtonElement>("#close-moot-workflow").addEventListener("click", () => {
  mootAbortController?.abort();
  setPrimaryWorkspace(null);
});
required<HTMLButtonElement>("#moot-load-document").addEventListener("click", async () => {
  try { required<HTMLTextAreaElement>("#moot-source").value = await readTextWorkflowDocument(); }
  catch (error) { showError(error); }
});
required<HTMLButtonElement>("#moot-load-selection").addEventListener("click", async () => {
  try {
    const selection = await word.getSelection();
    if (!selection.text.trim()) throw new Error(i18n.t("taskpane.errors.selectionEmpty"));
    required<HTMLTextAreaElement>("#moot-source").value = selection.text;
  } catch (error) { showError(error); }
});
required<HTMLTextAreaElement>("#moot-result").addEventListener("input", updateMootActions);
required<HTMLButtonElement>("#moot-generate").addEventListener("click", async () => {
  const generate = required<HTMLButtonElement>("#moot-generate");
  const cancel = required<HTMLButtonElement>("#moot-cancel");
  const result = required<HTMLTextAreaElement>("#moot-result");
  clearError();
  mootAbortController = new AbortController();
  generate.disabled = true;
  cancel.disabled = false;
  beginStreamingText(result);
  updateMootActions();
  try {
    const finalResult = await investigatePleading(
      runtime,
      required<HTMLSelectElement>("#moot-pleading-type").value as PleadingType,
      required<HTMLTextAreaElement>("#moot-source").value,
      mootAbortController.signal,
      (content) => {
        updateStreamingText(result, content);
        updateMootActions();
      },
    );
    endStreamingText(result, finalResult);
  } catch (error) {
    endStreamingText(result);
    if ((error as { name?: string }).name !== "AbortError") showError(error);
  } finally {
    endStreamingText(result);
    mootAbortController = null;
    generate.disabled = false;
    cancel.disabled = true;
    updateMootActions();
  }
});
required<HTMLButtonElement>("#moot-cancel").addEventListener("click", () => mootAbortController?.abort());
required<HTMLButtonElement>("#moot-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(required<HTMLTextAreaElement>("#moot-result").value); }
  catch (error) { showError(error); }
});
required<HTMLButtonElement>("#moot-insert").addEventListener("click", async () => {
  try { await word.insertAtCursor(required<HTMLTextAreaElement>("#moot-result").value); }
  catch (error) { showError(error); }
});

const selectedCustomPromptIds = new Set<string>();

function customPromptOutputLabel(mode: CustomPromptOutputMode): string {
  if (mode === "TrackedChanges") return i18n.t("taskpane.prompts.trackedReplace");
  if (mode === "Comment") return i18n.t("taskpane.prompts.comment");
  return i18n.t("taskpane.text.insertBelow");
}

function showCustomPromptView(view: "launcher" | "manager" | "runner"): void {
  required<HTMLElement>("#custom-prompt-launcher").hidden = view !== "launcher";
  required<HTMLElement>("#custom-prompt-manager").hidden = view !== "manager";
  required<HTMLElement>("#custom-prompt-runner").hidden = view !== "runner";
}

function createPromptRow(prompt: CustomPromptDefinition, management = false): HTMLElement {
  const row = document.createElement("div");
  row.className = management ? "prompt-manage-row" : "prompt-command-row";
  row.dataset.promptId = prompt.id;

  if (management) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "checkbox checkbox-primary checkbox-sm";
    checkbox.checked = selectedCustomPromptIds.has(prompt.id);
    checkbox.setAttribute("aria-label", i18n.t("taskpane.prompts.selectNamed", { name: prompt.name }));
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedCustomPromptIds.add(prompt.id);
      else selectedCustomPromptIds.delete(prompt.id);
      updateCustomPromptManagerActions();
    });
    row.appendChild(checkbox);
  }

  const main = document.createElement("button");
  main.type = "button";
  main.className = management ? "prompt-manage-main" : "prompt-command-main";
  const title = document.createElement("strong");
  title.textContent = prompt.name;
  const meta = document.createElement("span");
  meta.className = "prompt-command-meta";
  meta.textContent = customPromptOutputLabel(prompt.outputMode);
  main.append(title, meta);
  if (management) main.addEventListener("click", () => openCustomPromptEditor(prompt));
  else main.addEventListener("click", () => void startCustomPrompt(prompt));
  row.appendChild(main);

  const favorite = document.createElement("button");
  favorite.type = "button";
  favorite.className = `btn btn-ghost btn-xs btn-square prompt-favorite${prompt.favorite ? " active" : ""}`;
  favorite.textContent = prompt.favorite ? "★" : "☆";
  favorite.title = prompt.favorite
    ? i18n.t("taskpane.prompts.removeFavorite")
    : i18n.t("taskpane.prompts.addFavorite");
  favorite.setAttribute("aria-label", favorite.title);
  favorite.addEventListener("click", () => {
    customPrompts = customPrompts.map((candidate) => candidate.id === prompt.id
      ? { ...candidate, favorite: !candidate.favorite, quickSlot: undefined }
      : candidate);
    saveCustomPrompts(localStorage, customPrompts);
    renderCustomPromptList();
    if (management) renderCustomPromptManager();
  });
  row.appendChild(favorite);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn btn-ghost btn-xs btn-square prompt-edit";
  edit.textContent = "⋯";
  edit.title = i18n.t("taskpane.common.edit");
  edit.setAttribute("aria-label", i18n.t("taskpane.prompts.editNamed", { name: prompt.name }));
  edit.addEventListener("click", () => openCustomPromptEditor(prompt));
  row.appendChild(edit);
  return row;
}

function appendPromptGroup(container: HTMLElement, title: string, prompts: CustomPromptDefinition[]): void {
  if (!prompts.length) return;
  const group = document.createElement("section");
  group.className = "prompt-command-group";
  const heading = document.createElement("h3");
  heading.textContent = title;
  group.appendChild(heading);
  prompts.forEach((prompt) => group.appendChild(createPromptRow(prompt)));
  container.appendChild(group);
}

function renderCustomPromptList(): void {
  const list = required<HTMLElement>("#custom-prompt-list");
  const query = required<HTMLInputElement>("#custom-prompt-search").value.trim().toLocaleLowerCase();
  list.replaceChildren();
  const matches = customPrompts.filter((prompt) =>
    [prompt.name, prompt.prompt].some((value) => value.toLocaleLowerCase().includes(query)),
  );
  if (query) {
    appendPromptGroup(list, i18n.t("taskpane.prompts.searchResults"), matches);
  } else {
    const favorites = matches.filter((prompt) => prompt.favorite)
      .sort((left, right) => left.name.localeCompare(right.name));
    const recent = matches.filter((prompt) => !prompt.favorite && prompt.lastUsedAt)
      .sort((left, right) => String(right.lastUsedAt).localeCompare(String(left.lastUsedAt))).slice(0, 6);
    const shown = new Set([...favorites, ...recent].map((prompt) => prompt.id));
    const remaining = matches.filter((prompt) => !shown.has(prompt.id))
      .sort((left, right) => left.name.localeCompare(right.name));
    appendPromptGroup(list, i18n.t("taskpane.prompts.favorites"), favorites);
    appendPromptGroup(list, i18n.t("taskpane.prompts.recent"), recent);
    appendPromptGroup(
      list,
      i18n.t(favorites.length || recent.length ? "taskpane.prompts.other" : "taskpane.prompts.all"),
      remaining,
    );
  }
  const empty = required<HTMLElement>("#custom-prompt-empty");
  empty.hidden = matches.length > 0;
  required<HTMLElement>("#custom-prompt-empty-title").textContent = i18n.t(
    query ? "taskpane.prompts.noResultsTitle" : "taskpane.prompts.emptyTitle",
  );
  required<HTMLElement>("#custom-prompt-empty-hint").textContent = i18n.t(
    query ? "taskpane.prompts.noResultsHint" : "taskpane.prompts.emptyHint",
  );
}

function updateCustomPromptManagerActions(): void {
  required<HTMLButtonElement>("#custom-prompt-delete-selected").disabled = selectedCustomPromptIds.size === 0;
  const all = required<HTMLInputElement>("#custom-prompt-select-all");
  all.checked = customPrompts.length > 0 && selectedCustomPromptIds.size === customPrompts.length;
  all.indeterminate = selectedCustomPromptIds.size > 0 && selectedCustomPromptIds.size < customPrompts.length;
}

function renderCustomPromptManager(): void {
  const list = required<HTMLElement>("#custom-prompt-manage-list");
  list.replaceChildren();
  customPrompts.slice().sort((left, right) => left.name.localeCompare(right.name))
    .forEach((prompt) => list.appendChild(createPromptRow(prompt, true)));
  updateCustomPromptManagerActions();
}

function setCustomPromptEditor(prompt?: CustomPromptDefinition): void {
  selectedCustomPromptId = prompt?.id ?? "";
  required<HTMLElement>("#custom-prompt-editor-title").textContent = prompt
    ? i18n.t("taskpane.prompts.edit")
    : i18n.t("taskpane.prompts.new");
  required<HTMLInputElement>("#custom-prompt-name").value = prompt?.name ?? "";
  required<HTMLSelectElement>("#custom-prompt-output").value = prompt?.outputMode ?? "TrackedChanges";
  required<HTMLTextAreaElement>("#custom-prompt-text").value = prompt?.prompt ?? "";
  required<HTMLInputElement>("#custom-prompt-favorite").checked = prompt?.favorite === true;
}

function openCustomPromptEditor(prompt?: CustomPromptDefinition): void {
  setCustomPromptEditor(prompt);
  localizeStaticDocument();
  required<HTMLDialogElement>("#custom-prompt-editor").showModal();
}

function collectCustomPromptDefinition(): CustomPromptDefinition {
  const existing = customPrompts.find((prompt) => prompt.id === selectedCustomPromptId);
  return {
    id: selectedCustomPromptId || (globalThis.crypto?.randomUUID?.() ?? `prompt-${Date.now()}`),
    name: required<HTMLInputElement>("#custom-prompt-name").value.trim(),
    prompt: required<HTMLTextAreaElement>("#custom-prompt-text").value.trim(),
    outputMode: required<HTMLSelectElement>("#custom-prompt-output").value as CustomPromptOutputMode,
    favorite: required<HTMLInputElement>("#custom-prompt-favorite").checked,
    lastUsedAt: existing?.lastUsedAt,
  };
}

function openCustomPromptWorkspace(promptId = ""): void {
  customPrompts = loadCustomPrompts(localStorage);
  setPrimaryWorkspace("custom");
  showCustomPromptView("launcher");
  renderCustomPromptList();
  if (promptId) {
    const prompt = customPrompts.find((candidate) => candidate.id === promptId);
    if (prompt) void startCustomPrompt(prompt);
  }
}

async function loadCustomPromptSelection(): Promise<void> {
  const selection = await word.getSelection();
  if (!selection.text.trim()) throw new Error(i18n.t("taskpane.errors.selectionEmpty"));
  customPromptSource = selection.text;
  required<HTMLElement>("#custom-prompt-source-status").textContent =
    i18n.t("taskpane.status.selectionLoaded", { count: selection.text.length });
  const preview = required<HTMLElement>("#custom-prompt-source-preview");
  preview.textContent = selection.text.length > 800 ? `${selection.text.slice(0, 800)}…` : selection.text;
  preview.hidden = false;
  updateCustomPromptActions();
}

async function currentCustomPromptSelection(): Promise<string> {
  const selection = await word.getSelection();
  if (!selection.text.trim()) throw new Error(i18n.t("taskpane.errors.selectionEmpty"));
  return selection.text;
}

required<HTMLButtonElement>("#close-custom-prompt").addEventListener("click", () => {
  customPromptAbortController?.abort();
  setPrimaryWorkspace(null);
});
required<HTMLInputElement>("#custom-prompt-search").addEventListener("input", renderCustomPromptList);
for (const selector of ["#custom-prompt-new", "#custom-prompt-empty-new", "#custom-prompt-manage-new"]) {
  required<HTMLButtonElement>(selector).addEventListener("click", () => openCustomPromptEditor());
}
required<HTMLButtonElement>("#custom-prompt-manage").addEventListener("click", () => {
  selectedCustomPromptIds.clear();
  renderCustomPromptManager();
  showCustomPromptView("manager");
});
required<HTMLButtonElement>("#custom-prompt-manage-back").addEventListener("click", () => {
  renderCustomPromptList();
  showCustomPromptView("launcher");
});
required<HTMLButtonElement>("#custom-prompt-runner-back").addEventListener("click", () => {
  customPromptAbortController?.abort();
  renderCustomPromptList();
  showCustomPromptView("launcher");
});
required<HTMLButtonElement>("#custom-prompt-editor-cancel").addEventListener("click", () => {
  required<HTMLDialogElement>("#custom-prompt-editor").close();
});
required<HTMLButtonElement>("#custom-prompt-save").addEventListener("click", () => {
  try {
    clearError();
    const prompt = collectCustomPromptDefinition();
    customPrompts = [prompt, ...customPrompts.filter((candidate) => candidate.id !== prompt.id)];
    saveCustomPrompts(localStorage, customPrompts);
    required<HTMLDialogElement>("#custom-prompt-editor").close();
    renderCustomPromptList();
    renderCustomPromptManager();
  } catch (error) { showError(error); }
});
required<HTMLInputElement>("#custom-prompt-select-all").addEventListener("change", (event) => {
  selectedCustomPromptIds.clear();
  if ((event.currentTarget as HTMLInputElement).checked) {
    customPrompts.forEach((prompt) => selectedCustomPromptIds.add(prompt.id));
  }
  renderCustomPromptManager();
});
required<HTMLButtonElement>("#custom-prompt-delete-selected").addEventListener("click", async () => {
  if (!selectedCustomPromptIds.size) return;
  if (!await requestConfirmation(
    i18n.t("taskpane.prompts.confirmDelete", { count: selectedCustomPromptIds.size }),
    i18n.t("taskpane.common.delete"),
  )) return;
  customPrompts = customPrompts.filter((prompt) => !selectedCustomPromptIds.has(prompt.id));
  saveCustomPrompts(localStorage, customPrompts);
  selectedCustomPromptIds.clear();
  renderCustomPromptManager();
  renderCustomPromptList();
});

async function runSelectedCustomPrompt(): Promise<void> {
  const definition = customPrompts.find((prompt) => prompt.id === selectedCustomPromptId);
  if (!definition) return;
  const run = required<HTMLButtonElement>("#custom-prompt-run");
  const cancel = required<HTMLButtonElement>("#custom-prompt-cancel");
  const result = required<HTMLTextAreaElement>("#custom-prompt-result");
  clearError();
  customPromptAbortController = new AbortController();
  run.disabled = true;
  cancel.disabled = false;
  beginStreamingText(result);
  updateCustomPromptActions();
  try {
    const finalResult = await runCustomPrompt(
      runtime,
      definition,
      customPromptSource,
      customPromptAbortController.signal,
      (content) => {
        updateStreamingText(result, content);
        updateCustomPromptActions();
      },
    );
    endStreamingText(result, finalResult);
    customPrompts = customPrompts.map((prompt) => prompt.id === definition.id
      ? { ...prompt, lastUsedAt: new Date().toISOString() }
      : prompt);
    saveCustomPrompts(localStorage, customPrompts);
  } catch (error) {
    endStreamingText(result);
    if ((error as { name?: string }).name !== "AbortError") showError(error);
  } finally {
    endStreamingText(result);
    customPromptAbortController = null;
    run.disabled = false;
    cancel.disabled = true;
    updateCustomPromptActions();
  }
}

async function startCustomPrompt(prompt: CustomPromptDefinition): Promise<void> {
  clearError();
  selectedCustomPromptId = prompt.id;
  required<HTMLElement>("#custom-prompt-running-name").textContent = prompt.name;
  required<HTMLTextAreaElement>("#custom-prompt-result").value = "";
  customPromptSource = "";
  required<HTMLElement>("#custom-prompt-source-preview").hidden = true;
  showCustomPromptView("runner");
  try {
    await loadCustomPromptSelection();
    await runSelectedCustomPrompt();
  } catch (error) {
    if ((error as { name?: string }).name !== "AbortError") showError(error);
    updateCustomPromptActions();
  }
}

function updateCustomPromptActions(): void {
  const hasResult = Boolean(required<HTMLTextAreaElement>("#custom-prompt-result").value.trim());
  const idle = customPromptAbortController === null;
  required<HTMLButtonElement>("#custom-prompt-run").disabled = !selectedCustomPromptId || !customPromptSource || !idle;
  required<HTMLButtonElement>("#custom-prompt-apply").disabled = !hasResult || !customPromptSource || !idle;
  required<HTMLButtonElement>("#custom-prompt-copy").disabled = !hasResult;
}

required<HTMLButtonElement>("#custom-prompt-run").addEventListener("click", () => void runSelectedCustomPrompt());
required<HTMLButtonElement>("#custom-prompt-cancel").addEventListener("click", () => customPromptAbortController?.abort());
required<HTMLButtonElement>("#custom-prompt-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(required<HTMLTextAreaElement>("#custom-prompt-result").value); }
  catch (error) { showError(error); }
});
required<HTMLButtonElement>("#custom-prompt-apply").addEventListener("click", async () => {
  let previousTrackingMode: string | null = null;
  try {
    clearError();
    await currentCustomPromptSelection();
    const definition = customPrompts.find((prompt) => prompt.id === selectedCustomPromptId);
    if (!definition) throw new Error(i18n.t("taskpane.errors.selectPrompt"));
    const result = required<HTMLTextAreaElement>("#custom-prompt-result").value;
    if (definition.outputMode === "Comment") {
      await word.addComment(result);
    } else if (definition.outputMode === "TrackedChanges") {
      previousTrackingMode = await word.beginTrackedChanges();
      await word.replaceSelection(result);
    } else {
      await word.insertAfterSelection(result);
    }
    required<HTMLElement>("#custom-prompt-source-status").textContent =
      i18n.t("taskpane.status.appliedToWord");
  } catch (error) {
    showError(error);
  } finally {
    try { await word.restoreTrackedChanges(previousTrackingMode); } catch (error) { showError(error); }
  }
});

required<HTMLButtonElement>("#custom-prompt-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(customPrompts, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "wordollama-commands.json";
  link.click();
  URL.revokeObjectURL(url);
});
required<HTMLButtonElement>("#custom-prompt-import").addEventListener("click", () => {
  required<HTMLInputElement>("#custom-prompt-import-file").click();
});
required<HTMLInputElement>("#custom-prompt-import-file").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as CustomPromptDefinition[];
    if (!Array.isArray(parsed)) throw new Error(i18n.t("taskpane.prompts.errors.invalidImport"));
    const incomingNames = new Set(parsed.map((prompt) => String(prompt.name ?? "").trim().toLocaleLowerCase()));
    const incomingIds = new Set(parsed.map((prompt) => String(prompt.id ?? "")));
    const merged = [...parsed, ...customPrompts.filter((prompt) =>
      !incomingIds.has(prompt.id) && !incomingNames.has(prompt.name.trim().toLocaleLowerCase()),
    )];
    saveCustomPrompts(localStorage, merged);
    customPrompts = loadCustomPrompts(localStorage);
    renderCustomPromptManager();
    renderCustomPromptList();
  } catch (error) { showError(error); }
  finally { input.value = ""; }
});

async function applyWorkflowRoute(): Promise<void> {
  const workflow = requestedWorkflow;
  if (!workflow || workflow === "agent") {
    if (activeSurface === "review") {
      activateTab("review");
      await loadReviewSettings();
    }
    return;
  }
  if (workflow === "settings") {
    openReactSettingsDialog();
    return;
  }
  if (workflow === "diagnostics") {
    activateUtilityPanel("diagnostics");
    openUtilityDialog();
    return;
  }
  if (workflow === "review") {
    activateTab("review");
    await loadReviewSettings();
    return;
  }
  if (workflow === "compare" || workflow === "contract-compare") {
    activateUtilityPanel("advanced");
    openUtilityDialog();
    return;
  }
  if (workflow === "table") {
    await openTableWorkflow();
    return;
  }
  if (workflow === "markdown") {
    await openMarkdownWorkflow();
    return;
  }
  if (workflow === "html") {
    openHtmlWorkflow();
    return;
  }
  if (workflow === "image") {
    openImageWorkflow();
    return;
  }
  if (workflow === "law-search") {
    openLawWorkflow();
    return;
  }
  if (workflow === "moot-court") {
    await openMootWorkflow();
    return;
  }
  if (workflow === "custom-prompts") {
    openCustomPromptWorkspace();
    return;
  }
  if (workflow === "translate") {
    await translationWorkspace.open();
    return;
  }
  const textWorkflow = TEXT_WORKFLOWS[workflow];
  if (textWorkflow) {
    await openTextWorkflow(textWorkflow);
    return;
  }
  const route = WORKFLOW_ROUTES[workflow];
  if (!route) return;
  activateTab("chat");
  const banner = required<HTMLElement>("#workflow-banner");
  banner.hidden = false;
  required<HTMLElement>("#workflow-title").textContent = i18n.t(route.titleKey);
  agentRequirement.value = i18n.t(route.promptKey);
  agentRequirement.focus();
}

function readLocalSettings<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalSettings(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function removeLocalSettings(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    appendDiagnostic(
      "storage",
      `remove ${key} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function syncStoredTheme(): void {
  const settings = readLocalSettings("wordollama-general-settings", {
    outputMode: "Auto", darkTheme: false,
    suppressPlan: false, suppressDiff: false,
  });
  if (settings.darkTheme) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

syncStoredTheme();
window.addEventListener("focus", syncStoredTheme);
window.addEventListener("storage", (event) => {
  if (event.key === "wordollama-general-settings") syncStoredTheme();
});

const diagnosticSettings = readLocalSettings("wordollama-diagnostic-settings", { enabled: false });
required<HTMLInputElement>("#setting-diagnostic-logging").checked = diagnosticSettings.enabled;
required<HTMLButtonElement>("#save-diagnostic-settings").addEventListener("click", () => {
  const enabled = required<HTMLInputElement>("#setting-diagnostic-logging").checked;
  writeLocalSettings("wordollama-diagnostic-settings", { enabled });
  required<HTMLElement>("#diagnostic-settings-status").textContent = enabled
    ? i18n.t("taskpane.utility.diagnostics.enabled")
    : i18n.t("taskpane.utility.diagnostics.disabled");
  if (enabled) {
    appendDiagnostic("settings", i18n.t("taskpane.utility.diagnostics.loggingEnabled"));
  }
});
required<HTMLButtonElement>("#clear-diagnostic-log").addEventListener("click", () => {
  diagnosticLog = [];
  writeLocalSettings("wordollama-diagnostic-log", diagnosticLog);
  required<HTMLElement>("#diagnostic-settings-status").textContent =
    i18n.t("taskpane.utility.diagnostics.logCleared");
});
required<HTMLButtonElement>("#copy-diagnostic-log").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(
      diagnosticLog.join("\n") || i18n.t("taskpane.utility.diagnostics.noLogs"),
    );
    required<HTMLElement>("#diagnostic-settings-status").textContent =
      i18n.t("taskpane.utility.diagnostics.logsCopied", { count: diagnosticLog.length });
  } catch (error) { showError(error); }
});
async function refreshAvailableSkills(): Promise<void> {
  if (skillRefreshPending) return skillRefreshPending;
  skillRefreshPending = runtime.listSkills()
    .then((skills) => {
      availableSkills = skills;
      availableSkillsRefreshedAt = Date.now();
    })
    .finally(() => { skillRefreshPending = null; });
  return skillRefreshPending;
}

function refreshAgentSkillsInBackground(): void {
  if (activeSurface !== "agent" || !bridgePaired) return;
  void refreshAvailableSkills().catch((error) =>
    appendDiagnostic("skills", `background refresh failed: ${error instanceof Error ? error.message : String(error)}`));
}

window.addEventListener("focus", refreshAgentSkillsInBackground);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshAgentSkillsInBackground();
});

function clearAgentImage(): void {
  agentImageDataUrl = "";
  agentImageInput.value = "";
  agentImagePreviewImage.removeAttribute("src");
  agentImagePreview.hidden = true;
}

function restoreAgentImage(imageDataUrl: string): void {
  agentImageDataUrl = imageDataUrl;
  agentImagePreviewImage.src = imageDataUrl;
  agentImagePreview.hidden = !imageDataUrl;
}

async function setAgentImage(file: File): Promise<void> {
  agentImageDataUrl = await readImageDataUrl(file);
  agentImagePreviewImage.src = agentImageDataUrl;
  agentImagePreview.hidden = false;
}

required<HTMLButtonElement>("#attach-image").addEventListener("click", () => agentImageInput.click());
required<HTMLButtonElement>("#agent-image-remove").addEventListener("click", clearAgentImage);
agentImageInput.addEventListener("change", async () => {
  const file = agentImageInput.files?.[0];
  if (!file) return;
  try {
    clearError();
    await setAgentImage(file);
  } catch (error) {
    clearAgentImage();
    showError(error);
  }
});
agentRequirement.addEventListener("paste", (event) => {
  const imageItem = Array.from(event.clipboardData?.items ?? [])
    .find((item) => item.kind === "file" && item.type.startsWith("image/"));
  const file = imageItem?.getAsFile();
  if (!file) return;
  event.preventDefault();
  void setAgentImage(file).catch((error) => {
    clearAgentImage();
    showError(error);
  });
});

function appendMessage(
  text: string,
  kind: "user" | "agent" | "system" | "activity" | "action" | "error-message" = "agent",
  imageDataUrl = "",
): HTMLDivElement {
  emptyChatState.remove();
  const row = document.createElement("div");
  row.className = `chat-message ${kind}`;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  if (imageDataUrl) {
    const image = document.createElement("img");
    image.className = "message-image";
    image.src = imageDataUrl;
    image.alt = i18n.t("taskpane.agent.userImageAlt");
    bubble.appendChild(image);
  }
  bubble.dataset.raw = text;
  if (kind === "agent") bubble.insertAdjacentHTML("beforeend", markdownToHtml(text, currentMarkdownOptions()));
  else bubble.append(document.createTextNode(text));
  row.appendChild(bubble);
  agentOutput.appendChild(row);
  agentOutput.scrollTop = agentOutput.scrollHeight;
  return bubble;
}

function updateActivity(
  bubble: HTMLDivElement | undefined,
  text: string,
  failed = false,
): void {
  if (!bubble) return;
  bubble.dataset.raw = text;
  bubble.textContent = text;
  bubble.closest(".chat-message")?.classList.toggle("failed", failed);
}

function appendToolFocusAction(
  bubble: HTMLDivElement,
  name: string,
  args: Record<string, unknown>,
): void {
  if (!["paragraph_index", "table_index", "keyword", "find", "anchor"].some((key) => args[key] !== undefined)) {
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-ghost btn-xs";
  button.textContent = i18n.t("taskpane.agent.focusTarget");
  button.addEventListener("click", async () => {
    try {
      const focused = await word.focusToolTarget(name, args);
      if (!focused) throw new Error(i18n.t("taskpane.agent.focusTargetUnavailable"));
    } catch (error) {
      showError(error);
    }
  });
  bubble.append(document.createElement("br"), button);
}

function setAgentRunning(running: boolean, status = i18n.t("taskpane.common.ready")): void {
  agentRunButton.disabled = running;
  agentStopButton.hidden = !running;
  agentStatusBar.hidden = !running;
  agentStatusText.textContent = status;
  if (!running) delete agentStatusBar.dataset.permissionMode;
}

function requestDecision(message: string, approveLabel: string, rejectLabel: string): Promise<boolean> {
  const bubble = appendMessage(message, "action");
  const actions = document.createElement("div");
  actions.className = "action-row";
  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "btn btn-primary btn-sm";
  approve.textContent = approveLabel;
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "btn btn-sm secondary-button";
  reject.textContent = rejectLabel;
  actions.append(approve, reject);
  bubble.appendChild(actions);
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      approve.disabled = true;
      reject.disabled = true;
      resolve(value);
    };
    approve.addEventListener("click", () => finish(true), { once: true });
    reject.addEventListener("click", () => finish(false), { once: true });
  });
}

type PermissionDecision = "once" | "agent-run" | "deny";

function requestPermissionDecision(message: string): Promise<PermissionDecision> {
  const bubble = appendMessage(message, "action");
  const scopeHint = document.createElement("p");
  scopeHint.className = "muted";
  scopeHint.textContent = i18n.t("taskpane.agent.permissionScopeHint");
  const actions = document.createElement("div");
  actions.className = "action-row wrap";
  const allowOnce = document.createElement("button");
  allowOnce.type = "button";
  allowOnce.className = "btn btn-primary btn-sm";
  allowOnce.textContent = i18n.t("taskpane.agent.allowOnce");
  const allowAgentRun = document.createElement("button");
  allowAgentRun.type = "button";
  allowAgentRun.className = "btn btn-sm secondary-button";
  allowAgentRun.textContent = i18n.t("taskpane.agent.allowAgentRun");
  const deny = document.createElement("button");
  deny.type = "button";
  deny.className = "btn btn-sm secondary-button";
  deny.textContent = i18n.t("taskpane.agent.deny");
  const buttons = [allowOnce, allowAgentRun, deny];
  actions.append(...buttons);
  bubble.append(scopeHint, actions);
  return new Promise((resolve) => {
    const finish = (value: PermissionDecision) => {
      buttons.forEach((button) => {
        button.disabled = true;
      });
      resolve(value);
    };
    allowOnce.addEventListener("click", () => finish("once"), { once: true });
    allowAgentRun.addEventListener("click", () => finish("agent-run"), { once: true });
    deny.addEventListener("click", () => finish("deny"), { once: true });
  });
}

function requestHumanInput(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "human-prompt-dialog";
    dialog.setAttribute("aria-labelledby", "human-prompt-title");

    const title = document.createElement("h2");
    title.id = "human-prompt-title";
    title.textContent = i18n.t("taskpane.dialog.inputTitle");

    const message = document.createElement("p");
    message.textContent = question;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "input input-sm";
    input.placeholder = i18n.t("taskpane.dialog.inputPlaceholder");
    input.setAttribute("aria-label", i18n.t("taskpane.dialog.answer"));

    const actions = document.createElement("div");
    actions.className = "action-row";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "btn btn-primary btn-sm";
    approve.textContent = i18n.t("taskpane.dialog.confirm");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-sm secondary-button";
    cancel.textContent = i18n.t("taskpane.dialog.cancel");
    actions.append(approve, cancel);
    dialog.append(title, message, input, actions);
    document.body.appendChild(dialog);

    let settled = false;
    const finish = (answer: string | null) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    approve.addEventListener("click", () =>
      finish(input.value.trim() || i18n.t("taskpane.dialog.confirm")));
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(input.value.trim() || i18n.t("taskpane.dialog.confirm"));
      }
    });

    dialog.showModal();
    input.focus();
  });
}

function requestConfirmation(
  question: string,
  approveLabel = i18n.t("taskpane.dialog.confirm"),
  rejectLabel = i18n.t("taskpane.dialog.cancel"),
): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "human-prompt-dialog";

    const title = document.createElement("h2");
    title.textContent = i18n.t("taskpane.dialog.confirmTitle");
    const message = document.createElement("p");
    message.textContent = question;
    const actions = document.createElement("div");
    actions.className = "action-row";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "btn btn-primary btn-sm";
    approve.textContent = approveLabel;
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "btn btn-sm secondary-button";
    reject.textContent = rejectLabel;
    actions.append(approve, reject);
    dialog.append(title, message, actions);
    document.body.appendChild(dialog);

    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(approved);
    };
    approve.addEventListener("click", () => finish(true));
    reject.addEventListener("click", () => finish(false));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.showModal();
    approve.focus();
  });
}

function showCopyFallback(titleText: string, value: string): Promise<void> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "human-prompt-dialog copy-fallback-dialog";
    const title = document.createElement("h2");
    title.textContent = titleText;
    const message = document.createElement("p");
    message.textContent = i18n.t("taskpane.dialog.copyFallback");
    const text = document.createElement("textarea");
    text.readOnly = true;
    text.value = value;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = i18n.t("taskpane.common.close");
    dialog.append(title, message, text, close);
    document.body.appendChild(dialog);
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve();
    };
    close.addEventListener("click", finish);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish();
    });
    dialog.showModal();
    text.focus();
    text.select();
  });
}

function initializeWorkflowRoute(): void {
  void applyWorkflowRoute()
    .catch(showError)
    .finally(() => {
      delete document.documentElement.dataset.routePending;
    });
}

window.addEventListener(SHARED_RUNTIME_NAVIGATION_EVENT, (event) => {
  const route = (event as CustomEvent<SharedRuntimeRoute>).detail;
  if (!route) return;
  requestedSurface = route.surface;
  requestedWorkflow = route.workflow;
  activeSurface = route.surface;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("surface", route.surface);
  nextUrl.searchParams.set("workflow", route.workflow);
  window.history.replaceState(null, "", nextUrl);
  updateRoutePresentation();
  initializeWorkflowRoute();
});

if (wpsHost) {
  officeReady = true;
  hostStatus.textContent = "";
  hostStatus.title = i18n.t("taskpane.agent.hostConnected", { host: "WPS Writer" });
  initializeWorkflowRoute();
  void activateBridgeSession().catch((error) =>
    appendDiagnostic("bridge", `automatic pairing failed: ${error instanceof Error ? error.message : String(error)}`));
} else if (typeof Office === "undefined") {
  hostStatus.textContent = "";
  void refreshRuntimeStatus();
  initializeWorkflowRoute();
} else {
  Office.onReady((info) => {
    officeReady = true;
    hostStatus.textContent = "";
    hostStatus.title = info.host
      ? i18n.t("taskpane.agent.hostConnected", { host: info.host })
      : "";
    initializeWorkflowRoute();
    if (Office.context.requirements?.isSetSupported?.("SharedRuntime", "1.1")) {
      void Office.addin.setStartupBehavior(Office.StartupBehavior.load).catch((error) =>
        appendDiagnostic("shared-runtime", `startup behavior failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    void activateBridgeSession().catch((error) =>
      appendDiagnostic("bridge", `automatic pairing failed: ${error instanceof Error ? error.message : String(error)}`));
    if (activeSurface === "review") {
      void restoreReviewState().catch((error) =>
        appendDiagnostic("review", `restore failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}

function readAgentRecovery(): AgentRecoveryState | null {
  try {
    const value = sessionStorage.getItem(AGENT_RECOVERY_KEY);
    return value ? JSON.parse(value) as AgentRecoveryState : null;
  } catch {
    return null;
  }
}

function saveAgentRecovery(state: AgentRecoveryState): void {
  sessionStorage.setItem(AGENT_RECOVERY_KEY, JSON.stringify(state));
}

function clearAgentRecovery(): void {
  sessionStorage.removeItem(AGENT_RECOVERY_KEY);
  required<HTMLElement>("#agent-recovery").hidden = true;
}

async function offerAgentRecovery(): Promise<void> {
  let recovery = readAgentRecovery();
  try {
    if (!recovery) {
      const recoveries = await runtime.listAgentRecoveries();
      const persisted = recoveries[0];
      if (!persisted) return;
      recovery = {
        sessionId: persisted.sessionId,
        requirement: persisted.userRequirement,
        imageDataUrl: "",
        executionMode: persisted.executionMode,
        iteration: persisted.iteration,
        updatedAt: persisted.updatedAt,
        persisted: true,
        goal: persisted.goal ?? "",
      };
      saveAgentRecovery(recovery);
    }
    const checkpoint = await runtime.getAgentCheckpoint(recovery.sessionId);
    recovery.iteration = checkpoint.iteration;
    recovery.executionMode = checkpoint.executionMode;
    recovery.updatedAt = checkpoint.createdAt;
    saveAgentRecovery(recovery);
    required<HTMLElement>("#agent-recovery-detail").textContent =
      i18n.t("taskpane.agent.recoveryMeta", {
        persisted: recovery.persisted ? i18n.t("taskpane.agent.encryptedRecovery") : "",
        iteration: checkpoint.iteration,
        date: new Date(checkpoint.createdAt).toLocaleString(),
      });
    required<HTMLElement>("#agent-recovery").hidden = false;
  } catch {
    clearAgentRecovery();
  }
}

async function consumeAgentSession(
  sessionId: string,
  requirement: string,
  imageDataUrl: string,
  executionMode: "ViewOnly" | "ProposeChanges" | "TrackedChanges",
  goal = "",
): Promise<void> {
  let streamingBubble: HTMLDivElement | null = null;
  let planRevisionRequested = false;
  let successfulWordWrites = 0;
  const toolActivities = new Map<string, HTMLDivElement>();
  const approvedForAgentRun = new Set<string>();
  const sources = new Map<string, { url: string; title: string; tool: string }>();
  const usedTools = new Set<string>();
  let latestAgentText = "";
  const writeToolNames = new Set(
    tools.list().filter((tool) => tool.isWriteOperation).map((tool) => tool.name),
  );
  for await (const event of runtime.readAgentEvents(sessionId)) {
    if (event.type === "checkpoint") {
      const checkpoint = event.data as { iteration?: number; createdAt?: string };
      saveAgentRecovery({
        sessionId,
        requirement,
        imageDataUrl,
        executionMode,
        iteration: checkpoint.iteration ?? 0,
        updatedAt: checkpoint.createdAt ?? new Date().toISOString(),
        goal,
      });
    } else if (event.type === "plan_pending") {
      const plan = event.data as { steps?: unknown } | undefined;
      const steps = Array.isArray(plan?.steps)
        ? plan.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0)
        : [];
      const planText = steps.length > 0
        ? steps.map((step, index) => `${index + 1}. ${step}`).join("\n")
        : event.message ?? requirement;
      const approved = await requestDecision(
        i18n.t("taskpane.agent.planMessage", { plan: planText }),
        i18n.t("taskpane.agent.approvePlan"),
        i18n.t("taskpane.agent.reviseRequirement"),
      );
      if (!approved) {
        planRevisionRequested = true;
        agentRequirement.value = requirement;
        restoreAgentImage(imageDataUrl);
        agentRequirement.focus();
        appendMessage(i18n.t("taskpane.agent.planCancelled"), "system");
      }
      await runtime.confirmAgentPlan(sessionId, approved);
    } else if (event.type === "plan_updated") {
      const plan = event.data as { steps?: string[] } | undefined;
      const steps = Array.isArray(plan?.steps) ? plan.steps : [];
      appendMessage(i18n.t("taskpane.agent.planUpdated", {
        plan: steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      }), "system");
    } else if (event.type === "context_compacted") {
      appendMessage(i18n.t("taskpane.agent.contextCompacted"), "system");
    } else if (event.type === "source") {
      const source = event.data as { url?: string; title?: string; tool?: string };
      if (source.url) sources.set(source.url, {
        url: source.url,
        title: source.title || source.url,
        tool: source.tool || "external",
      });
    } else if (event.type === "permission_request") {
      const permission = event.data as { callId: string; name: string; params: unknown };
      const permissionScopeKey = buildPermissionScopeKey(permission.name, permission.params);
      if (approvedForAgentRun.has(permissionScopeKey)) {
        appendMessage(
          i18n.t("taskpane.agent.permissionReused", { name: permission.name }),
          "system",
        );
        await runtime.submitPermission(
          sessionId,
          permission.callId,
          true,
          "approved-for-current-agent-run",
        );
      } else {
        const decision = await requestPermissionDecision(
          i18n.t("taskpane.agent.permissionMessage", {
            name: permission.name,
            params: formatPermissionParams(permission.params),
          }),
        );
        if (decision === "agent-run") approvedForAgentRun.add(permissionScopeKey);
        await runtime.submitPermission(
          sessionId,
          permission.callId,
          decision !== "deny",
          decision,
        );
      }
    } else if (event.type === "text_delta" && event.message) {
      if (!streamingBubble) streamingBubble = appendMessage("", "agent");
      const raw = (streamingBubble.dataset.raw ?? "") + event.message;
      streamingBubble.dataset.raw = raw;
      latestAgentText = raw;
      streamingBubble.innerHTML = markdownToHtml(raw, currentMarkdownOptions());
      agentOutput.scrollTop = agentOutput.scrollHeight;
    } else if (event.type === "tool_call") {
      streamingBubble = null;
      const call = event.data as {
        callId: string;
        name: string;
        execution?: string;
        params: Record<string, unknown>;
      };
      const activity = appendMessage(
        i18n.t("taskpane.agent.usingTool", { name: call.name }),
        "activity",
      );
      toolActivities.set(call.callId, activity);
      usedTools.add(call.name);
      if (call.execution === "bridge") continue;
      try {
        const result = await tools.execute(call.name, call.params || {});
        await runtime.submitToolResult(sessionId, call.callId, result);
        updateActivity(activity, i18n.t("taskpane.agent.toolComplete", { name: call.name }));
        appendToolFocusAction(activity, call.name, call.params || {});
        if (writeToolNames.has(call.name)) successfulWordWrites += 1;
      } catch (toolError) {
        const message = toolError instanceof Error ? toolError.message : String(toolError);
        await runtime.submitToolResult(
          sessionId,
          call.callId,
          message,
          true,
        );
        updateActivity(
          activity,
          i18n.t("taskpane.agent.toolError", { name: call.name, result: message }),
          true,
        );
      }
    } else if (event.type === "tool_result") {
      streamingBubble = null;
      const result = event.data as { callId?: string; name: string; result: string; isError: boolean };
      const text =
        result.isError
          ? i18n.t("taskpane.agent.toolError", { name: result.name, result: result.result })
          : i18n.t("taskpane.agent.toolComplete", { name: result.name });
      const activity = result.callId ? toolActivities.get(result.callId) : undefined;
      if (activity) updateActivity(activity, text, result.isError);
      else appendMessage(text, result.isError ? "error-message" : "activity");
    } else if (event.type === "completed" || event.type === "cancelled") {
      clearAgentRecovery();
      if (event.type === "completed" && sources.size > 0) appendAgentSources([...sources.values()]);
      if (event.type === "completed") appendCreateSkillAction({
        requirement,
        taskResult: latestAgentText || event.message || "",
        toolsUsed: [...usedTools],
      }, forceSkillCreationForNextRun);
      forceSkillCreationForNextRun = false;
      if (event.type === "completed" && successfulWordWrites > 0) {
        const settings = readLocalSettings("wordollama-general-settings", {
          suppressDiff: false,
        });
        if (!settings.suppressDiff) {
          const canReadRevisions = word.supportsTool("revisions");
          if (!canReadRevisions) {
            appendMessage(
              i18n.t("taskpane.agent.writesUnsupported", { count: successfulWordWrites }),
              "system",
            );
          } else {
            appendMessage(
              i18n.t("taskpane.agent.writesReview", { count: successfulWordWrites }),
              "system",
            );
          }
        }
      }
    } else if (event.type === "failed") {
      clearAgentRecovery();
      if (planRevisionRequested) break;
      throw new Error(event.message || i18n.t("taskpane.agent.executionFailed"));
    }
  }
}

window.addEventListener("message", (event) => {
  if (!wpsHost || !settingsPopup || event.source !== settingsPopup || event.origin !== window.location.origin) {
    return;
  }
  const dialog = {
    close: () => {
      settingsPopup?.close();
      settingsPopup = null;
    },
    messageChild: (message: string) => settingsPopup?.postMessage(message, window.location.origin),
  } as unknown as Office.Dialog;
  const message = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
  void handleReactSettingsMessage(dialog, message, event.origin);
});

function openAgentSource(url: string): void {
  const officeUi = typeof Office === "undefined" ? undefined : Office.context?.ui as Office.UI & {
    openBrowserWindow?: (target: string) => void;
  };
  if (officeUi?.openBrowserWindow) officeUi.openBrowserWindow(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

function appendAgentSources(sources: Array<{ url: string; title: string; tool: string }>): void {
  const bubble = appendMessage("", "system");
  bubble.classList.add("agent-sources");
  const heading = document.createElement("strong");
  heading.textContent = i18n.t("taskpane.agent.sourcesTitle");
  const list = document.createElement("ul");
  for (const source of sources) {
    const item = document.createElement("li");
    const link = document.createElement("button");
    link.type = "button";
    link.className = "btn btn-link btn-xs agent-source-link";
    link.textContent = source.title || source.url;
    link.title = `${source.url} · ${source.tool}`;
    link.addEventListener("click", () => openAgentSource(source.url));
    item.append(link);
    list.append(item);
  }
  bubble.append(heading, list);
}

function appendCreateSkillAction(
  task: { requirement: string; taskResult: string; toolsUsed: string[] },
  runImmediately = false,
): void {
  const bubble = appendMessage(i18n.t("taskpane.agent.skillReviewHint"), "action");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary btn-sm";
  button.textContent = i18n.t("taskpane.agent.createSkillFromTask");
  const feedback = document.createElement("textarea");
  feedback.className = "textarea textarea-sm w-full";
  feedback.rows = 2;
  feedback.placeholder = i18n.t("taskpane.agent.skillFeedbackPlaceholder");
  const generate = async () => {
    button.disabled = true;
    button.textContent = i18n.t("taskpane.agent.creatingSkill");
    try {
      const result = await runtime.generateSkill({
        ...task,
        userFeedback: feedback.value.trim(),
        officeTools: tools.list(),
        uiLocale: i18n.resolvedLanguage?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US",
      });
      await refreshAvailableSkills();
      bubble.textContent = i18n.t("taskpane.agent.skillCreated", { name: result.name });
    } catch (error) {
      button.disabled = false;
      button.textContent = i18n.t("taskpane.agent.createSkillFromTask");
      showError(error);
    }
  };
  button.addEventListener("click", () => void generate());
  bubble.append(feedback, button);
  if (runImmediately) void generate();
}

async function runAgent(requirement: string): Promise<void> {
  if (!requirement.trim()) throw new Error(i18n.t("taskpane.agent.instructionRequired"));
  clearError();
  activateTab("chat");
  const imageDataUrl = agentImageDataUrl;
  const goal = agentGoal.value.trim();
  const skillName = selectedAgentSkillName.trim() || undefined;
  selectedAgentSkillName = "";
  appendMessage(requirement, "user", imageDataUrl);
  agentRequirement.value = "";
  clearAgentImage();
  setAgentRunning(true, i18n.t("taskpane.agent.creatingTask"));
  let previousTrackingMode: string | null = null;
  lastAgentDocumentSnapshot = null;
  agentUndoTaskButton.hidden = true;
  try {
    const currentAgentSettings = readLocalSettings("wordollama-agent-settings", {
      maxIterations: 20,
      executionMode: "TrackedChanges" as const,
      unlimited: false,
      allowExternalTools: false,
      allowLocalTools: false,
      allowNetworkTools: false,
      allowMcpTools: false,
      permissionMode: "request" as "request" | "auto" | "full",
      // Compatibility aliases used by early settings builds.
      iterations: undefined as number | undefined,
      mode: undefined as string | undefined,
      externalTools: undefined as boolean | undefined,
    });
    const currentGeneralSettings = readLocalSettings("wordollama-general-settings", {
      suppressPlan: false,
      suppressDiff: false,
    });
    const storedExecutionMode = currentAgentSettings.mode ?? currentAgentSettings.executionMode;
    const executionMode = ["ViewOnly", "ProposeChanges", "TrackedChanges"].includes(storedExecutionMode)
      ? storedExecutionMode as "ViewOnly" | "ProposeChanges" | "TrackedChanges"
      : "TrackedChanges";
    const legacyExternalTools = currentAgentSettings.externalTools ?? currentAgentSettings.allowExternalTools;
    const permissionMode = currentAgentSettings.permissionMode === "auto" || currentAgentSettings.permissionMode === "full"
      ? currentAgentSettings.permissionMode
      : "request";
    if (permissionMode === "full") {
      const approved = await requestDecision(
        i18n.t("taskpane.agent.fullAccessConfirm"),
        i18n.t("taskpane.agent.enableForSession"),
        i18n.t("taskpane.common.cancel"),
      );
      if (!approved) {
        appendMessage(i18n.t("taskpane.agent.fullAccessCancelled"), "system");
        return;
      }
      agentStatusBar.dataset.permissionMode = "full";
      agentStatusText.textContent = i18n.t("taskpane.agent.fullAccessActive");
    }
    if (executionMode !== "ViewOnly") {
      lastAgentDocumentSnapshot = await word.captureDocumentSnapshot();
      if (!lastAgentDocumentSnapshot) {
        appendDiagnostic("agent", "task undo snapshot unavailable or exceeds the safe size limit");
      }
    }
    if (executionMode === "TrackedChanges") {
      previousTrackingMode = await word.beginTrackedChanges();
      if (previousTrackingMode === null) {
        appendMessage(i18n.t("taskpane.agent.trackingUnsupported"), "system");
      }
    }
    const session = await runtime.startAgent(requirement, tools.list(), {
      goal: goal || undefined,
      skillName,
      imageDataUrl: imageDataUrl || undefined,
      requirePlanConfirmation: !currentGeneralSettings.suppressPlan,
      maxIterations: currentAgentSettings.unlimited
        ? 0
        : Math.max(1, Math.min(200, Number(currentAgentSettings.iterations ?? currentAgentSettings.maxIterations) || 20)),
      executionMode,
      allowExternalTools: legacyExternalTools,
      allowLocalTools: currentAgentSettings.allowLocalTools || legacyExternalTools,
      allowNetworkTools: currentAgentSettings.allowNetworkTools || legacyExternalTools,
      allowMcpTools: currentAgentSettings.allowMcpTools || legacyExternalTools,
      permissionMode,
      languageMode: "auto",
      uiLocale: i18n.resolvedLanguage?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US",
    });
    activeSessionId = session.sessionId;
    saveAgentRecovery({
      sessionId: session.sessionId,
      requirement,
      imageDataUrl,
      executionMode,
      iteration: 0,
      updatedAt: new Date().toISOString(),
      goal,
    });
    setAgentRunning(true, i18n.t("taskpane.agent.running"));
    await consumeAgentSession(session.sessionId, requirement, imageDataUrl, executionMode, goal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendDiagnostic("agent", message);
    appendMessage(i18n.t("taskpane.errors.requestFailed"), "error-message");
    throw error;
  } finally {
    try { await word.restoreTrackedChanges(previousTrackingMode); }
    catch (restoreError) {
      showError(i18n.t("taskpane.agent.restoreTrackingFailed", {
        message: restoreError instanceof Error ? restoreError.message : String(restoreError),
      }));
    }
    try { lastAgentDocumentSnapshot = await word.finalizeDocumentSnapshot(lastAgentDocumentSnapshot); }
    catch (snapshotError) {
      lastAgentDocumentSnapshot = null;
      appendDiagnostic(
        "agent",
        `task undo finalization failed: ${snapshotError instanceof Error ? snapshotError.message : String(snapshotError)}`,
      );
    }
    activeSessionId = null;
    setAgentRunning(false);
    agentUndoTaskButton.hidden = !lastAgentDocumentSnapshot;
  }
}

agentUndoTaskButton.addEventListener("click", async () => {
  if (!lastAgentDocumentSnapshot) return;
  const approved = await requestDecision(
    i18n.t("taskpane.agent.undoTaskConfirm"),
    i18n.t("taskpane.agent.undoTask"),
    i18n.t("taskpane.common.cancel"),
  );
  if (!approved) return;
  try {
    await word.restoreDocumentSnapshot(lastAgentDocumentSnapshot);
    lastAgentDocumentSnapshot = null;
    agentUndoTaskButton.hidden = true;
    appendMessage(i18n.t("taskpane.agent.undoTaskComplete"), "system");
  } catch (error) {
    showError(error);
  }
});

agentRunButton.addEventListener("click", async () => {
  try {
    await runAgent(agentRequirement.value.trim());
  } catch (error) {
    showError(error);
  }
});

required<HTMLButtonElement>("#resume-agent-session").addEventListener("click", async () => {
  const recovery = readAgentRecovery();
  if (!recovery) {
    clearAgentRecovery();
    return;
  }
  let previousTrackingMode: string | null = null;
  try {
    clearError();
    activateTab("chat");
    required<HTMLElement>("#agent-recovery").hidden = true;
    appendMessage(i18n.t("taskpane.agent.resuming", { iteration: recovery.iteration }), "system");
    if (recovery.persisted) {
      appendMessage(
        i18n.t("taskpane.agent.replayWarning"),
        "system",
      );
    }
    if (recovery.executionMode === "TrackedChanges") {
      previousTrackingMode = await word.beginTrackedChanges();
    }
    activeSessionId = recovery.sessionId;
    setAgentRunning(true, i18n.t("taskpane.agent.restoring"));
    await consumeAgentSession(
      recovery.sessionId,
      recovery.requirement || i18n.t("taskpane.agent.recoveredTask"),
      recovery.imageDataUrl || "",
      recovery.executionMode,
      recovery.goal ?? "",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendDiagnostic("agent", message);
    appendMessage(i18n.t("taskpane.errors.requestFailed"), "error-message");
    showError(error);
  } finally {
    try { await word.restoreTrackedChanges(previousTrackingMode); } catch (error) { showError(error); }
    activeSessionId = null;
    setAgentRunning(false);
  }
});

required<HTMLButtonElement>("#discard-agent-session").addEventListener("click", async () => {
  const recovery = readAgentRecovery();
  try {
    if (recovery) await runtime.cancelAgent(recovery.sessionId);
  } catch (error) {
    showError(error);
  } finally {
    clearAgentRecovery();
  }
});

function clearAgentView(): void {
  agentOutput.replaceChildren(emptyChatState);
}

function closeCommandMenu(): void {
  required<HTMLElement>("#command-menu").hidden = true;
  commandMenuItems = [];
  selectedCommandIndex = -1;
}

function updateCommandSelection(): void {
  required<HTMLElement>("#command-menu")
    .querySelectorAll<HTMLButtonElement>(".command-item")
    .forEach((button, index) => {
      button.classList.toggle("selected", index === selectedCommandIndex);
      button.setAttribute("aria-selected", String(index === selectedCommandIndex));
    });
}

function executeCommandMenuItem(index: number): void {
  const item = commandMenuItems[index];
  if (!item) return;
  closeCommandMenu();
  selectedAgentSkillName = "";
  agentRequirement.value = "";
  item.action();
}

function renderCommandMenu(): void {
  const query = agentRequirement.value.trimStart();
  const menu = required<HTMLElement>("#command-menu");
  if (!query.startsWith("/") || query.includes("\n")) {
    closeCommandMenu();
    return;
  }
  if (bridgePaired && Date.now() - availableSkillsRefreshedAt > 2_000 && !skillRefreshPending) {
    void refreshAvailableSkills()
      .then(renderCommandMenu)
      .catch((error) =>
        appendDiagnostic("skills", `command refresh failed: ${error instanceof Error ? error.message : String(error)}`));
  }
  const normalized = query.toLocaleLowerCase();
  const commands: Array<{ label: string; hint?: string; action: () => void }> = [
    { label: "/clear", hint: i18n.t("taskpane.agent.clearHint"), action: clearAgentView },
    {
      label: "/new",
      hint: i18n.t("taskpane.agent.newChatHint"),
      action: () => {
        void (async () => {
          if (activeSessionId) await runtime.cancelAgent(activeSessionId);
          clearAgentView();
          appendMessage(i18n.t("taskpane.agent.newChatStarted"), "system");
        })().catch(showError);
      },
    },
    {
      label: "/goal",
      hint: i18n.t("taskpane.agent.goalHint"),
      action: () => {
        toggleAgentGoal.setAttribute("aria-expanded", "true");
        agentGoalRow.hidden = false;
        agentGoal.focus();
      },
    },
    {
      label: "/selection",
      hint: i18n.t("taskpane.agent.selectionHint"),
      action: () => {
        void word.getSelection()
          .then((selection) => {
            const text = selection.text.trim();
            agentRequirement.value = text
              ? i18n.t("taskpane.agent.selectionPrompt", { text })
              : "";
            agentRequirement.focus();
          })
          .catch(showError);
      },
    },
    {
      label: "/make-skill",
      hint: i18n.t("taskpane.agent.makeSkillHint"),
      action: () => {
        forceSkillCreationForNextRun = true;
        agentRequirement.value = i18n.t("taskpane.agent.makeSkillPrompt");
        agentRequirement.focus();
      },
    },
    {
      label: "/skills",
      hint: i18n.t("taskpane.agent.skillsHint"),
      action: () => {
        const list = availableSkills.length
          ? availableSkills.map((skill) => `- **${skill.name}**${skill.description ? ` — ${skill.description}` : ""}`).join("\n")
          : i18n.t("taskpane.agent.noSkills");
        const message = appendMessage(list, "agent");
        message.innerHTML = markdownToHtml(list, currentMarkdownOptions());
      },
    },
    {
      label: "/status",
      hint: i18n.t("taskpane.agent.statusHint"),
      action: () => {
        void runtime.getProviderSettings()
          .then((settings) => {
            const active = settings.profiles.find((profile) => profile.id === settings.activeProviderId);
            const agentSettings = readLocalSettings("wordollama-agent-settings", {
              executionMode: "TrackedChanges",
              permissionMode: "request",
            });
            const text = i18n.t("taskpane.agent.statusSummary", {
              model: active?.model || i18n.t("taskpane.agent.notConfigured"),
              provider: active?.name || i18n.t("taskpane.agent.notConfigured"),
              executionMode: agentSettings.executionMode,
              permissionMode: agentSettings.permissionMode,
              skills: availableSkills.length,
            });
            const message = appendMessage(text, "agent");
            message.innerHTML = markdownToHtml(text, currentMarkdownOptions());
          })
          .catch(showError);
      },
    },
    ...availableSkills.map((skill) => ({
      label: `/skill:${skill.name}`,
      hint: skill.description || "Skill",
      action: () => {
        selectedAgentSkillName = skill.name;
        agentRequirement.value = i18n.t("taskpane.agent.useSkill", { name: skill.name });
        agentRequirement.focus();
      },
    })),
  ].filter((item) => item.label.toLocaleLowerCase().startsWith(normalized));
  commandMenuItems = commands;
  menu.replaceChildren();
  if (!commands.length) {
    closeCommandMenu();
    return;
  }
  commands.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-item";
    button.setAttribute("role", "option");
    const label = document.createElement("strong");
    label.textContent = item.label;
    if (item.hint) button.title = item.hint;
    button.append(label);
    button.addEventListener("click", () => executeCommandMenuItem(index));
    menu.appendChild(button);
  });
  selectedCommandIndex = 0;
  menu.hidden = false;
  updateCommandSelection();
}

agentRequirement.addEventListener("input", renderCommandMenu);
agentRequirement.addEventListener("keydown", (event) => {
  if (!required<HTMLElement>("#command-menu").hidden) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      selectedCommandIndex =
        (selectedCommandIndex + direction + commandMenuItems.length) % commandMenuItems.length;
      updateCommandSelection();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandMenu();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      executeCommandMenuItem(selectedCommandIndex);
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    agentRunButton.click();
  }
});

agentStopButton.addEventListener("click", async () => {
  if (!activeSessionId) return;
  try {
    await runtime.cancelAgent(activeSessionId);
    appendMessage(i18n.t("taskpane.agent.stopRequested"), "system");
    agentStatusText.textContent = i18n.t("taskpane.agent.stopping");
  } catch (error) {
    showError(error);
  }
});

const MAX_REVIEW_PARAGRAPHS = 300;
const REVIEW_STATE_KEY = "wordollama-review-state-v1";

interface PersistedReviewState {
  fingerprint: string;
  issues: ReviewIssue[];
  suggestions: ReviewSuggestion[];
}

function paragraphSource(paragraphs: string[], start = 1): string {
  return paragraphs.map((text, index) => `[P${start + index}] ${text}`).join("\n");
}

function anchorMap(paragraphs: string[], start: number): Map<number, ReviewAnchor> {
  return new Map(createReviewAnchors(paragraphs, start).map((anchor) => [anchor.originalIndex, anchor]));
}

async function anchoredReviewMap(
  paragraphs: string[],
  start: number,
): Promise<Map<number, ReviewAnchor>> {
  const anchors = anchorMap(paragraphs, start);
  try {
    return await word.createReviewBookmarks(anchors);
  } catch (error) {
    appendDiagnostic("review", `bookmark fallback: ${error instanceof Error ? error.message : String(error)}`);
    return anchors;
  }
}

function reuseAnchors(
  chunks: Array<{ source: string; anchors: Map<number, ReviewAnchor> }>,
  anchors: Map<number, ReviewAnchor>,
): Array<{ source: string; anchors: Map<number, ReviewAnchor> }> {
  return chunks.map((chunk) => ({
    source: chunk.source,
    anchors: new Map([...chunk.anchors].map(([index, anchor]) => [
      index,
      anchors.get(index) ?? anchor,
    ])),
  }));
}

function attachReviewAnchors<T extends { paragraphIndex: number; anchor?: ReviewAnchor }>(
  items: T[],
  anchors: Map<number, ReviewAnchor>,
): T[] {
  return items.map((item) => ({
    ...item,
    anchor: item.paragraphIndex > 0 ? anchors.get(item.paragraphIndex) : undefined,
  }));
}

function reviewIssueKey(issue: ReviewIssue): string {
  return [
    issue.source,
    issue.paragraphIndex,
    normalizeReviewText(issue.title),
    normalizeReviewText(issue.excerpt),
  ].join("|");
}

function persistReviewState(): void {
  if (!currentReviewFingerprint) return;
  const state: PersistedReviewState = {
    fingerprint: currentReviewFingerprint,
    issues: reviewIssues.slice(-100),
    suggestions: reviewSuggestions.slice(-100),
  };
  writeLocalSettings(REVIEW_STATE_KEY, state);
  void word.writeDocumentSetting(REVIEW_STATE_KEY, state).catch((error) =>
    appendDiagnostic("review", `document state save fallback: ${error instanceof Error ? error.message : String(error)}`));
}

async function restoreReviewState(): Promise<void> {
  if (activeSurface !== "review") return;
  const saved = await word.readDocumentSetting<PersistedReviewState>(REVIEW_STATE_KEY)
    ?? readLocalSettings<PersistedReviewState | null>(REVIEW_STATE_KEY, null);
  const fingerprint = await word.getReviewDocumentFingerprint();
  currentReviewFingerprint = fingerprint;
  const handoff = readLocalSettings<ReviewHandoff | null>(REVIEW_HANDOFF_KEY, null);
  if (handoff?.fingerprint === fingerprint &&
      handoff.originalText?.trim() &&
      handoff.suggestedText?.trim()) {
    reviewScopeKind = "selection";
    reviewScope = `[P0] ${handoff.originalText}`;
    reviewScopeLabel = i18n.t("taskpane.review.handoffScope");
    reviewScopeAnchors = new Map();
    reviewScopeChunks = [{ source: reviewScope, anchors: reviewScopeAnchors }];
    reviewSuggestions = [{
      id: `handoff-${Date.parse(handoff.createdAt) || Date.now()}`,
      paragraphIndex: 0,
      originalText: handoff.originalText,
      suggestedText: handoff.suggestedText,
      reason: handoff.reason || i18n.t("taskpane.review.workspaceResult"),
      status: "pending",
    }];
    removeLocalSettings(REVIEW_HANDOFF_KEY);
    updateReviewPagination(1, 1, 1, 1);
    reviewScopeStatus.textContent = i18n.t("taskpane.review.scopeLoaded", {
      scope: reviewScopeLabel,
    });
    renderSuggestions();
    persistReviewState();
    return;
  }
  if (!saved?.fingerprint || !Array.isArray(saved.issues) || !Array.isArray(saved.suggestions)) return;
  if (saved.fingerprint !== fingerprint) return;
  reviewIssues = saved.issues.slice(-100);
  reviewSuggestions = saved.suggestions.slice(-100);
  renderIssues();
  renderSuggestions();
}

function trackedRevisionLabel(type: string): string {
  const labels: Record<string, string> = {
    Insert: i18n.t("taskpane.review.revisionTypes.insert"),
    Delete: i18n.t("taskpane.review.revisionTypes.delete"),
    Replace: i18n.t("taskpane.review.revisionTypes.replace"),
    Style: i18n.t("taskpane.review.revisionTypes.style"),
    Property: i18n.t("taskpane.review.revisionTypes.property"),
    ParagraphProperty: i18n.t("taskpane.review.revisionTypes.paragraphProperty"),
    TableProperty: i18n.t("taskpane.review.revisionTypes.tableProperty"),
    SectionProperty: i18n.t("taskpane.review.revisionTypes.sectionProperty"),
    MovedFrom: i18n.t("taskpane.review.revisionTypes.movedFrom"),
    MovedTo: i18n.t("taskpane.review.revisionTypes.movedTo"),
  };
  return labels[type] ?? type;
}

function renderTrackedRevisions(
  revisions: TrackedRevision[],
  total: number,
  truncated: boolean,
): void {
  const count = required<HTMLElement>("#tracked-revision-count");
  const acceptAll = required<HTMLButtonElement>("#accept-all-tracked-revisions");
  const rejectAll = required<HTMLButtonElement>("#reject-all-tracked-revisions");
  count.textContent = String(total);
  acceptAll.disabled = total === 0;
  rejectAll.disabled = total === 0;
  trackedRevisionList.replaceChildren();
  if (!revisions.length) {
    trackedRevisionList.className = "empty-panel";
    trackedRevisionList.textContent = i18n.t("taskpane.review.noRevisions");
    trackedRevisionStatus.textContent = i18n.t("taskpane.review.revisionsRead", { count: 0 });
    return;
  }
  trackedRevisionList.className = "suggestion-list";
  for (const revision of revisions) {
    const card = document.createElement("article");
    card.className = "card card-border review-item severity-low";
    const heading = document.createElement("div");
    heading.className = "review-item-heading";
    const title = document.createElement("strong");
    title.textContent = `${trackedRevisionLabel(revision.type)} · ${
      revision.author || i18n.t("taskpane.review.unknownAuthor")
    }`;
    const sequence = document.createElement("span");
    sequence.className = "badge badge-sm severity-badge";
    sequence.textContent = `#${revision.index}`;
    heading.append(title, sequence);
    const detail = document.createElement("p");
    const timestamp = revision.date
      ? new Date(revision.date).toLocaleString()
      : i18n.t("taskpane.review.unknownTime");
    detail.className = "muted";
    detail.textContent = [timestamp, revision.formatDescription].filter(Boolean).join(" · ");
    const excerpt = document.createElement("blockquote");
    excerpt.textContent = revision.text.trim()
      ? revision.text.slice(0, 800)
      : i18n.t("taskpane.review.structuralRevision");
    const actions = document.createElement("div");
    actions.className = "action-row wrap";
    for (const [label, action] of [
      [i18n.t("taskpane.review.focus"), "focus"],
      [i18n.t("taskpane.review.accept"), "accept"],
      [i18n.t("taskpane.review.reject"), "reject"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action === "focus" ? "secondary-button" : "";
      button.textContent = label;
      button.addEventListener("click", async () => {
        try {
          button.disabled = true;
          if (action === "focus") {
            await word.focusTrackedRevision(revision.identity, revision.index);
            trackedRevisionStatus.textContent =
              i18n.t("taskpane.review.revisionFocused", { index: revision.index });
          } else {
            await word.applyTrackedRevision(revision.identity, revision.index, action);
            await loadTrackedRevisions();
          }
        } catch (error) {
          showError(error);
        } finally {
          button.disabled = false;
        }
      });
      actions.appendChild(button);
    }
    card.append(heading, detail, excerpt, actions);
    trackedRevisionList.appendChild(card);
  }
  trackedRevisionStatus.textContent = truncated
    ? i18n.t("taskpane.review.revisionsTruncated", {
        total,
        visible: revisions.length,
      })
    : i18n.t("taskpane.review.revisionsRead", { count: total });
}

async function loadTrackedRevisions(): Promise<void> {
  const button = required<HTMLButtonElement>("#refresh-tracked-revisions");
  button.disabled = true;
  trackedRevisionStatus.textContent = i18n.t("taskpane.review.readingRevisions");
  try {
    const result = await word.listTrackedRevisions();
    renderTrackedRevisions(result.revisions, result.total, result.truncated);
  } catch (error) {
    required<HTMLElement>("#tracked-revision-count").textContent = "—";
    required<HTMLButtonElement>("#accept-all-tracked-revisions").disabled = true;
    required<HTMLButtonElement>("#reject-all-tracked-revisions").disabled = true;
    trackedRevisionList.className = "empty-panel";
    trackedRevisionList.textContent = i18n.t("taskpane.review.revisionsUnsupported");
    trackedRevisionStatus.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
}

required<HTMLButtonElement>("#refresh-tracked-revisions").addEventListener(
  "click",
  loadTrackedRevisions,
);
for (const [selector, action, label] of [
  ["#accept-all-tracked-revisions", "accept", "accept"],
  ["#reject-all-tracked-revisions", "reject", "reject"],
] as const) {
  required<HTMLButtonElement>(selector).addEventListener("click", async () => {
    if (!await requestConfirmation(
      i18n.t("taskpane.review.allRevisionsConfirm", {
        action: i18n.t(`taskpane.review.${label}`),
      }),
      i18n.t("taskpane.review.allRevisionsAction", {
        action: i18n.t(`taskpane.review.${label}`),
      }),
    )) return;
    try {
      await word.applyAllTrackedRevisions(action);
      await loadTrackedRevisions();
    } catch (error) {
      showError(error);
    }
  });
}

async function readDocumentReviewSource(
  start = 1,
): Promise<{
  source: string;
  total: number;
  included: number;
  start: number;
  end: number;
  paragraphs: string[];
  anchors: Map<number, ReviewAnchor>;
}> {
  const overview = await word.getDocumentOverview();
  const boundedStart = Math.max(1, Math.min(start, Math.max(overview.paragraphCount, 1)));
  const end = Math.min(overview.paragraphCount, boundedStart + MAX_REVIEW_PARAGRAPHS - 1);
  const included = Math.max(0, end - boundedStart + 1);
  const paragraphs: string[] = [];
  for (let pageStart = boundedStart; pageStart <= end; pageStart += 50) {
    const result = await word.readParagraphs(pageStart, Math.min(pageStart + 49, end));
    paragraphs.push(...result.paragraphs);
  }
  return {
    source: paragraphSource(paragraphs, boundedStart),
    total: overview.paragraphCount,
    included,
    start: boundedStart,
    end,
    paragraphs,
    anchors: await anchoredReviewMap(paragraphs, boundedStart),
  };
}

function snapshotFromParagraphSource(source: string): string[] {
  return source.split("\n").map((line) => line.replace(/^\[P\d+\]\s*/, ""));
}

async function captureSilentLinterSnapshot(): Promise<void> {
  const documentSource = await readDocumentReviewSource();
  silentLinterSnapshot = snapshotFromParagraphSource(documentSource.source);
  appendDiagnostic("linter", `captured ${silentLinterSnapshot.length} paragraphs`);
}

async function runSilentLinter(): Promise<void> {
  if (silentLinterRunning || !bridgePaired) return;
  silentLinterRunning = true;
  try {
    const documentSource = await readDocumentReviewSource();
    const current = snapshotFromParagraphSource(documentSource.source);
    if (!silentLinterSnapshot.length) {
      silentLinterSnapshot = current;
      return;
    }
    const changed = findChangedParagraphs(silentLinterSnapshot, current, 5);
    silentLinterSnapshot = current;
    if (!changed.length) return;
    const settings = readLocalSettings("wordollama-linter-settings", {
      enabled: false, profileId: "", intervalSeconds: 30,
    });
    const source = changed.map((paragraph) => `[P${paragraph.index}] ${paragraph.text}`).join("\n");
    appendDiagnostic("linter", `reviewing ${changed.length} changed paragraphs`);
    const generatedIssues = await generateReviewIssues(
      runtime,
      source,
      i18n.t("taskpane.review.silentTitle", { count: changed.length }),
      settings.profileId,
    );
    const issues = attachReviewAnchors(generatedIssues, documentSource.anchors);
    const stamp = Date.now();
    const existingKeys = new Set(reviewIssues.map(reviewIssueKey));
    reviewIssues = [
      ...reviewIssues,
      ...issues.map((issue, index) => ({
        ...issue,
        id: `silent-${stamp}-${index}`,
        source: i18n.t("taskpane.review.silentSource"),
      })).filter((issue) => !existingKeys.has(reviewIssueKey(issue))),
    ].slice(-100);
    renderIssues();
    persistReviewState();
    if (issues.length) {
      appendMessage(i18n.t("taskpane.review.silentIssuesFound", { count: issues.length }), "system");
    }
  } catch (error) {
    appendDiagnostic("linter", error instanceof Error ? error.message : String(error));
  } finally {
    silentLinterRunning = false;
  }
}

function configureSilentLinter(): void {
  if (silentLinterTimer !== null) {
    window.clearInterval(silentLinterTimer);
    silentLinterTimer = null;
  }
  silentLinterSnapshot = [];
  const settings = readLocalSettings("wordollama-linter-settings", {
    enabled: false, profileId: "", intervalSeconds: 30,
  });
  if (!settings.enabled || !bridgePaired || typeof Office === "undefined") return;
  const seconds = Math.max(3, Math.min(3600, Number(settings.intervalSeconds) || 30));
  void captureSilentLinterSnapshot().catch((error) =>
    appendDiagnostic("linter", error instanceof Error ? error.message : String(error)));
  silentLinterTimer = window.setInterval(() => void runSilentLinter(), seconds * 1000);
}

function updateReviewPagination(start: number, end: number, total: number, pageSize: number): void {
  const previous = required<HTMLButtonElement>("#review-page-previous");
  const next = required<HTMLButtonElement>("#review-page-next");
  const status = required<HTMLElement>("#review-page-status");
  previous.disabled = start <= 1;
  next.disabled = end >= total;
  previous.dataset.pageSize = String(pageSize);
  next.dataset.pageSize = String(pageSize);
  status.textContent = total > 0
    ? i18n.t("taskpane.review.pageStatus", { start, end, total })
    : "";
}

async function loadReviewScope(
  kind: "selection" | "paragraphs" | "document",
  start = 1,
): Promise<void> {
  clearError();
  reviewScopeStatus.textContent = i18n.t("taskpane.review.loading");
  try {
    currentReviewFingerprint = await word.getReviewDocumentFingerprint();
    if (kind === "selection") {
      const result = await word.getSelection();
      if (!result.text.trim()) throw new Error(i18n.t("taskpane.errors.selectionEmpty"));
      const paragraphCount = result.text
        .split(/[\r\n]+/)
        .filter((paragraph) => paragraph.trim().length > 0)
        .length;
      if (paragraphCount < 3) {
        throw new Error(i18n.t("taskpane.review.multiParagraphRequired"));
      }
      reviewScope = `[P0] ${result.text.trim()}`;
      reviewScopeAnchors = new Map();
      reviewScopeChunks = [{ source: reviewScope, anchors: reviewScopeAnchors }];
      reviewPageStart = 1;
      reviewScopeKind = "selection";
      reviewScopeLabel = i18n.t("taskpane.scope.selection");
      updateReviewPagination(1, 1, 1, 1);
    } else if (kind === "paragraphs") {
      const overview = await word.getDocumentOverview();
      reviewPageStart = Math.max(1, Math.min(start, Math.max(overview.paragraphCount, 1)));
      const result = await word.readParagraphs(
        reviewPageStart,
        Math.min(reviewPageStart + 9, overview.paragraphCount),
      );
      reviewScope = paragraphSource(result.paragraphs, result.start);
      reviewScopeAnchors = await anchoredReviewMap(result.paragraphs, result.start);
      reviewScopeChunks = reuseAnchors(
        buildReviewChunks(result.paragraphs, result.start),
        reviewScopeAnchors,
      );
      reviewScopeKind = "paragraphs";
      reviewScopeLabel = i18n.t("taskpane.review.paragraphRange", {
        start: result.start,
        end: result.end,
      });
      updateReviewPagination(result.start, result.end, overview.paragraphCount, 10);
    } else {
      const result = await readDocumentReviewSource(start);
      reviewPageStart = result.start;
      reviewScope = result.source;
      reviewScopeAnchors = result.anchors;
      reviewScopeChunks = reuseAnchors(
        buildReviewChunks(result.paragraphs, result.start),
        reviewScopeAnchors,
      );
      reviewScopeKind = "document";
      reviewScopeLabel = result.included < result.total
        ? i18n.t("taskpane.review.documentRange", {
            start: result.start,
            end: result.end,
            total: result.total,
          })
        : i18n.t("taskpane.review.documentAll", { total: result.total });
      updateReviewPagination(result.start, result.end, result.total, MAX_REVIEW_PARAGRAPHS);
    }
    reviewScopeStatus.textContent = i18n.t("taskpane.review.scopeLoaded", {
      scope: reviewScopeLabel,
    });
    const documentScopeButton = required<HTMLButtonElement>("#load-review-document");
    const selectionScopeButton = required<HTMLButtonElement>("#load-review-selection");
    documentScopeButton.classList.toggle("btn-primary", kind === "document");
    selectionScopeButton.classList.toggle("btn-primary", kind === "selection");
    suggestionList.hidden = true;
    suggestionList.replaceChildren();
  } catch (error) {
    reviewScopeStatus.textContent = i18n.t("taskpane.review.loadFailed");
    showError(error);
  }
}

function actionButton(label: string, className = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  const daisyClass = className.includes("text-button")
    ? "btn btn-ghost btn-xs"
    : className.includes("secondary-button")
      ? "btn btn-sm"
      : "btn btn-primary btn-sm";
  button.className = `${daisyClass} ${className}`.trim();
  return button;
}

function renderIssues(): void {
  const list = required<HTMLDivElement>("#issue-list");
  const count = required<HTMLElement>("#issue-count");
  const summary = required<HTMLElement>("#issue-summary");
  const clearButton = required<HTMLButtonElement>("#clear-issues");
  list.replaceChildren();
  count.textContent = String(reviewIssues.length);
  count.hidden = reviewIssues.length === 0;
  clearButton.hidden = reviewIssues.length === 0;
  summary.textContent = reviewIssues.length
    ? i18n.t("taskpane.issues.found", { count: reviewIssues.length })
    : i18n.t("taskpane.issues.empty");
  if (!reviewIssues.length) {
    list.className = "issue-list";
    list.hidden = true;
    return;
  }
  list.className = "issue-list";
  list.hidden = false;
  for (const issue of reviewIssues) {
    const card = document.createElement("article");
    card.className = `card card-border review-item severity-${issue.severity}`;
    const heading = document.createElement("div");
    heading.className = "review-item-heading";
    const title = document.createElement("strong");
    title.textContent = issue.title;
    const badge = document.createElement("span");
    badge.className = `badge badge-sm severity-badge ${issue.severity}`;
    badge.textContent = i18n.t(`taskpane.issues.severity.${issue.severity}`);
    heading.append(title, badge);
    const meta = document.createElement("p");
    meta.className = "review-meta";
    meta.textContent = `${
      issue.paragraphIndex > 0
        ? i18n.t("taskpane.review.paragraph", { index: issue.paragraphIndex })
        : i18n.t("taskpane.review.unlocated")
    } · ${issue.category} · ${issue.source}`;
    const description = document.createElement("p");
    description.textContent = issue.description;
    const excerpt = document.createElement("blockquote");
    excerpt.textContent = issue.excerpt || i18n.t("taskpane.issues.noExcerpt");
    const suggestion = document.createElement("p");
    suggestion.className = "review-suggestion";
    suggestion.textContent = issue.suggestion
      ? i18n.t("taskpane.issues.suggestionText", { suggestion: issue.suggestion })
      : i18n.t("taskpane.issues.noSuggestion");
    const actions = document.createElement("div");
    actions.className = "action-row wrap";
    const focus = actionButton(i18n.t("taskpane.review.focus"), "secondary-button");
    focus.addEventListener("click", async () => {
      try {
        issue.paragraphIndex = await word.resolveReviewParagraph(
          issue.paragraphIndex,
          issue.excerpt,
          issue.anchor,
        );
        await word.focusReviewTarget(issue.paragraphIndex, issue.excerpt, issue.anchor);
      } catch (error) { showError(error); }
    });
    const comment = actionButton(i18n.t("taskpane.review.comment"), "secondary-button");
    comment.disabled = !word.supportsTool("add_comment");
    comment.addEventListener("click", async () => {
      try {
        await word.commentReviewTarget(
          issue.paragraphIndex,
          issue.excerpt,
          `${issue.title}\n${issue.description}${
            issue.suggestion
              ? `\n${i18n.t("taskpane.issues.suggestionText", { suggestion: issue.suggestion })}`
              : ""
          }`,
          issue.anchor,
        );
        comment.textContent = i18n.t("taskpane.review.commented");
        comment.disabled = true;
      } catch (error) { showError(error); }
    });
    const ignore = actionButton(i18n.t("taskpane.review.ignore"), "text-button");
    ignore.addEventListener("click", () => {
      reviewIssues = reviewIssues.filter((candidate) => candidate.id !== issue.id);
      persistReviewState();
      renderIssues();
    });
    actions.append(focus, comment, ignore);
    card.append(heading, meta, description, excerpt, suggestion, actions);
    list.appendChild(card);
  }
}

async function runIssueReview(): Promise<void> {
  clearError();
  activateTab("review");
  const documentButton = required<HTMLButtonElement>("#review-document");
  documentButton.disabled = true;
  required<HTMLElement>("#issue-summary").textContent = i18n.t("taskpane.issues.reviewing");
  try {
    if (!reviewScope) await loadReviewScope("document");
    if (!reviewScope) return;
    currentReviewFingerprint = await word.getReviewDocumentFingerprint();
    if (reviewScopeKind === "document") {
      const overview = await word.getDocumentOverview();
      const collected: ReviewIssue[] = [];
      for (let start = 1; start <= overview.paragraphCount; start += MAX_REVIEW_PARAGRAPHS) {
        const documentSource = await readDocumentReviewSource(start);
        const chunks = buildReviewChunks(documentSource.paragraphs, documentSource.start);
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          const chunk = chunks[chunkIndex];
          required<HTMLElement>("#issue-summary").textContent =
            i18n.t("taskpane.issues.reviewingChunk", {
              start: documentSource.start,
              end: documentSource.end,
              total: documentSource.total,
              chunk: chunks.length > 1
                ? i18n.t("taskpane.review.chunk", {
                    current: chunkIndex + 1,
                    total: chunks.length,
                  })
                : "",
            });
          const pageIssues = await generateReviewIssues(
            runtime,
            chunk.source,
            i18n.t("taskpane.review.documentRange", {
              start: documentSource.start,
              end: documentSource.end,
              total: documentSource.total,
            }),
          );
          collected.push(...attachReviewAnchors(pageIssues, chunk.anchors));
        }
      }
      const seen = new Set<string>();
      reviewIssues = collected.filter((issue) => {
        const key = reviewIssueKey(issue);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 100);
    } else {
      const chunks = reviewScopeChunks.length
        ? reviewScopeChunks
        : [{ source: reviewScope, anchors: reviewScopeAnchors }];
      const collected: ReviewIssue[] = [];
      for (const chunk of chunks) {
        const generated = await generateReviewIssues(runtime, chunk.source, reviewScopeLabel);
        collected.push(...attachReviewAnchors(generated, chunk.anchors));
      }
      reviewIssues = collected.slice(0, 100);
    }
    persistReviewState();
    renderIssues();
  } catch (error) {
    required<HTMLElement>("#issue-summary").textContent = i18n.t("taskpane.issues.reviewFailed");
    showError(error);
  } finally {
    documentButton.disabled = false;
  }
}

async function assertSuggestionTargetUnchanged(suggestion: ReviewSuggestion): Promise<void> {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  if (suggestion.paragraphIndex === 0) {
    if (reviewScopeKind !== "selection") {
      throw new Error(i18n.t("taskpane.review.noActionableParagraph"));
    }
    const currentSelection = await word.getSelection();
    if (normalize(currentSelection.text) !== normalize(suggestion.originalText)) {
      throw new Error(i18n.t("taskpane.errors.selectionChanged"));
    }
    return;
  }
  if (suggestion.paragraphIndex < 1) {
    throw new Error(i18n.t("taskpane.review.noActionableParagraph"));
  }
  suggestion.paragraphIndex = await word.resolveReviewParagraph(
    suggestion.paragraphIndex,
    suggestion.originalText,
    suggestion.anchor,
  );
}

async function performSuggestionAction(
  suggestion: ReviewSuggestion,
  action: "accept" | "insert" | "comment" | "copy" | "skip",
): Promise<void> {
  if (action === "accept") {
    await assertSuggestionTargetUnchanged(suggestion);
    if (suggestion.paragraphIndex === 0) {
      await word.replaceSelection(suggestion.suggestedText);
    } else {
      await word.replaceParagraph(suggestion.paragraphIndex, suggestion.suggestedText);
    }
    suggestion.status = "accepted";
  } else if (action === "insert") {
    await assertSuggestionTargetUnchanged(suggestion);
    if (suggestion.paragraphIndex === 0) {
      await word.insertAfterSelection(suggestion.suggestedText);
    } else {
      await word.insertAfterParagraph(suggestion.paragraphIndex, suggestion.suggestedText);
    }
    suggestion.status = "inserted";
  } else if (action === "comment") {
    await assertSuggestionTargetUnchanged(suggestion);
    await word.commentReviewTarget(
      suggestion.paragraphIndex,
      suggestion.originalText,
      `${suggestion.reason}\n${i18n.t("taskpane.review.suggestedText", {
        text: suggestion.suggestedText,
      })}`,
      suggestion.anchor,
    );
    suggestion.status = "commented";
  } else if (action === "copy") {
    await navigator.clipboard.writeText(suggestion.suggestedText);
  } else {
    suggestion.status = "skipped";
  }
  if (action !== "copy") {
    currentReviewFingerprint = await word.getReviewDocumentFingerprint();
    persistReviewState();
  }
}

async function loadReviewSettings(): Promise<void> {
  try {
    let settings = await runtime.getReviewSettings();
    const legacy = localStorage.getItem("wordollama-writing-profile")?.trim() ?? "";
    if (!settings.outputPreference && !settings.memories.length && legacy) {
      settings = await runtime.saveReviewSettings(
        legacy,
        settings.autoMemory,
        settings.memoryProviderProfileId,
      );
      localStorage.removeItem("wordollama-writing-profile");
    }
  } catch (error) {
    showError(error);
  }
}

async function regenerateSuggestion(
  suggestion: ReviewSuggestion,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;
  button.textContent = i18n.t("taskpane.review.generating");
  try {
    const generated = await generateReviewSuggestions(
      runtime,
      `[P${suggestion.paragraphIndex}] ${suggestion.originalText}`,
      required<HTMLTextAreaElement>("#review-instruction").value.trim(),
    );
    const replacement = generated[0];
    if (!replacement) throw new Error(i18n.t("taskpane.review.noRegeneratedSuggestion"));
    const index = reviewSuggestions.findIndex((item) => item.id === suggestion.id);
    if (index >= 0) {
      reviewSuggestions[index] = {
        ...replacement,
        id: suggestion.id,
        paragraphIndex: suggestion.paragraphIndex,
        originalText: suggestion.originalText,
        anchor: suggestion.anchor,
        status: "pending",
      };
    }
    persistReviewState();
    renderSuggestions();
  } finally {
    button.disabled = false;
    button.textContent = i18n.t("taskpane.review.regenerate");
  }
}

function renderSuggestions(): void {
  suggestionList.replaceChildren();
  const batchActions = required<HTMLDetailsElement>("#review-batch-actions");
  batchActions.hidden = reviewSuggestions.length === 0;
  if (!reviewSuggestions.length) {
    suggestionList.hidden = false;
    suggestionList.className = "empty-panel";
    suggestionList.textContent = i18n.t("taskpane.review.noSuggestions");
    return;
  }
  suggestionList.hidden = false;
  suggestionList.className = "suggestion-list";
  for (const item of reviewSuggestions) {
    const card = document.createElement("article");
    card.className = `card card-border review-item suggestion-${item.status}`;
    const heading = document.createElement("div");
    heading.className = "review-item-heading";
    const location = document.createElement("strong");
    location.textContent = item.paragraphIndex > 0
      ? i18n.t("taskpane.review.paragraph", { index: item.paragraphIndex })
      : i18n.t("taskpane.review.unlocated");
    const status = document.createElement("span");
    status.className = "badge badge-sm status-badge";
    status.textContent = item.status === "pending"
      ? i18n.t("taskpane.review.pending")
      : i18n.t(`taskpane.review.status.${item.status}`, { defaultValue: item.status });
    heading.append(location, status);
    const originalLabel = document.createElement("span");
    originalLabel.className = "field-label";
    originalLabel.textContent = i18n.t("taskpane.review.original");
    const original = document.createElement("blockquote");
    original.textContent = item.originalText;
    const suggestionLabel = document.createElement("span");
    suggestionLabel.className = "field-label";
    suggestionLabel.textContent = i18n.t("taskpane.review.suggestion");
    const edited = document.createElement("textarea");
    edited.className = "textarea";
    edited.rows = 4;
    edited.value = item.suggestedText;
    edited.disabled = item.status !== "pending";
    edited.addEventListener("input", () => { item.suggestedText = edited.value; });
    const reason = document.createElement("p");
    reason.className = "review-meta";
    reason.textContent = item.reason;
    const actions = document.createElement("div");
    actions.className = "action-row wrap";
    const regenerate = actionButton(i18n.t("taskpane.review.regenerate"), "secondary-button");
    regenerate.disabled = item.status !== "pending";
    regenerate.addEventListener("click", async () => {
      try { await regenerateSuggestion(item, regenerate); } catch (error) { showError(error); }
    });
    actions.appendChild(regenerate);
    const definitions: Array<[string, "accept" | "insert" | "comment" | "copy" | "skip", string]> = [
      [i18n.t("taskpane.review.acceptReplacement"), "accept", ""],
      [i18n.t("taskpane.review.insertBelow"), "insert", "secondary-button"],
      [i18n.t("taskpane.review.comment"), "comment", "secondary-button"],
      [i18n.t("taskpane.common.copy"), "copy", "text-button"],
      [i18n.t("taskpane.review.skip"), "skip", "text-button"],
    ];
    for (const [label, action, className] of definitions) {
      const button = actionButton(label, className);
      button.disabled = item.status !== "pending" && action !== "copy";
      if (action === "comment" && !word.supportsTool("add_comment")) button.disabled = true;
      button.addEventListener("click", async () => {
        try { await performSuggestionAction(item, action); renderSuggestions(); } catch (error) { showError(error); }
      });
      actions.appendChild(button);
    }
    card.append(heading, originalLabel, original, suggestionLabel, edited, reason, actions);
    suggestionList.appendChild(card);
  }
}

async function applyAllSuggestions(action: "accept" | "insert" | "comment" | "skip"): Promise<void> {
  const pending = reviewSuggestions.filter((item) => item.status === "pending");
  if (!pending.length) return;
  const progress = required<HTMLProgressElement>("#review-progress");
  const progressStatus = required<HTMLElement>("#review-progress-status");
  progress.hidden = false;
  progress.removeAttribute("value");
  progressStatus.textContent =
    i18n.t("taskpane.review.validatingAnchors", { count: pending.length });
  try {
    if (action === "skip") {
      pending.forEach((suggestion) => { suggestion.status = "skipped"; });
    } else if (pending.some((suggestion) => suggestion.paragraphIndex === 0)) {
      if (pending.length !== 1) {
        throw new Error(i18n.t("taskpane.review.selectionBatchUnsafe"));
      }
      await performSuggestionAction(pending[0], action);
    } else {
      const resolved = await word.applyReviewSuggestionsBatch(pending, action);
      const resolvedById = new Map(resolved.map((item) => [item.id, item.paragraphIndex]));
      const status: ReviewSuggestion["status"] = action === "accept" ? "accepted"
        : action === "insert" ? "inserted"
          : "commented";
      pending.forEach((suggestion) => {
        suggestion.paragraphIndex = resolvedById.get(suggestion.id) ?? suggestion.paragraphIndex;
        suggestion.status = status;
      });
      currentReviewFingerprint = await word.getReviewDocumentFingerprint();
    }
    persistReviewState();
    progress.value = 100;
    progressStatus.textContent =
      i18n.t("taskpane.review.batchComplete", { count: pending.length });
  } catch (error) {
    showError(error);
    progressStatus.textContent = i18n.t("taskpane.review.batchFailed");
  } finally {
    renderSuggestions();
    window.setTimeout(() => { progress.hidden = true; progressStatus.textContent = ""; }, 1500);
  }
}

required<HTMLButtonElement>("#load-review-selection").addEventListener("click", () => void loadReviewScope("selection"));
required<HTMLButtonElement>("#load-review-document").addEventListener("click", () => void loadReviewScope("document"));
required<HTMLButtonElement>("#review-page-previous").addEventListener("click", () => {
  if (reviewScopeKind !== "paragraphs" && reviewScopeKind !== "document") return;
  const pageSize = reviewScopeKind === "document" ? MAX_REVIEW_PARAGRAPHS : 10;
  void loadReviewScope(reviewScopeKind, Math.max(1, reviewPageStart - pageSize));
});
required<HTMLButtonElement>("#review-page-next").addEventListener("click", () => {
  if (reviewScopeKind !== "paragraphs" && reviewScopeKind !== "document") return;
  const pageSize = reviewScopeKind === "document" ? MAX_REVIEW_PARAGRAPHS : 10;
  void loadReviewScope(reviewScopeKind, reviewPageStart + pageSize);
});
required<HTMLButtonElement>("#generate-review").addEventListener("click", async () => {
  const generateButton = required<HTMLButtonElement>("#generate-review");
  const cancelButton = required<HTMLButtonElement>("#cancel-review");
  clearError();
  if (!reviewScope) await loadReviewScope("document");
  if (!reviewScope) return;
  reviewAbortController = new AbortController();
  const progress = required<HTMLProgressElement>("#review-progress");
  const progressStatus = required<HTMLElement>("#review-progress-status");
  generateButton.disabled = true;
  cancelButton.disabled = false;
  progress.hidden = false;
  progress.removeAttribute("value");
  progressStatus.textContent = i18n.t("taskpane.review.analyzing");
  suggestionList.hidden = false;
  suggestionList.className = "empty-panel";
  suggestionList.textContent = i18n.t("taskpane.review.generatingItems");
  try {
    let chunks = reviewScopeChunks.length
      ? reviewScopeChunks
      : [{ source: reviewScope, anchors: reviewScopeAnchors }];
    if (reviewScopeKind === "document") {
      chunks = [];
      const overview = await word.getDocumentOverview();
      for (let start = 1; start <= overview.paragraphCount; start += MAX_REVIEW_PARAGRAPHS) {
        const documentSource = await readDocumentReviewSource(start);
        chunks.push(...buildReviewChunks(documentSource.paragraphs, documentSource.start));
      }
    }
    const collected: ReviewSuggestion[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      progressStatus.textContent = chunks.length > 1
        ? i18n.t("taskpane.review.generatingChunk", {
            current: index + 1,
            total: chunks.length,
          })
        : i18n.t("taskpane.review.analyzing");
      const generated = await generateReviewSuggestions(
        runtime,
        chunk.source,
        required<HTMLTextAreaElement>("#review-instruction").value.trim(),
        reviewAbortController.signal,
      );
      collected.push(...attachReviewAnchors(generated, chunk.anchors));
      progress.value = Math.round((index + 1) / chunks.length * 100);
    }
    reviewSuggestions = collected.slice(0, 100);
    persistReviewState();
    progress.value = 100;
    progressStatus.textContent =
      i18n.t("taskpane.review.generated", { count: reviewSuggestions.length });
    renderSuggestions();
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      suggestionList.textContent = i18n.t("taskpane.review.generationCancelled");
    } else {
      suggestionList.textContent = i18n.t("taskpane.review.generationFailed");
      showError(error);
    }
  } finally {
    reviewAbortController = null;
    generateButton.disabled = false;
    cancelButton.disabled = true;
    window.setTimeout(() => { progress.hidden = true; progressStatus.textContent = ""; }, 1500);
  }
});
required<HTMLButtonElement>("#cancel-review").addEventListener("click", () => reviewAbortController?.abort());
required<HTMLButtonElement>("#review-document").addEventListener("click", () => void runIssueReview());
required<HTMLButtonElement>("#review-before-save").addEventListener("click", () => void runIssueReview());
required<HTMLButtonElement>("#clear-issues").addEventListener("click", () => {
  reviewIssues = [];
  persistReviewState();
  renderIssues();
});
required<HTMLButtonElement>("#accept-all-suggestions").addEventListener("click", () => void applyAllSuggestions("accept"));
required<HTMLButtonElement>("#insert-all-suggestions").addEventListener("click", () => void applyAllSuggestions("insert"));
required<HTMLButtonElement>("#comment-all-suggestions").addEventListener("click", () => void applyAllSuggestions("comment"));
required<HTMLButtonElement>("#skip-all-suggestions").addEventListener("click", () => void applyAllSuggestions("skip"));

function updateFilePickerName(
  input: HTMLInputElement,
  nameElement: HTMLElement,
  emptyKey: string,
): void {
  const file = input.files?.[0];
  nameElement.textContent = file
    ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`
    : i18n.t(emptyKey);
  nameElement.classList.toggle("has-file", Boolean(file));
}

const compareOriginalName = required<HTMLElement>("#compare-original-name");
const compareRevisedName = required<HTMLElement>("#compare-revised-name");
compareOriginalInput.addEventListener("change", () => {
  updateFilePickerName(
    compareOriginalInput,
    compareOriginalName,
    "taskpane.utility.compare.originalEmpty",
  );
});
compareRevisedInput.addEventListener("change", () => {
  updateFilePickerName(
    compareRevisedInput,
    compareRevisedName,
    "taskpane.utility.compare.revisedEmpty",
  );
});

function renderCompareAnalysis(content: string, empty = false): void {
  compareAnalysis.classList.toggle("empty-panel", empty);
  if (empty) {
    compareAnalysis.textContent = content;
    return;
  }
  compareAnalysis.innerHTML = markdownToHtml(content, currentMarkdownOptions());
}

compareRunButton.addEventListener("click", async () => {
  const original = compareOriginalInput.files?.[0];
  const revised = compareRevisedInput.files?.[0];
  compareRunButton.disabled = true;
  compareAnalysisAbortController?.abort();
  compareAnalysisAbortController = new AbortController();
  compareSummary.textContent = "";
  compareAnalysisStatus.textContent = i18n.t("taskpane.utility.compare.analysisReading");
  renderCompareAnalysis(i18n.t("taskpane.utility.compare.analysisReading"), true);
  clearError();
  try {
    if (!original || !revised) {
      throw new Error(i18n.t("taskpane.utility.compare.filesRequired"));
    }
    validateCompareFiles(original, revised);
    compareSummary.textContent = i18n.t("taskpane.utility.compare.sending");
    const [originalBase64, revisedBase64] = await Promise.all([fileToBase64(original), fileToBase64(revised)]);
    const report = await runtime.compareDocuments(originalBase64, revisedBase64);
    compareSummary.textContent = i18n.t("taskpane.utility.compare.summary", {
      summary: formatCompareSummary(report),
    });
    if (!report.changes.length) {
      compareAnalysisStatus.textContent = i18n.t("taskpane.utility.compare.analysisReady");
      renderCompareAnalysis(i18n.t("taskpane.utility.compare.analysisNoChanges"), true);
      return;
    }
    compareAnalysisStatus.textContent = i18n.t("taskpane.utility.compare.analysisGenerating");
    renderCompareAnalysis(i18n.t("taskpane.utility.compare.analysisGenerating"), true);
    const analysis = await analyzeCompareChanges(
      runtime,
      report,
      original.name,
      revised.name,
      compareAnalysisAbortController.signal,
      (content) => renderCompareAnalysis(content),
    );
    compareAnalysisStatus.textContent = i18n.t("taskpane.utility.compare.analysisReady");
    renderCompareAnalysis(analysis);
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") return;
    compareSummary.textContent = i18n.t("taskpane.utility.compare.failed");
    compareAnalysisStatus.textContent = "";
    renderCompareAnalysis(i18n.t("taskpane.utility.compare.analysisFailed"), true);
    showError(error);
  } finally {
    compareAnalysisAbortController = null;
    compareRunButton.disabled = false;
  }
});

compareNativeWordButton.addEventListener("click", async () => {
  const original = compareOriginalInput.files?.[0];
  const revised = compareRevisedInput.files?.[0];
  compareNativeWordButton.disabled = true;
  clearError();
  try {
    if (!original || !revised) throw new Error(i18n.t("taskpane.utility.compare.filesRequired"));
    validateCompareFiles(original, revised);
    compareSummary.textContent = i18n.t("taskpane.utility.compare.nativeRunning");
    const [originalBase64, revisedBase64] = await Promise.all([
      fileToBase64(original),
      fileToBase64(revised),
    ]);
    const result = await runtime.compareDocumentsWithNativeWord(originalBase64, revisedBase64);
    if (!result.available || !result.documentBase64) {
      throw new Error(result.reason || i18n.t("taskpane.utility.compare.nativeUnavailable"));
    }
    const bytes = Uint8Array.from(atob(result.documentBase64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = result.fileName || "WordOllama-native-comparison.docx";
    link.click();
    URL.revokeObjectURL(url);
    compareSummary.textContent = i18n.t("taskpane.utility.compare.nativeReady");
  } catch (error) {
    compareSummary.textContent = i18n.t("taskpane.utility.compare.failed");
    showError(error);
  } finally {
    compareNativeWordButton.disabled = false;
  }
});

goldenConfirm.addEventListener("change", () => {
  goldenRunButton.disabled = !goldenConfirm.checked;
  if (goldenConfirm.checked) {
    goldenSummary.textContent = i18n.t("taskpane.utility.diagnostics.confirmed");
  } else if (!lastGoldenReport) {
    goldenSummary.textContent = i18n.t("taskpane.utility.diagnostics.notRun");
  }
});

goldenRunButton.addEventListener("click", async () => {
  if (!goldenConfirm.checked) {
    goldenSummary.textContent = i18n.t("taskpane.utility.diagnostics.confirmRequired");
    return;
  }
  goldenConfirm.checked = false;
  goldenConfirm.disabled = true;
  goldenRunButton.disabled = true;
  goldenCopyButton.disabled = true;
  goldenOutput.textContent = "";
  goldenSummary.textContent = i18n.t("taskpane.utility.diagnostics.preparingGolden");
  clearError();
  try {
    const report = await runOfficeGoldenMatrix(tools, new OfficeGoldenHostHarness(), (completed, total, result) => {
      goldenSummary.textContent = i18n.t("taskpane.utility.diagnostics.runningCase", {
        completed,
        total,
        name: result.name,
        status: result.status,
      });
      goldenOutput.textContent += `${result.status.toUpperCase()}  ${result.name}${result.error ? ` — ${result.error}` : ""}\n`;
    });
    report.release = await getReleaseTestIdentity();
    lastGoldenReport = JSON.stringify(report, null, 2);
    goldenOutput.textContent = lastGoldenReport;
    goldenSummary.textContent = i18n.t("taskpane.utility.diagnostics.goldenComplete", {
      passed: report.passed,
      failed: report.failed,
      unsupported: report.unsupported,
      blocked: report.blocked,
    });
    goldenCopyButton.disabled = false;
  } catch (error) {
    showError(error);
    const message = error instanceof Error ? error.message : String(error);
    goldenSummary.textContent =
      i18n.t("taskpane.utility.diagnostics.goldenFailed", { message });
    goldenOutput.textContent = message;
  } finally {
    goldenConfirm.disabled = false;
    goldenRunButton.disabled = true;
  }
});

goldenCopyButton.addEventListener("click", async () => {
  if (!lastGoldenReport) return;
  try {
    await navigator.clipboard.writeText(lastGoldenReport);
    goldenSummary.textContent += i18n.t("taskpane.utility.diagnostics.reportCopiedSuffix");
  } catch {
    await showCopyFallback(
      i18n.t("taskpane.utility.diagnostics.copyGoldenFallback"),
      lastGoldenReport,
    );
  }
});

longDocumentConfirm.addEventListener("change", () => {
  longDocumentRunButton.disabled = !longDocumentConfirm.checked;
  if (longDocumentConfirm.checked) {
    longDocumentSummary.textContent = i18n.t("taskpane.utility.diagnostics.longConfirmed");
  } else if (!lastLongDocumentReport) {
    longDocumentSummary.textContent = i18n.t("taskpane.utility.diagnostics.notRun");
  }
});

longDocumentRunButton.addEventListener("click", async () => {
  if (!longDocumentConfirm.checked) {
    longDocumentSummary.textContent = i18n.t("taskpane.utility.diagnostics.confirmRequired");
    return;
  }
  longDocumentConfirm.checked = false;
  longDocumentConfirm.disabled = true;
  longDocumentRunButton.disabled = true;
  longDocumentCopyButton.disabled = true;
  longDocumentOutput.textContent = "";
  longDocumentSummary.textContent = i18n.t("taskpane.utility.diagnostics.preparingLong");
  clearError();
  try {
    const report = await runLongDocumentMatrix(
      new OfficeLongDocumentHost(word),
      [1_000, 5_000],
      30_000,
      (message) => {
        longDocumentSummary.textContent = message;
      },
    );
    report.release = await getReleaseTestIdentity();
    lastLongDocumentReport = JSON.stringify(report, null, 2);
    longDocumentOutput.textContent = lastLongDocumentReport;
    const passed = report.cases.filter((result) => result.status === "passed").length;
    longDocumentSummary.textContent = i18n.t("taskpane.utility.diagnostics.longComplete", {
      passed,
      total: report.cases.length,
      budget: report.operationBudgetMs,
    });
    longDocumentCopyButton.disabled = false;
  } catch (error) {
    showError(error);
    const message = error instanceof Error ? error.message : String(error);
    longDocumentSummary.textContent =
      i18n.t("taskpane.utility.diagnostics.longFailed", { message });
    longDocumentOutput.textContent = message;
  } finally {
    longDocumentConfirm.disabled = false;
    longDocumentRunButton.disabled = true;
  }
});

longDocumentCopyButton.addEventListener("click", async () => {
  if (!lastLongDocumentReport) return;
  try {
    await navigator.clipboard.writeText(lastLongDocumentReport);
    longDocumentSummary.textContent +=
      i18n.t("taskpane.utility.diagnostics.reportCopiedSuffix");
  } catch {
    await showCopyFallback(
      i18n.t("taskpane.utility.diagnostics.copyLongFallback"),
      lastLongDocumentReport,
    );
  }
});

revisionHostConfirm.addEventListener("change", () => {
  revisionHostRunButton.disabled = !revisionHostConfirm.checked;
  if (revisionHostConfirm.checked) {
    revisionHostSummary.textContent = i18n.t("taskpane.utility.diagnostics.revisionConfirmed");
  } else if (!lastRevisionHostReport) {
    revisionHostSummary.textContent = i18n.t("taskpane.utility.diagnostics.notRun");
  }
});

revisionHostRunButton.addEventListener("click", async () => {
  if (!revisionHostConfirm.checked) {
    revisionHostSummary.textContent = i18n.t("taskpane.utility.diagnostics.confirmRequired");
    return;
  }
  revisionHostConfirm.checked = false;
  revisionHostConfirm.disabled = true;
  revisionHostRunButton.disabled = true;
  revisionHostCopyButton.disabled = true;
  revisionHostOutput.textContent = "";
  revisionHostSummary.textContent = i18n.t("taskpane.utility.diagnostics.preparingRevision");
  clearError();
  try {
    const report = await runRevisionHostMatrix(
      new OfficeRevisionHost(word),
      (message) => {
        revisionHostSummary.textContent = message;
      },
    );
    report.release = await getReleaseTestIdentity();
    lastRevisionHostReport = JSON.stringify(report, null, 2);
    revisionHostOutput.textContent = lastRevisionHostReport;
    revisionHostSummary.textContent = report.status === "passed"
      ? i18n.t("taskpane.utility.diagnostics.revisionPassed")
      : report.status === "unsupported"
        ? i18n.t("taskpane.utility.diagnostics.revisionUnsupported")
        : i18n.t("taskpane.utility.diagnostics.revisionFailed", {
            message: report.errors.join("; "),
          });
    revisionHostCopyButton.disabled = false;
  } catch (error) {
    showError(error);
    const message = error instanceof Error ? error.message : String(error);
    revisionHostSummary.textContent =
      i18n.t("taskpane.utility.diagnostics.revisionFailed", { message });
    revisionHostOutput.textContent = message;
  } finally {
    revisionHostConfirm.disabled = false;
    revisionHostRunButton.disabled = true;
  }
});

revisionHostCopyButton.addEventListener("click", async () => {
  if (!lastRevisionHostReport) return;
  try {
    await navigator.clipboard.writeText(lastRevisionHostReport);
    revisionHostSummary.textContent +=
      i18n.t("taskpane.utility.diagnostics.reportCopiedSuffix");
  } catch {
    await showCopyFallback(
      i18n.t("taskpane.utility.diagnostics.copyRevisionFallback"),
      lastRevisionHostReport,
    );
  }
});
