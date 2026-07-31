import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Boxes,
  CircleCheck,
  Eye,
  FileCode2,
  FolderOpen,
  House,
  Info,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ADDIN_VERSION } from "../contracts";
import type {
  McpServerUpdate,
  McpServerView,
  McpToolDefinition,
  OllamaServerSettingsUpdate,
  ProviderProfileUpdate,
  ProviderProfileView,
  SkillSummary,
  UpdateCheckResult,
} from "../contracts";
import { RuntimeClient } from "../runtime-client";
import {
  DEFAULT_MARKDOWN_SETTINGS,
  type MarkdownSettings,
} from "../markdown-settings";
import { markdownToHtml } from "../markdown-workflow";
import {
  readUiLocalePreference,
  setUiLocalePreference,
  type UiLocalePreference,
} from "./i18n";
import {
  closeSettingsWindow,
  createWordParagraphStyle,
  listWordStyles,
} from "./dialog-rpc";
import { classifyUpdateResult } from "./update-status";

type PageId =
  | "general"
  | "models"
  | "agent"
  | "markdown"
  | "skills"
  | "mcp"
  | "advanced"
  | "updates"
  | "about";

type StatusState = { text: string; error?: boolean } | null;

const runtime = new RuntimeClient();

type SettingsSaveRegistration = {
  dirty: boolean;
  save: () => Promise<void>;
};

type SettingsSaveContextValue = {
  register: (id: string, save: () => Promise<void>) => () => void;
  setDirty: (id: string, dirty: boolean) => void;
};

const SettingsSaveContext = createContext<SettingsSaveContextValue | null>(null);

function useSettingsSection(id: string, dirty: boolean, save: () => Promise<void>): void {
  const context = useContext(SettingsSaveContext);
  if (!context) throw new Error("settings-save-context-missing");
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => context.register(id, () => saveRef.current()), [context, id]);
  useEffect(() => context.setDirty(id, dirty), [context, dirty, id]);
}

function settingsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? { ...fallback, ...JSON.parse(value) as T } : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file-read-failed"));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function parseLines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function parsePairs(value: string): Record<string, string> {
  return Object.fromEntries(parseLines(value).map((line) => {
    const separator = line.indexOf("=");
    return separator < 0 ? [line, ""] : [line.slice(0, separator).trim(), line.slice(separator + 1)];
  }));
}

function toStatus(error: unknown, fallback: string): StatusState {
  return { text: error instanceof Error && error.message ? error.message : fallback, error: true };
}

function PageHeading({ title }: { title: string }) {
  return (
    <div className="settings-page-heading">
      <h1>{title}</h1>
    </div>
  );
}

function Card({
  title,
  actions,
  children,
  wide = false,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`card card-border settings-card${wide ? " settings-card-wide" : ""}`}>
      <header className="settings-card-header">
        <h2 className="card-title settings-card-title">{title}</h2>
        {actions ? <div className="card-actions">{actions}</div> : null}
      </header>
      <div className="card-body settings-card-body">{children}</div>
    </section>
  );
}

function Status({ value }: { value: StatusState }) {
  return (
    <p className={`settings-status${value?.error ? " text-error" : ""}`} role={value?.error ? "alert" : undefined}>
      {value?.text ?? ""}
    </p>
  );
}

function SwitchRow({ label, title, checked, onChange }: {
  label: string;
  title?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-switch-row" title={title}>
      <span>{label}</span>
      <input
        className="toggle toggle-primary toggle-sm"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

function GeneralPage({ onThemeChange }: { onThemeChange: (dark: boolean) => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusState>(null);
  const [preference, setPreference] = useState<UiLocalePreference>(readUiLocalePreference());
  const [settings, setSettings] = useState(() => readStored("wordollama-general-settings", {
    aiMode: "ollama",
    language: "auto",
    outputMode: "Auto",
    darkTheme: false,
    suppressPlan: false,
    suppressDiff: false,
  }));
  const saved = useRef({ preference, settings });

  const update = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    if (key === "darkTheme") onThemeChange(Boolean(value));
  };

  const save = async () => {
    writeStored("wordollama-general-settings", settings);
    await setUiLocalePreference(preference);
    runtime.setOutputLanguage(settings.language);
    saved.current = { preference, settings };
    setStatus({ text: t("common.saved") });
  };
  useSettingsSection(
    "general",
    preference !== saved.current.preference || !settingsEqual(settings, saved.current.settings),
    save,
  );

  return (
    <div className="settings-page">
      <PageHeading title={t("general.title")} />
      <div className="settings-grid">
        <Card title={t("general.appearance")}>
          <div className="settings-form-grid">
            <label htmlFor="ui-language">{t("general.uiLanguage")}</label>
            <select
              id="ui-language"
              className="select select-sm"
              value={preference}
              onChange={(event) => {
                const value = event.currentTarget.value as UiLocalePreference;
                setPreference(value);
              }}
            >
              <option value="auto">{t("general.uiLanguageAuto")}</option>
              <option value="en-US">{t("general.uiLanguageEnglish")}</option>
              <option value="zh-CN">{t("general.uiLanguageChinese")}</option>
            </select>
            <div className="settings-row-wide settings-switch-list">
              <SwitchRow
                label={t("general.darkTheme")}
                checked={settings.darkTheme}
                onChange={(value) => update("darkTheme", value)}
              />
            </div>
          </div>
        </Card>
        <Card title={t("general.ai")}>
          <div className="settings-form-grid">
            <label htmlFor="ai-mode">{t("general.aiMode")}</label>
            <select
              id="ai-mode"
              className="select select-sm"
              value={settings.aiMode}
              onChange={(event) => update("aiMode", event.currentTarget.value)}
            >
              <option value="ollama">{t("general.localMode")}</option>
              <option value="online">{t("general.onlineMode")}</option>
            </select>
            <label htmlFor="output-language">{t("general.outputLanguage")}</label>
            <select
              id="output-language"
              className="select select-sm"
              value={settings.language}
              onChange={(event) => update("language", event.currentTarget.value)}
            >
              <option value="auto">{t("general.languageAuto")}</option>
              <option value="zh">{t("general.languageChinese")}</option>
              <option value="en">{t("general.languageEnglish")}</option>
              <option value="source">{t("general.languageSource")}</option>
            </select>
            <label htmlFor="output-mode">{t("general.outputMode")}</label>
            <select
              id="output-mode"
              className="select select-sm"
              value={settings.outputMode}
              onChange={(event) => update("outputMode", event.currentTarget.value)}
            >
              <option value="Auto">{t("general.outputAuto")}</option>
              <option value="InsertBelow">{t("general.insertBelow")}</option>
              <option value="InsertBelowWithDiff">{t("general.insertWithDiff")}</option>
              <option value="ReplaceOriginal">{t("general.replace")}</option>
              <option value="Comment">{t("general.comment")}</option>
              <option value="ReviewPane">{t("general.reviewPane")}</option>
            </select>
          </div>
        </Card>
        <Card title={t("general.behavior")} wide>
          <div className="settings-switch-list">
            <SwitchRow
              label={t("general.suppressPlan")}
              checked={settings.suppressPlan}
              onChange={(value) => update("suppressPlan", value)}
            />
            <SwitchRow
              label={t("general.suppressDiff")}
              checked={settings.suppressDiff}
              onChange={(value) => update("suppressDiff", value)}
            />
          </div>
          <Status value={status} />
        </Card>
      </div>
    </div>
  );
}

const emptyProvider: ProviderProfileUpdate = {
  id: "ollama",
  name: "Ollama",
  type: "Ollama",
  endpoint: "http://127.0.0.1:11434",
  model: "",
  toolCallingMode: "Auto",
  supportsStreaming: true,
  supportsVision: false,
  supportsJsonOutput: false,
  contextWindow: 0,
  temperature: 0.5,
  maxTokens: 4096,
  keepAlive: "5m",
};

type ProviderPreset = {
  id: string;
  labelKey: string;
  name: string;
  type: string;
  endpoint: string;
};

const providerPresets: ProviderPreset[] = [
  { id: "ollama", labelKey: "models.providers.ollama", name: "Ollama", type: "Ollama", endpoint: "http://127.0.0.1:11434" },
  { id: "openai", labelKey: "models.providers.openai", name: "OpenAI", type: "OpenAI", endpoint: "https://api.openai.com/v1" },
  { id: "deepseek", labelKey: "models.providers.deepseek", name: "DeepSeek", type: "OpenAI", endpoint: "https://api.deepseek.com" },
  { id: "qwen", labelKey: "models.providers.qwen", name: "Qwen", type: "OpenAI", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "doubao", labelKey: "models.providers.doubao", name: "Doubao", type: "OpenAI", endpoint: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "zhipu", labelKey: "models.providers.zhipu", name: "Zhipu GLM", type: "OpenAI", endpoint: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "kimi", labelKey: "models.providers.kimi", name: "Kimi", type: "OpenAI", endpoint: "https://api.moonshot.cn/v1" },
  { id: "siliconflow", labelKey: "models.providers.siliconflow", name: "SiliconFlow", type: "OpenAI", endpoint: "https://api.siliconflow.cn/v1" },
  { id: "minimax", labelKey: "models.providers.minimax", name: "MiniMax", type: "OpenAI", endpoint: "https://api.minimaxi.chat/v1" },
  { id: "claude", labelKey: "models.providers.claude", name: "Claude", type: "Claude", endpoint: "https://api.anthropic.com/v1" },
  { id: "gemini", labelKey: "models.providers.gemini", name: "Gemini", type: "Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "lm-studio", labelKey: "models.providers.lmStudio", name: "LM Studio", type: "LMStudio", endpoint: "http://127.0.0.1:1234/v1" },
  { id: "vllm", labelKey: "models.providers.vllm", name: "vLLM", type: "vLLM", endpoint: "http://127.0.0.1:8000/v1" },
  { id: "llama-cpp", labelKey: "models.providers.llamaCpp", name: "llama.cpp", type: "OpenAI", endpoint: "http://127.0.0.1:8080/v1" },
  { id: "custom", labelKey: "models.providers.custom", name: "OpenAI Compatible", type: "OpenAI", endpoint: "" },
];

function providerToUpdate(profile: ProviderProfileView): ProviderProfileUpdate {
  return { ...profile, apiKey: undefined, clearApiKey: false };
}

function createProviderUpdate(
  preset: ProviderPreset,
  id = preset.id,
  displayName = preset.name,
): ProviderProfileUpdate {
  const isOllama = preset.type === "Ollama";
  const isNativeOnline = preset.type === "Claude" || preset.type === "Gemini";
  return {
    ...emptyProvider,
    id,
    name: displayName,
    type: preset.type,
    endpoint: preset.endpoint,
    model: "",
    maxTokens: isOllama ? 4096 : 8192,
    supportsVision: isNativeOnline,
    supportsJsonOutput: preset.type !== "Claude" && !isOllama,
  };
}

function uniqueProviderId(base: string, profiles: ProviderProfileView[]): string {
  const stem = base.replace(/[^A-Za-z0-9_-]/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "") || "model";
  const existing = new Set(profiles.map((profile) => profile.id.toLocaleLowerCase()));
  if (!existing.has(stem.toLocaleLowerCase())) return stem;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem}-${index}`;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${stem}-${Date.now().toString(36)}`.slice(0, 64);
}

function normalizedEndpoint(value: string): string {
  return value.trim().replace(/\/+$/u, "").toLowerCase();
}

function presetForProfile(profile: ProviderProfileView): ProviderPreset {
  return providerPresets.find((preset) => preset.id === profile.id)
    ?? providerPresets.find((preset) =>
      normalizedEndpoint(preset.endpoint) !== "" &&
      normalizedEndpoint(preset.endpoint) === normalizedEndpoint(profile.endpoint))
    ?? (profile.type === "OpenAI"
      ? providerPresets.find((preset) => preset.id === "custom")
      : undefined)
    ?? providerPresets.find((preset) => preset.type === profile.type)
    ?? providerPresets[providerPresets.length - 1];
}

function ModelsPage() {
  const { t, i18n } = useTranslation();
  const [profiles, setProfiles] = useState<ProviderProfileView[]>([]);
  const [activeId, setActiveId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"new" | "edit">("new");
  const [presetId, setPresetId] = useState("ollama");
  const [form, setForm] = useState<ProviderProfileUpdate>(emptyProvider);
  const [models, setModels] = useState<string[]>([]);
  const [oauth, setOauth] = useState({ clientId: "", clientSecret: "", quotaProject: "" });
  const [status, setStatus] = useState<StatusState>(null);
  const [connectionStatus, setConnectionStatus] = useState<StatusState>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderProfileView | null>(null);

  const load = async () => {
    try {
      const view = await runtime.getProviderSettings();
      setProfiles(view.profiles);
      setActiveId(view.activeProviderId);
      setStatus(null);
    } catch (error) {
      setStatus(toStatus(error, t("common.notConnected")));
    }
  };

  useEffect(() => { void load(); }, []);

  const patch = <K extends keyof ProviderProfileUpdate>(key: K, value: ProviderProfileUpdate[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const applyView = (view: { profiles: ProviderProfileView[]; activeProviderId: string }) => {
    setProfiles(view.profiles);
    setActiveId(view.activeProviderId);
  };

  const refreshModels = async () => {
    setConnectionStatus({ text: t("models.fetchingModels") });
    try {
      const result = await runtime.fetchProviderModels(form);
      setModels(result.models);
      setConnectionStatus({
        text: result.models.length
          ? t("models.connectionSucceeded", { count: result.models.length })
          : t("models.emptyModels"),
        error: result.models.length === 0,
      });
    } catch (error) {
      setConnectionStatus(toStatus(error, t("models.fetchModelsFailed")));
    }
  };

  const selectModel = async (model: string) => {
    patch("model", model);
    if (form.type.toLowerCase() !== "ollama") return;
    try {
      await runtime.loadOllamaModel(model);
      setStatus({ text: t("models.modelLoaded", { model }) });
    } catch (error) {
      setStatus(toStatus(error, t("common.notConnected")));
    }
  };

  const isGoogleProvider = /^(gemini|google)$/iu.test(form.type.trim());
  const openNewModel = () => {
    const preset = providerPresets[0];
    setEditorMode("new");
    setPresetId(preset.id);
    setForm(createProviderUpdate(
      preset,
      uniqueProviderId(preset.id, profiles),
      t(preset.labelKey),
    ));
    setModels([]);
    setOauth({ clientId: "", clientSecret: "", quotaProject: "" });
    setConnectionStatus(null);
    setEditorOpen(true);
  };

  const openModelDetails = (profile: ProviderProfileView) => {
    setEditorMode("edit");
    setPresetId(presetForProfile(profile).id);
    setForm(providerToUpdate(profile));
    setModels([]);
    setOauth({ clientId: "", clientSecret: "", quotaProject: "" });
    setConnectionStatus(null);
    setEditorOpen(true);
  };

  const selectPreset = (preset: ProviderPreset) => {
    setPresetId(preset.id);
    setForm((current) => createProviderUpdate(
      preset,
      editorMode === "new" ? uniqueProviderId(preset.id, profiles) : current.id,
      editorMode === "new" ? t(preset.labelKey) : current.name,
    ));
    setModels([]);
    setConnectionStatus(null);
  };

  const saveProvider = async () => {
    try {
      await runtime.saveProviderProfile(form);
      const activated = await runtime.activateProvider(form.id);
      applyView(activated);
      setEditorOpen(false);
      setStatus({
        text: editorMode === "new"
          ? t("models.modelAdded", { name: form.name })
          : t("models.modelUpdated", { name: form.name }),
      });
    } catch (error) {
      setConnectionStatus(toStatus(error, t("common.notConnected")));
    }
  };

  const activateProfile = async (profile: ProviderProfileView) => {
    try {
      applyView(await runtime.activateProvider(profile.id));
      setStatus({ text: t("models.modelActivated", { name: profile.name || profile.model }) });
    } catch (error) {
      setStatus(toStatus(error, t("common.notConnected")));
    }
  };

  const deleteProfile = async () => {
    if (!deleteTarget) return;
    try {
      applyView(await runtime.deleteProvider(deleteTarget.id));
      setDeleteTarget(null);
      setStatus({ text: t("models.modelDeleted", { name: deleteTarget.name || deleteTarget.model }) });
    } catch (error) {
      setDeleteTarget(null);
      setStatus(toStatus(error, t("models.deleteFailed")));
    }
  };

  const canSave = Boolean(
    form.name.trim() &&
    form.endpoint.trim() &&
    form.model.trim(),
  );

  return (
    <div className="settings-page">
      <PageHeading title={t("models.title")} />
      <Card
        title={t("models.savedModels")}
        actions={<span className="badge badge-ghost badge-sm">{t("models.modelCount", { count: profiles.length })}</span>}
        wide
      >
        {profiles.length ? (
          <ul className="list settings-saved-model-list">
            {profiles.map((profile) => {
              const active = profile.id === activeId;
              return (
                <li className={`list-row settings-saved-model-row${active ? " active" : ""}`} key={profile.id}>
                  <div className="settings-saved-model-mark" aria-hidden="true">
                    {(profile.name || profile.model || profile.type).slice(0, 1).toLocaleUpperCase()}
                  </div>
                  <div className="list-col-grow min-w-0">
                    <div className="settings-saved-model-title">
                      <strong>{profile.name || profile.model}</strong>
                      {active ? <span className="badge badge-primary badge-soft badge-sm">{t("models.current")}</span> : null}
                    </div>
                    <div className="settings-saved-model-meta">
                      <span>{t(presetForProfile(profile).labelKey)}</span>
                      <span>·</span>
                      <span>{profile.model || t("models.modelNotConfigured")}</span>
                    </div>
                  </div>
                  <div className="settings-saved-model-actions">
                    <button
                      className={`btn btn-sm${active ? " btn-primary" : ""}`}
                      type="button"
                      disabled={active}
                      onClick={() => void activateProfile(profile)}
                    >
                      {active ? <CircleCheck size={14} /> : null}
                      {active ? t("models.current") : t("models.switch")}
                    </button>
                    <button className="btn btn-sm" type="button" onClick={() => openModelDetails(profile)}>
                      <Pencil size={14} />
                      {t("models.details")}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm text-error"
                      type="button"
                      disabled={profiles.length <= 1}
                      title={profiles.length <= 1 ? t("models.keepOneModel") : undefined}
                      onClick={() => setDeleteTarget(profile)}
                    >
                      <Trash2 size={14} />
                      {t("common.delete")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <div className="settings-list-empty">{t("models.emptySavedModels")}</div>}
        <div className="card-actions settings-model-list-actions">
          <button className="btn btn-primary btn-sm" type="button" onClick={openNewModel}>
            <Plus size={15} />
            {t("models.addModel")}
          </button>
        </div>
        <Status value={status} />
      </Card>

      {editorOpen ? (
        <dialog
          className="modal modal-open"
          open
          onCancel={(event) => {
            event.preventDefault();
            setEditorOpen(false);
          }}
        >
          <div className="modal-box settings-model-editor-modal">
            <div className="settings-model-editor-heading">
              <div>
                <h2>{editorMode === "new" ? t("models.addModel") : t("models.editModel")}</h2>
                <p>{editorMode === "new" ? t("models.addModelHint") : t("models.editModelHint")}</p>
              </div>
              <button className="btn btn-ghost btn-sm btn-square" type="button" aria-label={t("common.close")} onClick={() => setEditorOpen(false)}>
                <X size={17} />
              </button>
            </div>

            <div className="settings-model-editor-grid">
              <fieldset className="fieldset">
                <legend className="fieldset-legend">{t("models.provider")}</legend>
                <select
                  className="select select-sm w-full"
                  value={presetId}
                  onChange={(event) => {
                    const preset = providerPresets.find((item) => item.id === event.currentTarget.value);
                    if (preset) selectPreset(preset);
                  }}
                >
                  {providerPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>{t(preset.labelKey)}</option>
                  ))}
                </select>
              </fieldset>
              <fieldset className="fieldset">
                <legend className="fieldset-legend">{t("models.profileName")}</legend>
                <input className="input input-sm w-full" value={form.name} onChange={(event) => patch("name", event.currentTarget.value)} />
              </fieldset>
              <fieldset className="fieldset settings-model-editor-wide">
                <legend className="fieldset-legend">{t("models.endpoint")}</legend>
                <input className="input input-sm w-full" type="url" value={form.endpoint} onChange={(event) => patch("endpoint", event.currentTarget.value)} />
                <p className="label">{t("models.endpointAutoHint")}</p>
              </fieldset>
              {form.type !== "Ollama" ? (
                <fieldset className="fieldset settings-model-editor-wide">
                  <legend className="fieldset-legend">{t("models.apiKey")}</legend>
                  <input className="input input-sm w-full" type="password" value={form.apiKey ?? ""} onChange={(event) => patch("apiKey", event.currentTarget.value)} placeholder={t("models.apiKeyHint")} />
                </fieldset>
              ) : null}
              <fieldset className="fieldset settings-model-editor-wide">
                <legend className="fieldset-legend">{t("models.model")}</legend>
                <div className="settings-model-fetch-row">
                  <button className="btn btn-sm" type="button" onClick={() => void refreshModels()}>
                    <RefreshCw size={14} />
                    {t("models.fetchModels")}
                  </button>
                  <select
                    className="select select-sm"
                    aria-label={t("models.fetchedModels")}
                    disabled={!models.length}
                    value={models.includes(form.model) ? form.model : ""}
                    onChange={(event) => {
                      if (event.currentTarget.value) void selectModel(event.currentTarget.value);
                    }}
                  >
                    <option value="">{models.length ? t("models.chooseFetchedModel") : t("models.fetchModelsFirst")}</option>
                    {models.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                </div>
                <input className="input input-sm w-full" value={form.model} onChange={(event) => patch("model", event.currentTarget.value)} placeholder={t("models.modelHint")} />
              </fieldset>
            </div>

            <details className="collapse collapse-arrow settings-model-editor-section">
              <summary className="collapse-title">{t("models.generation")}</summary>
              <div className="collapse-content">
                <div className="settings-model-editor-grid">
                  <fieldset className="fieldset">
                    <legend className="fieldset-legend">{t("models.toolMode")}</legend>
                    <select className="select select-sm w-full" value={form.toolCallingMode} onChange={(event) => patch("toolCallingMode", event.currentTarget.value)}>
                      {["Auto", "Native", "ReAct"].map((mode) => <option key={mode}>{mode}</option>)}
                    </select>
                  </fieldset>
                  <fieldset className="fieldset">
                    <legend className="fieldset-legend">{t("models.contextWindow")}</legend>
                    <input className="input input-sm w-full" type="number" min={0} value={form.contextWindow} onChange={(event) => patch("contextWindow", Number(event.currentTarget.value))} />
                  </fieldset>
                  <fieldset className="fieldset">
                    <legend className="fieldset-legend">{t("models.maxTokens")}</legend>
                    <input className="input input-sm w-full" type="number" min={1} value={form.maxTokens} onChange={(event) => patch("maxTokens", Number(event.currentTarget.value))} />
                  </fieldset>
                  {form.type === "Ollama" ? (
                    <fieldset className="fieldset">
                      <legend className="fieldset-legend">{t("models.keepAlive")}</legend>
                      <input className="input input-sm w-full" value={form.keepAlive} onChange={(event) => patch("keepAlive", event.currentTarget.value)} />
                    </fieldset>
                  ) : null}
                  <fieldset className="fieldset settings-model-editor-wide">
                    <legend className="fieldset-legend">{t("models.temperatureWithValue", { value: form.temperature.toFixed(1) })}</legend>
                    <input className="range range-primary range-xs" type="range" min="0" max="2" step="0.1" value={form.temperature} onChange={(event) => patch("temperature", Number(event.currentTarget.value))} />
                  </fieldset>
                  <div className="settings-model-editor-wide settings-switch-list">
                    <SwitchRow label={t("models.streaming")} checked={form.supportsStreaming} onChange={(value) => patch("supportsStreaming", value)} />
                    <SwitchRow label={t("models.vision")} checked={form.supportsVision} onChange={(value) => patch("supportsVision", value)} />
                    <SwitchRow label={t("models.json")} checked={form.supportsJsonOutput} onChange={(value) => patch("supportsJsonOutput", value)} />
                  </div>
                </div>
              </div>
            </details>

            {isGoogleProvider && editorMode === "edit" ? (
              <details className="collapse collapse-arrow settings-model-editor-section">
                <summary className="collapse-title">{t("models.oauth")}</summary>
                <div className="collapse-content">
                  <div className="settings-model-editor-grid">
                    <fieldset className="fieldset settings-model-editor-wide">
                      <legend className="fieldset-legend">{t("models.oauthClientId")}</legend>
                      <input className="input input-sm w-full" value={oauth.clientId} onChange={(event) => setOauth((current) => ({ ...current, clientId: event.currentTarget.value }))} />
                    </fieldset>
                    <fieldset className="fieldset">
                      <legend className="fieldset-legend">{t("models.oauthClientSecret")}</legend>
                      <input className="input input-sm w-full" type="password" value={oauth.clientSecret} onChange={(event) => setOauth((current) => ({ ...current, clientSecret: event.currentTarget.value }))} />
                    </fieldset>
                    <fieldset className="fieldset">
                      <legend className="fieldset-legend">{t("models.googleProject")}</legend>
                      <input className="input input-sm w-full" value={oauth.quotaProject} onChange={(event) => setOauth((current) => ({ ...current, quotaProject: event.currentTarget.value }))} />
                    </fieldset>
                  </div>
                  <button
                    className="btn btn-sm mt-3"
                    type="button"
                    disabled={!oauth.clientId.trim()}
                    onClick={() => void runtime.authorizeGoogleProvider(form.id, {
                      clientId: oauth.clientId.trim(),
                      clientSecret: oauth.clientSecret.trim() || undefined,
                      quotaProject: oauth.quotaProject.trim() || undefined,
                      uiLocale: i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en-US",
                    }).then((result) => {
                      applyView(result.providerSettings);
                      setOauth((current) => ({ ...current, clientSecret: "" }));
                      setConnectionStatus({ text: result.hasRefreshToken ? t("models.oauthSuccess") : t("models.oauthSuccessNoRefresh") });
                    }).catch((error) => setConnectionStatus(toStatus(error, t("models.oauthFailed"))))}
                  >
                    {t("models.oauthLogin")}
                  </button>
                </div>
              </details>
            ) : null}

            <Status value={connectionStatus} />
            <div className="modal-action">
              <button className="btn btn-sm" type="button" onClick={() => setEditorOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-primary btn-sm" type="button" disabled={!canSave} onClick={() => void saveProvider()}>{t("common.save")}</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop" onSubmit={() => setEditorOpen(false)}>
            <button aria-label={t("common.close")}>{t("common.close")}</button>
          </form>
        </dialog>
      ) : null}

      {deleteTarget ? (
        <dialog className="modal modal-open" open onCancel={() => setDeleteTarget(null)}>
          <div className="modal-box settings-confirm-modal">
            <h2>{t("models.deleteModel")}</h2>
            <p>{t("models.deleteConfirm", { name: deleteTarget.name || deleteTarget.model })}</p>
            <div className="modal-action">
              <button className="btn btn-sm" type="button" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</button>
              <button className="btn btn-error btn-sm" type="button" onClick={() => void deleteProfile()}>{t("common.delete")}</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop" onSubmit={() => setDeleteTarget(null)}>
            <button aria-label={t("common.close")}>{t("common.close")}</button>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}

function SkillsPage() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<StatusState>(null);
  const [preview, setPreview] = useState<{
    skill: SkillSummary;
    content: string;
    loading: boolean;
    error?: string;
  } | null>(null);

  const load = async () => {
    try {
      const listed = await runtime.listSkills();
      setSkills(Array.from(new Map(listed.map((skill) => [skill.name, skill])).values()));
      setStatus(null);
    } catch (error) {
      setStatus(toStatus(error, t("common.notConnected")));
    }
  };
  useEffect(() => { void load(); }, []);
  const previewHtml = useMemo(() => preview?.content
    ? markdownToHtml(preview.content, { headings: true, tables: true, code: true })
    : "", [preview?.content]);
  const openPreview = async (skill: SkillSummary) => {
    setPreview({ skill, content: "", loading: true });
    try {
      const content = await runtime.readSkill(skill.name);
      setPreview({ skill, content, loading: false });
    } catch (error) {
      setPreview({
        skill,
        content: "",
        loading: false,
        error: error instanceof Error ? error.message : t("skills.previewFailed"),
      });
    }
  };

  return (
    <div className="settings-page">
      <PageHeading title={t("skills.title")} />
      <Card
        title={t("skills.installed")}
        actions={(
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-xs" type="button" onClick={() => void runtime.openSkillsFolder().catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}><FolderOpen size={14} />{t("common.openFolder")}</button>
            <button className="btn btn-ghost btn-xs" type="button" onClick={() => void load()}><RefreshCw size={14} />{t("common.refresh")}</button>
          </div>
        )}
      >
        <div className="settings-import">
          <input className="file-input file-input-sm" type="file" accept=".zip,application/zip" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
          <button className="btn btn-primary btn-sm" type="button" disabled={!file} onClick={() => void (async () => {
            if (!file) return;
            try {
              await runtime.importSkill(file.name, await fileToBase64(file));
              await load();
            } catch (error) {
              setStatus(toStatus(error, t("common.notConnected")));
            }
          })()}><Upload size={14} />{t("skills.importZip")}</button>
        </div>
        <div className={`mt-4 ${skills.length ? "settings-list" : "settings-list-empty"}`}>
          {skills.length ? skills.map((skill) => (
            <div className="settings-list-button settings-skill-row" key={skill.name} title={skill.description}>
              <div className="min-w-0">
                <strong>{skill.name}</strong>
              </div>
              <div className="settings-skill-actions">
                <button className="btn btn-sm" type="button" onClick={() => void openPreview(skill)}>
                  <Eye size={14} />
                  {t("skills.preview")}
                </button>
                <button className="btn btn-ghost btn-sm text-error" type="button" onClick={() => void runtime.deleteSkill(skill.name).then(load).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>
                  <Trash2 size={14} />
                  {t("common.delete")}
                </button>
              </div>
            </div>
          )) : t("skills.empty")}
        </div>
        <Status value={status} />
      </Card>
      {preview ? (
        <dialog className="modal modal-open" open onCancel={() => setPreview(null)}>
          <div className="modal-box settings-skill-preview-modal">
            <div className="settings-model-editor-heading">
              <div>
                <h2>{preview.skill.name}</h2>
                <p>{preview.skill.description || t("skills.previewTitle")}</p>
              </div>
              <button className="btn btn-ghost btn-sm btn-square" type="button" aria-label={t("common.close")} onClick={() => setPreview(null)}>
                <X size={17} />
              </button>
            </div>
            {preview.loading ? (
              <div className="settings-skill-preview-loading">
                <span className="loading loading-spinner loading-sm" />
                <span>{t("skills.loadingPreview")}</span>
              </div>
            ) : null}
            {preview.error ? <div className="alert alert-error text-sm">{preview.error}</div> : null}
            {!preview.loading && !preview.error ? (
              <article
                className="settings-skill-preview"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : null}
            <div className="modal-action">
              <button className="btn btn-sm" type="button" onClick={() => setPreview(null)}>{t("common.close")}</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop" onSubmit={() => setPreview(null)}>
            <button aria-label={t("common.close")}>{t("common.close")}</button>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}

const emptyMcp: McpServerUpdate = {
  name: "",
  transport: "stdio",
  command: "",
  arguments: [],
  enabled: true,
  trusted: false,
};

function McpPage() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [form, setForm] = useState<McpServerUpdate>(emptyMcp);
  const [argsText, setArgsText] = useState("");
  const [environmentText, setEnvironmentText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [tools, setTools] = useState<McpToolDefinition[]>([]);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<StatusState>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");

  const load = async () => {
    try {
      setServers(await runtime.listMcpServers());
      setStatus(null);
    } catch (error) {
      setStatus(toStatus(error, t("common.notConnected")));
    }
  };
  useEffect(() => { void load(); }, []);

  const select = async (server: McpServerView) => {
    setForm({
      name: server.name,
      transport: server.transport,
      command: server.command,
      arguments: server.arguments,
      workingDirectory: server.workingDirectory,
      enabled: server.enabled,
      trusted: server.trusted,
    });
    setArgsText(server.arguments.join("\n"));
    setEnvironmentText(server.environmentKeys.map((key) => `${key}=`).join("\n"));
    setHeadersText(server.headerKeys.map((key) => `${key}=`).join("\n"));
    setPermissions(server.toolPermissions);
    try {
      setTools(server.connected ? await runtime.listMcpTools(server.name) : []);
    } catch {
      setTools([]);
    }
    setEditorOpen(true);
  };

  const openNewServer = () => {
    setForm(emptyMcp);
    setArgsText("");
    setEnvironmentText("");
    setHeadersText("");
    setTools([]);
    setPermissions({});
    setEditorOpen(true);
  };

  const payload = (): McpServerUpdate => ({
    ...form,
    arguments: parseLines(argsText),
    environment: parsePairs(environmentText),
    headers: parsePairs(headersText),
  });

  const importServers = async () => {
    try {
      const result = await runtime.importMcpJson(importJson);
      setServers(result.servers);
      setImportOpen(false);
      setImportJson("");
      const failed = Object.keys(result.errors).length;
      setStatus({
        text: failed
          ? t("mcp.importedWithErrors", { total: result.total, connected: result.connected, failed })
          : t("mcp.imported", { total: result.total, connected: result.connected }),
        error: failed > 0,
      });
    } catch (error) {
      setStatus(toStatus(error, t("mcp.importFailed")));
    }
  };

  return (
    <div className="settings-page">
      <PageHeading title={t("mcp.title")} />
      <Card
        title={t("mcp.servers")}
        wide
        actions={(
          <button className="btn btn-ghost btn-xs" type="button" onClick={() => setImportOpen(true)}>
            <Upload size={14} />{t("mcp.importJson")}
          </button>
        )}
      >
        <div className={servers.length ? "settings-list" : "settings-list-empty"}>
          {servers.length ? servers.map((server) => (
            <button className="settings-list-button settings-mcp-server-row" key={server.name} type="button" onClick={() => void select(server)}>
              <span>
                <strong>{server.name}</strong>
                <small>{server.transport} · {server.toolCount} {t("mcp.tools")}</small>
              </span>
              <span className={`badge badge-sm ${server.connected ? "badge-success badge-soft" : "badge-ghost"}`}>
                {server.connected ? t("mcp.connected") : t("mcp.disconnected")}
              </span>
            </button>
          )) : t("mcp.emptyServers")}
        </div>
        <div className="card-actions settings-model-list-actions">
          <button className="btn btn-primary btn-sm" type="button" onClick={openNewServer}>
            <Plus size={15} />{t("mcp.newServer")}
          </button>
        </div>
        <Status value={status} />
      </Card>

      {editorOpen ? (
        <dialog className="modal modal-open" open onCancel={() => setEditorOpen(false)}>
          <div className="modal-box settings-model-editor-modal">
            <div className="settings-model-editor-heading">
              <div>
                <h2>{form.name ? t("mcp.configuration") : t("mcp.newServer")}</h2>
                <p>{t("mcp.configurationHint")}</p>
              </div>
              <button className="btn btn-ghost btn-sm btn-square" type="button" aria-label={t("common.close")} onClick={() => setEditorOpen(false)}>
                <X size={17} />
              </button>
            </div>
            <div className="settings-model-editor-grid">
              <fieldset className="fieldset">
                <legend className="fieldset-legend">{t("mcp.name")}</legend>
                <input id="mcp-name-react" className="input input-sm w-full" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.currentTarget.value }))} />
              </fieldset>
              <fieldset className="fieldset">
                <legend className="fieldset-legend">{t("mcp.transport")}</legend>
                <select className="select select-sm w-full" value={form.transport} onChange={(event) => setForm((current) => ({ ...current, transport: event.currentTarget.value }))}>
                  {["stdio", "streamable-http", "sse"].map((transport) => <option key={transport}>{transport}</option>)}
                </select>
              </fieldset>
              <fieldset className="fieldset settings-model-editor-wide">
                <legend className="fieldset-legend">{t("mcp.command")}</legend>
                <input className="input input-sm w-full" value={form.command} onChange={(event) => setForm((current) => ({ ...current, command: event.currentTarget.value }))} />
              </fieldset>
              <fieldset className="fieldset settings-model-editor-wide">
                <legend className="fieldset-legend">{t("mcp.arguments")}</legend>
                <textarea className="textarea textarea-sm w-full" rows={3} value={argsText} onChange={(event) => setArgsText(event.currentTarget.value)} placeholder={t("mcp.onePerLine")} />
              </fieldset>
            </div>
            <details className="collapse collapse-arrow settings-model-editor-section">
              <summary className="collapse-title">{t("common.advanced")}</summary>
              <div className="collapse-content settings-model-editor-grid">
                <fieldset className="fieldset settings-model-editor-wide">
                  <legend className="fieldset-legend">{t("mcp.workingDirectory")}</legend>
                  <input className="input input-sm w-full" value={form.workingDirectory ?? ""} onChange={(event) => setForm((current) => ({ ...current, workingDirectory: event.currentTarget.value }))} />
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">{t("mcp.environment")}</legend>
                  <textarea className="textarea textarea-sm w-full" rows={3} value={environmentText} onChange={(event) => setEnvironmentText(event.currentTarget.value)} placeholder={t("mcp.keyValuePerLine")} />
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">{t("mcp.headers")}</legend>
                  <textarea className="textarea textarea-sm w-full" rows={3} value={headersText} onChange={(event) => setHeadersText(event.currentTarget.value)} placeholder={t("mcp.keyValuePerLine")} />
                </fieldset>
              </div>
            </details>
            <div className="settings-switch-list mt-3">
              <SwitchRow label={t("mcp.autoConnect")} checked={form.enabled} onChange={(value) => setForm((current) => ({ ...current, enabled: value }))} />
              <SwitchRow label={t("mcp.trustAll")} checked={form.trusted} onChange={(value) => setForm((current) => ({ ...current, trusted: value }))} />
            </div>
            {tools.length ? (
              <details className="collapse collapse-arrow settings-model-editor-section">
                <summary className="collapse-title">{t("mcp.permissions")} · {tools.length}</summary>
                <div className="collapse-content settings-switch-list">
                  {tools.map((tool) => (
                    <SwitchRow key={tool.name} label={tool.name} title={tool.description} checked={permissions[tool.name] ?? false} onChange={(value) => setPermissions((current) => ({ ...current, [tool.name]: value }))} />
                  ))}
                  <button className="btn btn-sm mt-2" type="button" onClick={() => void runtime.saveMcpPermissions(form.name, permissions).then(() => setStatus({ text: t("common.saved") })).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("mcp.savePermissions")}</button>
                </div>
              </details>
            ) : null}
            <div className="modal-action settings-mcp-editor-actions">
              <button className="btn btn-primary btn-sm" type="button" disabled={!form.name.trim() || !form.command.trim()} onClick={() => void runtime.saveMcpServer(payload()).then(async (result) => { setTools(result.tools); await load(); setEditorOpen(false); setStatus({ text: t("common.saved") }); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("mcp.saveConnect")}</button>
              <button className="btn btn-sm" type="button" disabled={!form.name} onClick={() => void runtime.connectMcpServer(form.name).then((result) => { setTools(result.tools); void load(); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("common.connect")}</button>
              <button className="btn btn-sm" type="button" disabled={!form.name} onClick={() => void runtime.checkMcpHealth(form.name).then((health) => setStatus({ text: `${health.connected ? "✓" : "×"} · ${health.toolCount}` })).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("mcp.health")}</button>
              <button className="btn btn-sm" type="button" disabled={!form.name} onClick={() => void runtime.disconnectMcpServer(form.name).then(load).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("common.disconnect")}</button>
              <button className="btn btn-ghost btn-sm text-error" type="button" disabled={!servers.some((server) => server.name === form.name)} onClick={() => void runtime.deleteMcpServer(form.name).then(() => { setEditorOpen(false); setForm(emptyMcp); return load(); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("common.delete")}</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop" onSubmit={() => setEditorOpen(false)}>
            <button aria-label={t("common.close")}>{t("common.close")}</button>
          </form>
        </dialog>
      ) : null}
      {importOpen ? (
        <dialog className="modal modal-open" open onCancel={() => setImportOpen(false)}>
          <div className="modal-box settings-model-editor-modal">
            <div className="settings-model-editor-heading">
              <div>
                <h2 id="mcp-import-title">{t("mcp.importJson")}</h2>
                <p>{t("mcp.importHint")}</p>
              </div>
              <button className="btn btn-ghost btn-sm btn-square" type="button" aria-label={t("common.close")} onClick={() => setImportOpen(false)}>
                <X size={17} />
              </button>
            </div>
            <div className="settings-modal-body p-0">
              <input
                className="file-input file-input-sm"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void file.text().then(setImportJson);
                }}
              />
              <textarea
                className="textarea"
                rows={12}
                value={importJson}
                onChange={(event) => setImportJson(event.currentTarget.value)}
                placeholder={t("mcp.importPlaceholder")}
              />
            </div>
            <div className="modal-action">
              <button className="btn btn-sm" type="button" onClick={() => setImportOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-primary btn-sm" type="button" disabled={!importJson.trim()} onClick={() => void importServers()}>{t("common.import")}</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop" onSubmit={() => setImportOpen(false)}>
            <button aria-label={t("common.close")}>{t("common.close")}</button>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}

function AgentPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusState>(null);
  const [agent, setAgent] = useState(() => readStored("wordollama-agent-settings", {
    iterations: 20,
    mode: "TrackedChanges",
    unlimited: false,
    externalTools: false,
  }));
  const [review, setReview] = useState(() => readStored("wordollama-linter-settings", {
    enabled: false,
    model: "",
    intervalSeconds: 30,
  }));
  const [writingProfile, setWritingProfile] = useState("");
  const saved = useRef({ agent, review, writingProfile });
  useEffect(() => {
    void runtime.getReviewSettings()
      .then((value) => {
        saved.current = { ...saved.current, writingProfile: value.writingProfile };
        setWritingProfile(value.writingProfile);
      })
      .catch((error) => setStatus(toStatus(error, t("common.notConnected"))));
  }, [t]);
  const save = async () => {
    let persistedWritingProfile = writingProfile;
    if (writingProfile !== saved.current.writingProfile) {
      const value = await runtime.saveReviewSettings(writingProfile);
      persistedWritingProfile = value.writingProfile;
    }
    writeStored("wordollama-agent-settings", agent);
    writeStored("wordollama-linter-settings", review);
    setWritingProfile(persistedWritingProfile);
    saved.current = { agent, review, writingProfile: persistedWritingProfile };
    setStatus({ text: t("common.saved") });
  };
  useSettingsSection(
    "agent",
    !settingsEqual(agent, saved.current.agent) ||
      !settingsEqual(review, saved.current.review) ||
      writingProfile !== saved.current.writingProfile,
    save,
  );
  return (
    <div className="settings-page">
      <PageHeading title={t("agent.title")} />
      <div className="settings-grid">
        <Card title={t("agent.execution")}>
          <div className="settings-form-grid">
            <label>{t("agent.iterations")}</label>
            <input className="input input-sm" type="number" min={1} value={agent.iterations} onChange={(event) => setAgent({ ...agent, iterations: Number(event.currentTarget.value) })} />
            <label>{t("agent.mode")}</label>
            <select className="select select-sm" value={agent.mode} onChange={(event) => setAgent({ ...agent, mode: event.currentTarget.value })}>
              <option value="ViewOnly">{t("agent.viewOnly")}</option>
              <option value="ProposeChanges">{t("agent.propose")}</option>
              <option value="TrackedChanges">{t("agent.tracked")}</option>
            </select>
            <div className="settings-row-wide settings-switch-list">
              <SwitchRow label={t("agent.unlimited")} checked={agent.unlimited} onChange={(value) => setAgent({ ...agent, unlimited: value })} />
              <SwitchRow label={t("agent.externalTools")} checked={agent.externalTools} onChange={(value) => setAgent({ ...agent, externalTools: value })} />
            </div>
          </div>
        </Card>
        <Card title={t("agent.review")}>
          <div className="settings-switch-list">
            <SwitchRow label={t("agent.enableReview")} checked={review.enabled} onChange={(value) => setReview({ ...review, enabled: value })} />
          </div>
          <div className="settings-form-grid mt-4">
            <label>{t("agent.reviewModel")}</label>
            <input className="input input-sm" value={review.model} onChange={(event) => setReview({ ...review, model: event.currentTarget.value })} />
            <label>{t("agent.reviewInterval")}</label>
            <input className="input input-sm" type="number" min={3} value={review.intervalSeconds} onChange={(event) => setReview({ ...review, intervalSeconds: Number(event.currentTarget.value) })} />
          </div>
        </Card>
        <Card title={t("taskpane.review.writingProfile")} wide>
          <textarea
            className="textarea"
            rows={5}
            value={writingProfile}
            onChange={(event) => setWritingProfile(event.currentTarget.value)}
            placeholder={t("taskpane.review.writingProfilePlaceholder")}
          />
        </Card>
      </div>
      <Status value={status} />
    </div>
  );
}

function MarkdownPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusState>(null);
  const [wordStyles, setWordStyles] = useState<string[]>([]);
  const [stylesLoading, setStylesLoading] = useState(true);
  const [newStyle, setNewStyle] = useState("");
  const [settings, setSettings] = useState(() =>
    readStored<MarkdownSettings>(
      "wordollama-markdown-settings",
      DEFAULT_MARKDOWN_SETTINGS,
    ));
  const saved = useRef(settings);
  const patch = (key: keyof typeof settings, value: string | boolean) => setSettings((current) => ({ ...current, [key]: value }));
  const refreshStyles = async () => {
    setStylesLoading(true);
    try {
      const styles = await listWordStyles();
      setWordStyles(styles);
      setStatus({ text: t("markdown.stylesLoaded", { count: styles.length }) });
    } catch (error) {
      setStatus({ text: t("markdown.stylesUnavailable"), error: true });
    } finally {
      setStylesLoading(false);
    }
  };
  useEffect(() => {
    void refreshStyles();
  }, []);
  const createStyle = async () => {
    const name = newStyle.trim();
    if (!name) return;
    try {
      await createWordParagraphStyle(name);
      const styles = await listWordStyles();
      setWordStyles(styles);
      setNewStyle("");
      setStatus({ text: t("markdown.styleCreated", { name }) });
    } catch (error) {
      setStatus({ text: t("markdown.stylesUnavailable"), error: true });
    }
  };
  const save = async () => {
    writeStored("wordollama-markdown-settings", settings);
    saved.current = settings;
    setStatus({ text: t("common.saved") });
  };
  useSettingsSection("markdown", !settingsEqual(settings, saved.current), save);
  return (
    <div className="settings-page">
      <PageHeading title={t("markdown.title")} />
      <div className="settings-grid">
        <Card title={t("markdown.conversion")}>
          <div className="settings-switch-list">
            <SwitchRow label={t("markdown.tables")} checked={settings.tables} onChange={(value) => patch("tables", value)} />
            <SwitchRow label={t("markdown.code")} checked={settings.code} onChange={(value) => patch("code", value)} />
            <SwitchRow label={t("markdown.headings")} checked={settings.headings} onChange={(value) => patch("headings", value)} />
          </div>
        </Card>
        <Card
          title={t("markdown.styles")}
          wide
          actions={(
            <button className="btn btn-ghost btn-xs" type="button" disabled={stylesLoading} onClick={() => void refreshStyles()}>
              <RefreshCw className={stylesLoading ? "animate-spin" : ""} size={14} />
              {t("markdown.refreshStyles")}
            </button>
          )}
        >
          <p className="settings-card-note">{t("markdown.stylesDescription")}</p>
          <div className="settings-markdown-style-grid">
            {([
              ["h1", "heading1"], ["h2", "heading2"], ["h3", "heading3"],
              ["paragraph", "paragraph"], ["codeStyle", "codeStyle"],
              ["blockquote", "blockquote"],
              ["unorderedList", "unorderedList"],
              ["orderedList", "orderedList"],
            ] as const).map(([key, label]) => (
              <fieldset className="fieldset settings-markdown-style-field" key={key}>
                <legend className="fieldset-legend">{t(`markdown.${label}`)}</legend>
                <select
                  className="select select-sm"
                  aria-label={t(`markdown.${label}`)}
                  value={settings[key]}
                  disabled={stylesLoading}
                  onChange={(event) => patch(key, event.currentTarget.value)}
                >
                  {!wordStyles.includes(settings[key]) ? <option value={settings[key]}>{settings[key]}</option> : null}
                  {wordStyles.map((style) => <option key={style} value={style}>{style}</option>)}
                </select>
              </fieldset>
            ))}
          </div>
          <div className="settings-style-create">
            <input className="input input-sm" value={newStyle} onChange={(event) => setNewStyle(event.currentTarget.value)} placeholder={t("markdown.newStyle")} />
            <button className="btn btn-sm" type="button" disabled={!newStyle.trim()} onClick={() => void createStyle()}>{t("markdown.createStyle")}</button>
          </div>
          <Status value={status} />
        </Card>
      </div>
    </div>
  );
}

function AdvancedPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusState>(null);
  const [ollama, setOllama] = useState<OllamaServerSettingsUpdate>({
    modelsPath: "", host: "127.0.0.1:11434", keepAlive: "5m",
    contextLength: 0, maxLoadedModels: 0, numParallel: 0, maxQueue: 0,
  });
  const saved = useRef(ollama);
  const loadOllama = async () => {
    try {
      const value = await runtime.getOllamaServerSettings();
      saved.current = value;
      setOllama(value);
    } catch (error) {
      setStatus(toStatus(error, t("common.notConnected")));
    }
  };
  const patch = <K extends keyof OllamaServerSettingsUpdate>(key: K, value: OllamaServerSettingsUpdate[K]) =>
    setOllama((current) => ({ ...current, [key]: value }));
  const save = async () => {
    const value = await runtime.saveOllamaServerSettings(ollama);
    saved.current = value;
    setOllama(value);
    setStatus({ text: t("common.saved") });
  };
  useSettingsSection("advanced", !settingsEqual(ollama, saved.current), save);
  useEffect(() => { void loadOllama(); }, []);
  return (
    <div className="settings-page">
      <PageHeading title={t("advanced.title")} />
      <div className="settings-grid">
        <Card title={t("advanced.bridge")}>
          <p className="text-sm opacity-70">{t("advanced.automaticPairing")}</p>
          <div className="settings-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void runtime.health().then((health) => setStatus({ text: `${health.bridgeVersion} · ${health.protocolVersion} · ${health.ready ? "✓" : "×"}` })).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("advanced.checkBridge")}</button>
          </div>
        </Card>
        <Card title={t("advanced.ollama")}>
          <div className="alert alert-warning mb-4 text-xs">{t("advanced.networkWarning")}</div>
          <div className="settings-form-grid">
            <label>{t("advanced.modelsPath")}</label>
            <input className="input input-sm" value={ollama.modelsPath} onChange={(event) => patch("modelsPath", event.currentTarget.value)} />
            <label>{t("advanced.host")}</label>
            <input className="input input-sm" value={ollama.host} onChange={(event) => patch("host", event.currentTarget.value)} />
            <label>{t("advanced.keepAlive")}</label>
            <input className="input input-sm" value={ollama.keepAlive} onChange={(event) => patch("keepAlive", event.currentTarget.value)} />
            {([
              ["contextLength", "contextLength"], ["maxLoadedModels", "maxLoaded"],
              ["numParallel", "parallel"], ["maxQueue", "maxQueue"],
            ] as const).map(([key, label]) => (
              <>
                <label key={`${key}-label`}>{t(`advanced.${label}`)}</label>
                <input key={key} className="input input-sm" type="number" value={ollama[key]} onChange={(event) => patch(key, Number(event.currentTarget.value))} />
              </>
            ))}
          </div>
          <div className="settings-actions">
            <button className="btn btn-sm" onClick={() => void loadOllama()}>{t("advanced.reloadOllama")}</button>
          </div>
        </Card>
      </div>
      <Status value={status} />
    </div>
  );
}

function UpdatesPage() {
  const { t } = useTranslation();
  const [bridgeVersion, setBridgeVersion] = useState<string>(t("common.notConnected"));
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [status, setStatus] = useState<StatusState>(null);
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    void runtime.health().then((health) => setBridgeVersion(health.bridgeVersion)).catch(() => undefined);
  }, []);
  const install = async () => {
    setInstalling(true);
    setStatus({ text: t("updates.preparingInstaller") });
    try {
      const result = await runtime.installUpdate();
      setConfirmInstall(false);
      setStatus({ text: t("updates.installerLaunched", { version: result.version }) });
    } catch (error) {
      setStatus(toStatus(error, t("updates.installFailed")));
    } finally {
      setInstalling(false);
    }
  };
  return (
    <div className="settings-page">
      <PageHeading title={t("updates.title")} />
      <Card title={t("updates.title")}>
        <div className="settings-form-grid">
          <label>{t("updates.addinVersion")}</label><output>{ADDIN_VERSION}</output>
          <label>{t("updates.bridgeVersion")}</label><output>{bridgeVersion}</output>
        </div>
        <div className="settings-actions">
          <button className="btn btn-primary btn-sm" onClick={() => void runtime.checkForUpdates().then((result) => {
            setUpdate(result);
            setConfirmInstall(false);
            const statusKind = classifyUpdateResult(result);
            const text = statusKind === "not-configured"
              ? t("updates.notConfigured")
              : statusKind === "missing-artifact"
                ? t("updates.noArtifact")
                : statusKind === "available"
                  ? t("updates.available", { version: result.latestVersion })
                  : t("updates.current");
            setStatus({ text });
          }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("updates.check")}</button>
          {update?.updateAvailable &&
          update.artifact?.kind === "installer" &&
          update.artifact.publisherSubject ? (
            <button
              className="btn btn-sm"
              type="button"
              disabled={installing}
              onClick={() => setConfirmInstall(true)}
            >
              {t("updates.install")}
            </button>
          ) : update?.updateAvailable && update.artifact?.url ? (
            <a
              className="btn btn-sm"
              href={update.artifact.url}
              target="_blank"
              rel="noreferrer"
            >
              {t(update.artifact.kind === "installer"
                ? "updates.downloadInstaller"
                : "updates.downloadArchive")}
            </a>
          ) : null}
        </div>
        {confirmInstall && update?.artifact?.publisherSubject ? (
          <div className="settings-update-confirmation" role="alert">
            <p>{t("updates.installConfirmation", { version: update.latestVersion })}</p>
            <dl>
              <dt>{t("updates.publisher")}</dt>
              <dd>{update.artifact.publisherSubject}</dd>
            </dl>
            <div className="settings-actions">
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={installing}
                onClick={() => void install()}
              >
                {installing ? t("updates.preparingInstaller") : t("updates.confirmInstall")}
              </button>
              <button
                className="btn btn-sm"
                type="button"
                disabled={installing}
                onClick={() => setConfirmInstall(false)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : null}
        {update?.releaseNotes ? <pre className="mt-3 overflow-auto rounded-lg border border-base-300 bg-base-200 p-3 text-xs whitespace-pre-wrap">{update.releaseNotes}</pre> : null}
        <Status value={status} />
      </Card>
    </div>
  );
}

function AboutPage() {
  const { t } = useTranslation();
  return (
    <div className="settings-page">
      <PageHeading title={t("about.title")} />
      <Card title={t("app.title")}>
        <div className="settings-about-copy">
          <p>{t("about.author")}</p>
          <p>{t("about.privacy")}</p>
          <p>{t("about.disclaimer")}</p>
          <p>{t("about.free")}</p>
          <p>{t("about.contact")}</p>
        </div>
      </Card>
    </div>
  );
}

export function SettingsApp() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageId>("general");
  const [visitedPages, setVisitedPages] = useState<Set<PageId>>(() => new Set(["general"]));
  const initialSettings = useMemo(() => readStored("wordollama-general-settings", { darkTheme: false }), []);
  const [darkTheme, setDarkTheme] = useState(Boolean(initialSettings.darkTheme));
  const registrations = useRef(new Map<string, SettingsSaveRegistration>());
  const [saveRevision, setSaveRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [footerStatus, setFooterStatus] = useState<StatusState>(null);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);

  const register = useCallback((id: string, save: () => Promise<void>) => {
    const current = registrations.current.get(id);
    registrations.current.set(id, { dirty: current?.dirty ?? false, save });
    setSaveRevision((value) => value + 1);
    return () => {
      registrations.current.delete(id);
      setSaveRevision((value) => value + 1);
    };
  }, []);

  const setDirty = useCallback((id: string, dirty: boolean) => {
    const current = registrations.current.get(id);
    if (!current || current.dirty === dirty) return;
    registrations.current.set(id, { ...current, dirty });
    setSaveRevision((value) => value + 1);
  }, []);

  const saveContext = useMemo<SettingsSaveContextValue>(
    () => ({ register, setDirty }),
    [register, setDirty],
  );

  const hasUnsavedChanges = useMemo(
    () => Array.from(registrations.current.values()).some((entry) => entry.dirty),
    [saveRevision],
  );

  const saveAll = async (): Promise<boolean> => {
    setSaving(true);
    setFooterStatus(null);
    try {
      for (const entry of registrations.current.values()) {
        if (!entry.dirty) continue;
        await entry.save();
        entry.dirty = false;
      }
      setSaveRevision((value) => value + 1);
      setFooterStatus({ text: t("common.allSaved") });
      return true;
    } catch (error) {
      setFooterStatus(toStatus(error, t("common.saveFailed")));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const navigateTo = (nextPage: PageId) => {
    setVisitedPages((current) => {
      if (current.has(nextPage)) return current;
      const next = new Set(current);
      next.add(nextPage);
      return next;
    });
    setPage(nextPage);
  };

  const requestClose = () => {
    if (hasUnsavedChanges) {
      setCloseConfirmationOpen(true);
      return;
    }
    closeSettingsWindow();
  };

  const saveAndClose = async () => {
    if (await saveAll()) closeSettingsWindow();
  };

  useEffect(() => {
    document.documentElement.dataset.theme = darkTheme ? "wordollama-dark" : "wordollama";
  }, [darkTheme]);

  useEffect(() => {
    if (!runtime.hasPairing()) {
      void runtime.autoPair().catch(() => undefined);
    }
  }, []);

  const groups: Array<{ label: string; items: Array<{ id: PageId; icon: typeof House }> }> = [
    { label: t("nav.preferences"), items: [
      { id: "general", icon: House }, { id: "models", icon: Bot },
      { id: "agent", icon: Sparkles }, { id: "markdown", icon: FileCode2 },
    ] },
    { label: t("nav.extensions"), items: [
      { id: "skills", icon: Boxes }, { id: "mcp", icon: Network },
      { id: "advanced", icon: SlidersHorizontal },
    ] },
    { label: t("nav.system"), items: [
      { id: "updates", icon: RefreshCw }, { id: "about", icon: Info },
    ] },
  ];

  return (
    <SettingsSaveContext.Provider value={saveContext}>
      <div className="settings-app" data-theme={darkTheme ? "wordollama-dark" : "wordollama"}>
        <header className="settings-header">
          <div className="flex items-center gap-3">
            <span className="settings-brand-mark" aria-hidden="true">W</span>
            <div>
              <strong className="block text-sm">{t("app.title")}</strong>
              <span className="block text-[10px] opacity-55">{t("app.settings")}</span>
            </div>
          </div>
        </header>
        <aside className="settings-sidebar" aria-label={t("app.settings")}>
          {groups.map((group) => (
            <div key={group.label}>
              <p className="settings-nav-group">{group.label}</p>
              <div className="grid gap-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className={`btn btn-ghost btn-sm${page === item.id ? " settings-nav-active" : ""}`}
                      type="button"
                      onClick={() => navigateTo(item.id)}
                    >
                      <Icon size={15} />
                      {t(`nav.${item.id}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>
        <main className="settings-content">
          {visitedPages.has("general") ? <section hidden={page !== "general"}><GeneralPage onThemeChange={setDarkTheme} /></section> : null}
          {visitedPages.has("models") ? <section hidden={page !== "models"}><ModelsPage /></section> : null}
          {visitedPages.has("agent") ? <section hidden={page !== "agent"}><AgentPage /></section> : null}
          {visitedPages.has("markdown") ? <section hidden={page !== "markdown"}><MarkdownPage /></section> : null}
          {visitedPages.has("skills") ? <section hidden={page !== "skills"}><SkillsPage /></section> : null}
          {visitedPages.has("mcp") ? <section hidden={page !== "mcp"}><McpPage /></section> : null}
          {visitedPages.has("advanced") ? <section hidden={page !== "advanced"}><AdvancedPage /></section> : null}
          {visitedPages.has("updates") ? <section hidden={page !== "updates"}><UpdatesPage /></section> : null}
          {visitedPages.has("about") ? <section hidden={page !== "about"}><AboutPage /></section> : null}
        </main>
        <footer className="settings-footer">
          <div className="settings-footer-actions">
            <button className="btn btn-primary btn-sm" type="button" disabled={!hasUnsavedChanges || saving} onClick={() => void saveAll()}>
              {saving ? <span className="loading loading-spinner loading-xs" /> : null}
              {saving ? t("common.saving") : t("common.save")}
            </button>
            <button className="btn btn-sm" type="button" disabled={saving} onClick={requestClose}>
              {t("common.close")}
            </button>
          </div>
          <Status value={footerStatus} />
        </footer>

        {closeConfirmationOpen ? (
          <dialog className="modal modal-open" open onCancel={() => setCloseConfirmationOpen(false)}>
            <div className="modal-box settings-confirm-modal">
              <h2>{t("common.unsavedTitle")}</h2>
              <p>{t("common.unsavedMessage")}</p>
              <div className="modal-action settings-unsaved-actions">
                <button className="btn btn-primary btn-sm" type="button" disabled={saving} onClick={() => void saveAndClose()}>
                  {saving ? <span className="loading loading-spinner loading-xs" /> : null}
                  {t("common.saveAndClose")}
                </button>
                <button className="btn btn-sm" type="button" disabled={saving} onClick={closeSettingsWindow}>
                  {t("common.discardChanges")}
                </button>
                <button className="btn btn-ghost btn-sm" type="button" disabled={saving} onClick={() => setCloseConfirmationOpen(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
            <form method="dialog" className="modal-backdrop" onSubmit={() => setCloseConfirmationOpen(false)}>
              <button aria-label={t("common.close")}>{t("common.close")}</button>
            </form>
          </dialog>
        ) : null}
      </div>
    </SettingsSaveContext.Provider>
  );
}
