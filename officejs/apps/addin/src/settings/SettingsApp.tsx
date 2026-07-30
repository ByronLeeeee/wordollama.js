import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Boxes,
  FileCode2,
  FolderOpen,
  House,
  Info,
  Languages,
  Network,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Upload,
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
import {
  readUiLocalePreference,
  setUiLocalePreference,
  type UiLocalePreference,
} from "./i18n";
import {
  adoptPairingInTaskPane,
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
    <section className={`settings-card${wide ? " settings-card-wide" : ""}`}>
      <header className="settings-card-header">
        <h2 className="settings-card-title">{title}</h2>
        {actions}
      </header>
      <div className="settings-card-body">{children}</div>
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

  const update = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    if (key === "darkTheme") onThemeChange(Boolean(value));
  };

  const save = async () => {
    writeStored("wordollama-general-settings", settings);
    await setUiLocalePreference(preference);
    runtime.setOutputLanguage(settings.language);
    setStatus({ text: t("common.saved") });
  };

  return (
    <div className="settings-page">
      <PageHeading title={t("general.title")} />
      <div className="settings-grid">
        <Card title={t("general.appearance")}>
          <div className="settings-form-grid">
            <label htmlFor="ui-language">{t("general.uiLanguage")}</label>
            <select
              id="ui-language"
              className="select select-bordered select-sm"
              value={preference}
              onChange={(event) => {
                const value = event.currentTarget.value as UiLocalePreference;
                setPreference(value);
                void setUiLocalePreference(value);
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
              className="select select-bordered select-sm"
              value={settings.aiMode}
              onChange={(event) => update("aiMode", event.currentTarget.value)}
            >
              <option value="ollama">{t("general.localMode")}</option>
              <option value="online">{t("general.onlineMode")}</option>
            </select>
            <label htmlFor="output-language">{t("general.outputLanguage")}</label>
            <select
              id="output-language"
              className="select select-bordered select-sm"
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
              className="select select-bordered select-sm"
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
          <div className="settings-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={() => void save()}>
              {t("general.save")}
            </button>
          </div>
          <Status value={status} />
        </Card>
      </div>
    </div>
  );
}

const emptyProvider: ProviderProfileUpdate = {
  id: "",
  name: "",
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

function providerToUpdate(profile: ProviderProfileView): ProviderProfileUpdate {
  return { ...profile, apiKey: undefined, clearApiKey: false };
}

function ModelsPage() {
  const { t, i18n } = useTranslation();
  const [profiles, setProfiles] = useState<ProviderProfileView[]>([]);
  const [activeId, setActiveId] = useState("");
  const [form, setForm] = useState<ProviderProfileUpdate>(emptyProvider);
  const [models, setModels] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [modelName, setModelName] = useState("");
  const [pullProgress, setPullProgress] = useState<number | null>(null);
  const [oauth, setOauth] = useState({ clientId: "", clientSecret: "", quotaProject: "" });
  const [status, setStatus] = useState<StatusState>(null);
  const [testResult, setTestResult] = useState("");

  const load = async () => {
    try {
      const view = await runtime.getProviderSettings();
      setProfiles(view.profiles);
      setActiveId(view.activeProviderId);
      const selected = view.profiles.find((item) => item.id === form.id) ?? view.profiles[0];
      if (selected) setForm(providerToUpdate(selected));
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
    const selected = view.profiles.find((item) => item.id === form.id);
    if (selected) setForm(providerToUpdate(selected));
  };

  const refreshModels = async () => {
    const result = await runtime.listProviderModels();
    setModels(result.models);
  };

  const pullModel = async () => {
    if (!modelName.trim()) return;
    setPullProgress(0);
    try {
      for await (const progress of runtime.pullOllamaModel(modelName.trim())) {
        setStatus({
          text: progress.status === "pulling" ? t("models.pulling") : progress.status,
        });
        if (progress.total && progress.completed !== undefined) {
          setPullProgress(Math.min(100, Math.round(progress.completed / progress.total * 100)));
        }
      }
      setPullProgress(100);
      await refreshModels();
    } catch (error) {
      setStatus(toStatus(error, t("common.notConnected")));
    }
  };

  const isGoogleProvider = /^(gemini|google)$/iu.test(form.type.trim());

  return (
    <div className="settings-page">
      <PageHeading title={t("models.title")} />
      <div className="settings-master-detail">
        <div className="settings-master-column">
          <Card
            title={t("models.profiles")}
            actions={<button className="btn btn-ghost btn-xs" onClick={() => setForm(emptyProvider)}><Plus size={14} />{t("common.add")}</button>}
          >
            <div className={profiles.length ? "settings-list" : "settings-list-empty"}>
              {profiles.length ? profiles.map((profile) => (
                <button
                  key={profile.id}
                  className={`settings-list-button${form.id === profile.id ? " active" : ""}`}
                  type="button"
                  onClick={() => setForm(providerToUpdate(profile))}
                >
                  <strong>{profile.name || profile.id}</strong>
                  <small>{profile.type} · {profile.model || t("common.none")}{profile.id === activeId ? " · ✓" : ""}</small>
                </button>
              )) : t("models.emptyProfiles")}
            </div>
          </Card>
          <Card
            title={t("models.models")}
            actions={<button className="btn btn-ghost btn-xs" onClick={() => void refreshModels().catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}><RefreshCw size={14} />{t("common.refresh")}</button>}
          >
            <div className={models.length ? "settings-list" : "settings-list-empty"}>
              {models.length ? models.map((model) => (
                <div className="settings-list-button flex items-center justify-between gap-3" key={model}>
                  <span className="min-w-0 truncate">{model}</span>
                  {form.type.toLowerCase() === "ollama" ? (
                    <span className="flex shrink-0 gap-1">
                      <button className="btn btn-ghost btn-xs" type="button" onClick={() => void runtime.loadOllamaModel(model).then(() => setStatus({ text: t("models.modelLoaded", { model }) })).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("models.loadModel")}</button>
                      <button className="btn btn-ghost btn-xs text-error" type="button" onClick={() => void runtime.deleteOllamaModel(model).then(refreshModels).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("common.delete")}</button>
                    </span>
                  ) : null}
                </div>
              )) : t("models.emptyModels")}
            </div>
            {form.type.toLowerCase() === "ollama" ? (
              <div className="mt-3">
                <div className="settings-import">
                  <input className="input input-bordered input-sm" value={modelName} onChange={(event) => setModelName(event.currentTarget.value)} placeholder={t("models.modelName")} />
                  <button className="btn btn-primary btn-sm" type="button" disabled={!modelName.trim()} onClick={() => void pullModel()}>{t("models.downloadModel")}</button>
                </div>
                {pullProgress !== null ? <progress className="progress progress-primary mt-3 w-full" max="100" value={pullProgress} /> : null}
              </div>
            ) : null}
          </Card>
          <Card title={t("models.connectionTest")}>
            <textarea className="textarea textarea-bordered textarea-sm" value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} placeholder={t("models.prompt")} />
            <div className="settings-actions">
              <button className="btn btn-sm" type="button" onClick={() => void runtime.chat([{ role: "user", content: prompt }], form.model || undefined).then((result) => setTestResult(result.content)).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("models.sendTest")}</button>
            </div>
            {testResult ? <pre className="mt-3 overflow-auto rounded-lg border border-base-300 bg-base-200 p-3 text-xs whitespace-pre-wrap">{testResult}</pre> : null}
          </Card>
        </div>
        <Card title={t("models.profile")}>
          <div className="settings-form-grid">
            <label htmlFor="provider-id-react">{t("models.id")}</label>
            <input id="provider-id-react" className="input input-bordered input-sm" value={form.id} onChange={(event) => patch("id", event.currentTarget.value)} />
            <label htmlFor="provider-name-react">{t("models.name")}</label>
            <input id="provider-name-react" className="input input-bordered input-sm" value={form.name} onChange={(event) => patch("name", event.currentTarget.value)} />
            <label htmlFor="provider-type-react">{t("models.type")}</label>
            <select id="provider-type-react" className="select select-bordered select-sm" value={form.type} onChange={(event) => patch("type", event.currentTarget.value)}>
              {["Ollama", "OpenAI", "Claude", "Gemini", "LMStudio", "vLLM"].map((type) => <option key={type}>{type}</option>)}
            </select>
            <label htmlFor="provider-endpoint-react">{t("models.endpoint")}</label>
            <input id="provider-endpoint-react" className="input input-bordered input-sm" type="url" value={form.endpoint} onChange={(event) => patch("endpoint", event.currentTarget.value)} />
            <label htmlFor="provider-model-react">{t("models.model")}</label>
            <input id="provider-model-react" className="input input-bordered input-sm" value={form.model} onChange={(event) => patch("model", event.currentTarget.value)} />
            <label htmlFor="provider-key-react">{t("models.apiKey")}</label>
            <input id="provider-key-react" className="input input-bordered input-sm" type="password" value={form.apiKey ?? ""} onChange={(event) => patch("apiKey", event.currentTarget.value)} placeholder={t("models.apiKeyHint")} />
            <div className="settings-row-wide settings-switch-list">
              <SwitchRow label={t("models.clearKey")} checked={Boolean(form.clearApiKey)} onChange={(value) => patch("clearApiKey", value)} />
            </div>
            <details className="settings-advanced">
              <summary>{t("models.generation")}</summary>
              <div className="settings-form-grid">
                <label>{t("models.toolMode")}</label>
                <select className="select select-bordered select-sm" value={form.toolCallingMode} onChange={(event) => patch("toolCallingMode", event.currentTarget.value)}>
                  {["Auto", "Native", "ReAct"].map((mode) => <option key={mode}>{mode}</option>)}
                </select>
                <label>{t("models.contextWindow")}</label>
                <input className="input input-bordered input-sm" type="number" value={form.contextWindow} onChange={(event) => patch("contextWindow", Number(event.currentTarget.value))} />
                <label>{t("models.keepAlive")}</label>
                <input className="input input-bordered input-sm" value={form.keepAlive} onChange={(event) => patch("keepAlive", event.currentTarget.value)} />
                <label>{t("models.maxTokens")}</label>
                <input className="input input-bordered input-sm" type="number" value={form.maxTokens} onChange={(event) => patch("maxTokens", Number(event.currentTarget.value))} />
                <label>{t("models.temperature")}</label>
                <input className="range range-primary range-xs" type="range" min="0" max="2" step="0.1" value={form.temperature} onChange={(event) => patch("temperature", Number(event.currentTarget.value))} />
                <div className="settings-row-wide settings-switch-list">
                  <SwitchRow label={t("models.streaming")} checked={form.supportsStreaming} onChange={(value) => patch("supportsStreaming", value)} />
                  <SwitchRow label={t("models.vision")} checked={form.supportsVision} onChange={(value) => patch("supportsVision", value)} />
                  <SwitchRow label={t("models.json")} checked={form.supportsJsonOutput} onChange={(value) => patch("supportsJsonOutput", value)} />
                </div>
              </div>
            </details>
            {isGoogleProvider ? (
              <details className="settings-advanced">
                <summary>{t("models.oauth")}</summary>
                <div className="settings-form-grid">
                  <label>{t("models.oauthClientId")}</label>
                  <input className="input input-bordered input-sm" value={oauth.clientId} onChange={(event) => setOauth((current) => ({ ...current, clientId: event.currentTarget.value }))} />
                  <label>{t("models.oauthClientSecret")}</label>
                  <input className="input input-bordered input-sm" type="password" value={oauth.clientSecret} onChange={(event) => setOauth((current) => ({ ...current, clientSecret: event.currentTarget.value }))} />
                  <label>{t("models.googleProject")}</label>
                  <input className="input input-bordered input-sm" value={oauth.quotaProject} onChange={(event) => setOauth((current) => ({ ...current, quotaProject: event.currentTarget.value }))} />
                  <div className="settings-row-wide">
                    <button
                      className="btn btn-sm"
                      type="button"
                      disabled={!form.id || !oauth.clientId.trim()}
                      onClick={() => void runtime.authorizeGoogleProvider(form.id, {
                        clientId: oauth.clientId.trim(),
                        clientSecret: oauth.clientSecret.trim() || undefined,
                        quotaProject: oauth.quotaProject.trim() || undefined,
                        uiLocale: i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en-US",
                      }).then((result) => {
                        applyView(result.providerSettings);
                        setOauth((current) => ({ ...current, clientSecret: "" }));
                        setStatus({ text: result.hasRefreshToken ? t("models.oauthSuccess") : t("models.oauthSuccessNoRefresh") });
                      }).catch((error) => setStatus(toStatus(error, t("models.oauthFailed"))))}
                    >
                      {t("models.oauthLogin")}
                    </button>
                  </div>
                </div>
              </details>
            ) : null}
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={() => void runtime.saveProviderProfile(form).then((view) => { applyView(view); setStatus({ text: t("common.saved") }); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("models.save")}</button>
            <button className="btn btn-sm" type="button" onClick={() => void runtime.testProvider(form).then((result) => { setModels(result.models); setStatus({ text: `${result.provider}: ${result.models.length}` }); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("common.test")}</button>
            <button className="btn btn-sm" type="button" disabled={!form.id} onClick={() => void runtime.activateProvider(form.id).then(applyView).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("models.activate")}</button>
            <button className="btn btn-ghost btn-sm text-error" type="button" disabled={!form.id} onClick={() => void runtime.deleteProvider(form.id).then((view) => { applyView(view); setForm(emptyProvider); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("common.delete")}</button>
          </div>
          <Status value={status} />
        </Card>
      </div>
    </div>
  );
}

function SkillsPage() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<StatusState>(null);

  const load = async () => {
    try {
      setSkills(await runtime.listSkills());
      setStatus(null);
    } catch (error) {
      setStatus(toStatus(error, t("common.notConnected")));
    }
  };
  useEffect(() => { void load(); }, []);

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
          <input className="file-input file-input-bordered file-input-sm" type="file" accept=".zip,application/zip" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
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
            <div className="settings-list-button flex items-center justify-between gap-4" key={skill.name} title={skill.description}>
              <strong>{skill.name}</strong>
              <button className="btn btn-ghost btn-xs text-error" type="button" onClick={() => void runtime.deleteSkill(skill.name).then(load).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("common.delete")}</button>
            </div>
          )) : t("skills.empty")}
        </div>
        <Status value={status} />
      </Card>
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
  };

  const payload = (): McpServerUpdate => ({
    ...form,
    arguments: parseLines(argsText),
    environment: parsePairs(environmentText),
    headers: parsePairs(headersText),
  });

  return (
    <div className="settings-page">
      <PageHeading title={t("mcp.title")} />
      <div className="settings-master-detail">
        <div className="settings-master-column">
          <Card
            title={t("mcp.servers")}
            actions={<button className="btn btn-ghost btn-xs" type="button" onClick={() => { setForm(emptyMcp); setTools([]); }}><Plus size={14} />{t("common.add")}</button>}
          >
            <div className={servers.length ? "settings-list" : "settings-list-empty"}>
              {servers.length ? servers.map((server) => (
                <button className={`settings-list-button${form.name === server.name ? " active" : ""}`} key={server.name} type="button" onClick={() => void select(server)}>
                  <strong>{server.name}</strong>
                  <small>{server.transport} · {server.connected ? t("common.connect") : t("common.disconnect")} · {server.toolCount}</small>
                </button>
              )) : t("mcp.emptyServers")}
            </div>
          </Card>
          <Card title={t("mcp.permissions")}>
            <div className={tools.length ? "settings-switch-list" : "settings-list-empty"}>
              {tools.length ? tools.map((tool) => (
                <SwitchRow key={tool.name} label={tool.name} title={tool.description} checked={permissions[tool.name] ?? false} onChange={(value) => setPermissions((current) => ({ ...current, [tool.name]: value }))} />
              )) : t("mcp.emptyTools")}
            </div>
            <div className="settings-actions">
              <button className="btn btn-primary btn-sm" type="button" disabled={!form.name || !tools.length} onClick={() => void runtime.saveMcpPermissions(form.name, permissions).then(() => setStatus({ text: t("common.saved") })).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("mcp.savePermissions")}</button>
            </div>
          </Card>
        </div>
        <Card title={t("mcp.configuration")}>
          <div className="settings-form-grid">
            <label htmlFor="mcp-name-react">{t("mcp.name")}</label>
            <input id="mcp-name-react" className="input input-bordered input-sm" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.currentTarget.value }))} />
            <label>{t("mcp.transport")}</label>
            <select className="select select-bordered select-sm" value={form.transport} onChange={(event) => setForm((current) => ({ ...current, transport: event.currentTarget.value }))}>
              {["stdio", "streamable-http", "sse"].map((transport) => <option key={transport}>{transport}</option>)}
            </select>
            <label>{t("mcp.command")}</label>
            <input className="input input-bordered input-sm" value={form.command} onChange={(event) => setForm((current) => ({ ...current, command: event.currentTarget.value }))} />
            <label>{t("mcp.arguments")}</label>
            <textarea className="textarea textarea-bordered textarea-sm" rows={3} value={argsText} onChange={(event) => setArgsText(event.currentTarget.value)} placeholder={t("mcp.onePerLine")} />
            <details className="settings-advanced">
              <summary>{t("common.advanced")}</summary>
              <div className="settings-form-grid">
                <label>{t("mcp.workingDirectory")}</label>
                <input className="input input-bordered input-sm" value={form.workingDirectory ?? ""} onChange={(event) => setForm((current) => ({ ...current, workingDirectory: event.currentTarget.value }))} />
                <label>{t("mcp.environment")}</label>
                <textarea className="textarea textarea-bordered textarea-sm" rows={3} value={environmentText} onChange={(event) => setEnvironmentText(event.currentTarget.value)} placeholder={t("mcp.keyValuePerLine")} />
                <label>{t("mcp.headers")}</label>
                <textarea className="textarea textarea-bordered textarea-sm" rows={3} value={headersText} onChange={(event) => setHeadersText(event.currentTarget.value)} placeholder={t("mcp.keyValuePerLine")} />
              </div>
            </details>
            <div className="settings-row-wide settings-switch-list">
              <SwitchRow label={t("mcp.autoConnect")} checked={form.enabled} onChange={(value) => setForm((current) => ({ ...current, enabled: value }))} />
              <SwitchRow label={t("mcp.trustAll")} checked={form.trusted} onChange={(value) => setForm((current) => ({ ...current, trusted: value }))} />
            </div>
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={() => void runtime.saveMcpServer(payload()).then(async (result) => { setTools(result.tools); await load(); setStatus({ text: t("common.saved") }); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("mcp.saveConnect")}</button>
            <button className="btn btn-sm" type="button" disabled={!form.name} onClick={() => void runtime.connectMcpServer(form.name).then((result) => { setTools(result.tools); void load(); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("common.connect")}</button>
            <button className="btn btn-sm" type="button" disabled={!form.name} onClick={() => void runtime.checkMcpHealth(form.name).then((health) => setStatus({ text: `${health.connected ? "✓" : "×"} · ${health.toolCount}` })).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("mcp.health")}</button>
            <button className="btn btn-sm" type="button" disabled={!form.name} onClick={() => void runtime.disconnectMcpServer(form.name).then(load).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("common.disconnect")}</button>
            <button className="btn btn-ghost btn-sm text-error" type="button" disabled={!form.name} onClick={() => void runtime.deleteMcpServer(form.name).then(() => { setForm(emptyMcp); return load(); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("common.delete")}</button>
          </div>
          <Status value={status} />
        </Card>
      </div>
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
  return (
    <div className="settings-page">
      <PageHeading title={t("agent.title")} />
      <div className="settings-grid">
        <Card title={t("agent.execution")}>
          <div className="settings-form-grid">
            <label>{t("agent.iterations")}</label>
            <input className="input input-bordered input-sm" type="number" min={1} value={agent.iterations} onChange={(event) => setAgent({ ...agent, iterations: Number(event.currentTarget.value) })} />
            <label>{t("agent.mode")}</label>
            <select className="select select-bordered select-sm" value={agent.mode} onChange={(event) => setAgent({ ...agent, mode: event.currentTarget.value })}>
              <option value="ViewOnly">{t("agent.viewOnly")}</option>
              <option value="ProposeChanges">{t("agent.propose")}</option>
              <option value="TrackedChanges">{t("agent.tracked")}</option>
            </select>
            <div className="settings-row-wide settings-switch-list">
              <SwitchRow label={t("agent.unlimited")} checked={agent.unlimited} onChange={(value) => setAgent({ ...agent, unlimited: value })} />
              <SwitchRow label={t("agent.externalTools")} checked={agent.externalTools} onChange={(value) => setAgent({ ...agent, externalTools: value })} />
            </div>
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary btn-sm" onClick={() => { writeStored("wordollama-agent-settings", agent); setStatus({ text: t("common.saved") }); }}>{t("agent.saveExecution")}</button>
          </div>
        </Card>
        <Card title={t("agent.review")}>
          <div className="settings-switch-list">
            <SwitchRow label={t("agent.enableReview")} checked={review.enabled} onChange={(value) => setReview({ ...review, enabled: value })} />
          </div>
          <div className="settings-form-grid mt-4">
            <label>{t("agent.reviewModel")}</label>
            <input className="input input-bordered input-sm" value={review.model} onChange={(event) => setReview({ ...review, model: event.currentTarget.value })} />
            <label>{t("agent.reviewInterval")}</label>
            <input className="input input-bordered input-sm" type="number" min={3} value={review.intervalSeconds} onChange={(event) => setReview({ ...review, intervalSeconds: Number(event.currentTarget.value) })} />
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary btn-sm" onClick={() => { writeStored("wordollama-linter-settings", review); setStatus({ text: t("common.saved") }); }}>{t("agent.saveReview")}</button>
          </div>
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
  const [newStyle, setNewStyle] = useState("");
  const [settings, setSettings] = useState(() =>
    readStored<MarkdownSettings>(
      "wordollama-markdown-settings",
      DEFAULT_MARKDOWN_SETTINGS,
    ));
  const patch = (key: keyof typeof settings, value: string | boolean) => setSettings((current) => ({ ...current, [key]: value }));
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
        <Card title={t("markdown.styles")}>
          <datalist id="react-word-style-options">
            {wordStyles.map((style) => <option key={style} value={style} />)}
          </datalist>
          <div className="settings-form-grid">
            {([
              ["h1", "heading1"], ["h2", "heading2"], ["h3", "heading3"],
              ["paragraph", "paragraph"], ["codeStyle", "codeStyle"],
              ["blockquote", "blockquote"],
              ["unorderedList", "unorderedList"],
              ["orderedList", "orderedList"],
            ] as const).map(([key, label]) => (
              <Fragment key={key}>
                <label>{t(`markdown.${label}`)}</label>
                <input list="react-word-style-options" className="input input-bordered input-sm" value={settings[key]} onChange={(event) => patch(key, event.currentTarget.value)} />
              </Fragment>
            ))}
          </div>
          <div className="settings-actions">
            <button className="btn btn-sm" type="button" onClick={() => void listWordStyles().then((styles) => { setWordStyles(styles); setStatus({ text: `${styles.length}` }); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("markdown.refreshStyles")}</button>
          </div>
          <div className="settings-import mt-3">
            <input className="input input-bordered input-sm" value={newStyle} onChange={(event) => setNewStyle(event.currentTarget.value)} placeholder={t("markdown.newStyle")} />
            <button className="btn btn-sm" type="button" disabled={!newStyle.trim()} onClick={() => void createWordParagraphStyle(newStyle.trim()).then(async () => { setWordStyles(await listWordStyles()); setNewStyle(""); setStatus({ text: t("common.saved") }); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("markdown.createStyle")}</button>
          </div>
        </Card>
        <Card title={t("markdown.title")} wide>
          <div className="settings-actions mt-0">
            <button className="btn btn-primary btn-sm" onClick={() => { writeStored("wordollama-markdown-settings", settings); setStatus({ text: t("common.saved") }); }}>{t("markdown.save")}</button>
          </div>
          <Status value={status} />
        </Card>
      </div>
    </div>
  );
}

function AdvancedPage() {
  const { t } = useTranslation();
  const [pairingCode, setPairingCode] = useState("");
  const [status, setStatus] = useState<StatusState>(null);
  const [ollama, setOllama] = useState<OllamaServerSettingsUpdate>({
    modelsPath: "", host: "127.0.0.1:11434", keepAlive: "5m",
    contextLength: 0, maxLoadedModels: 0, numParallel: 0, maxQueue: 0,
  });
  const loadOllama = async () => {
    try {
      const value = await runtime.getOllamaServerSettings();
      setOllama(value);
    } catch (error) {
      setStatus(toStatus(error, t("common.notConnected")));
    }
  };
  const patch = <K extends keyof OllamaServerSettingsUpdate>(key: K, value: OllamaServerSettingsUpdate[K]) =>
    setOllama((current) => ({ ...current, [key]: value }));
  const pairBridge = async () => {
    try {
      const pairing = await runtime.pair(pairingCode);
      if (typeof Office !== "undefined") {
        await adoptPairingInTaskPane(pairing);
      }
      setStatus({ text: t("common.saved") });
    } catch (error) {
      setStatus(toStatus(error, t("common.notConnected")));
    }
  };
  return (
    <div className="settings-page">
      <PageHeading title={t("advanced.title")} />
      <div className="settings-grid">
        <Card title={t("advanced.bridge")}>
          <div className="settings-form-grid">
            <label>{t("advanced.pairingCode")}</label>
            <input className="input input-bordered input-sm" value={pairingCode} onChange={(event) => setPairingCode(event.currentTarget.value)} />
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void pairBridge()}>{t("advanced.pair")}</button>
            <button className="btn btn-sm" onClick={() => void runtime.health().then((health) => setStatus({ text: `${health.bridgeVersion} · ${health.protocolVersion} · ${health.ready ? "✓" : "×"}` })).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("advanced.checkBridge")}</button>
          </div>
        </Card>
        <Card title={t("advanced.ollama")}>
          <div className="alert alert-warning mb-4 text-xs">{t("advanced.networkWarning")}</div>
          <div className="settings-form-grid">
            <label>{t("advanced.modelsPath")}</label>
            <input className="input input-bordered input-sm" value={ollama.modelsPath} onChange={(event) => patch("modelsPath", event.currentTarget.value)} />
            <label>{t("advanced.host")}</label>
            <input className="input input-bordered input-sm" value={ollama.host} onChange={(event) => patch("host", event.currentTarget.value)} />
            <label>{t("advanced.keepAlive")}</label>
            <input className="input input-bordered input-sm" value={ollama.keepAlive} onChange={(event) => patch("keepAlive", event.currentTarget.value)} />
            {([
              ["contextLength", "contextLength"], ["maxLoadedModels", "maxLoaded"],
              ["numParallel", "parallel"], ["maxQueue", "maxQueue"],
            ] as const).map(([key, label]) => (
              <>
                <label key={`${key}-label`}>{t(`advanced.${label}`)}</label>
                <input key={key} className="input input-bordered input-sm" type="number" value={ollama[key]} onChange={(event) => patch(key, Number(event.currentTarget.value))} />
              </>
            ))}
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void runtime.saveOllamaServerSettings(ollama).then((value) => { setOllama(value); setStatus({ text: t("common.saved") }); }).catch((error) => setStatus(toStatus(error, t("common.notConnected"))))}>{t("advanced.saveOllama")}</button>
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
  const initialSettings = useMemo(() => readStored("wordollama-general-settings", { darkTheme: false }), []);
  const [darkTheme, setDarkTheme] = useState(Boolean(initialSettings.darkTheme));

  useEffect(() => {
    document.documentElement.dataset.theme = darkTheme ? "wordollama-dark" : "wordollama";
  }, [darkTheme]);

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
    <div className="settings-app" data-theme={darkTheme ? "wordollama-dark" : "wordollama"}>
      <header className="settings-header">
        <div className="flex items-center gap-3">
          <span className="settings-brand-mark" aria-hidden="true">W</span>
          <div>
            <strong className="block text-sm">{t("app.title")}</strong>
            <span className="block text-[10px] opacity-55">{t("app.settings")}</span>
          </div>
        </div>
        <Languages size={17} className="opacity-45" aria-hidden="true" />
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
                    onClick={() => setPage(item.id)}
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
        {page === "general" ? <GeneralPage onThemeChange={setDarkTheme} /> : null}
        {page === "models" ? <ModelsPage /> : null}
        {page === "agent" ? <AgentPage /> : null}
        {page === "markdown" ? <MarkdownPage /> : null}
        {page === "skills" ? <SkillsPage /> : null}
        {page === "mcp" ? <McpPage /> : null}
        {page === "advanced" ? <AdvancedPage /> : null}
        {page === "updates" ? <UpdatesPage /> : null}
        {page === "about" ? <AboutPage /> : null}
      </main>
    </div>
  );
}
