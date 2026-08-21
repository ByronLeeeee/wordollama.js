import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  ClipboardCopy,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type {
  ProviderProfileUpdate,
  ProviderProfileView,
  UpdateCheckResult,
} from "../contracts";
import { RuntimeClient } from "../runtime-client";

export const SETUP_DISMISSED_KEY = "wordollama.setup.dismissed.v1";

type ReadinessState = "checking" | "ready" | "action" | "unavailable";

export type SetupReadiness = {
  checkedAt: string;
  bridge: ReadinessState;
  bridgeVersion?: string;
  pairing: ReadinessState;
  model: ReadinessState;
  modelName?: string;
  providerName?: string;
  updates: ReadinessState;
  updatesConfigured?: boolean;
  error?: string;
};

type QuickProviderPreset = {
  id: string;
  labelKey: string;
  name: string;
  type: string;
  endpoint: string;
  apiMode: string;
  needsApiKey: boolean;
};

const quickProviders: QuickProviderPreset[] = [
  { id: "ollama", labelKey: "models.providers.ollama", name: "Ollama", type: "Ollama", endpoint: "http://127.0.0.1:11434", apiMode: "Auto", needsApiKey: false },
  { id: "openai", labelKey: "models.providers.openai", name: "OpenAI", type: "OpenAI", endpoint: "https://api.openai.com/v1", apiMode: "Responses", needsApiKey: true },
  { id: "deepseek", labelKey: "models.providers.deepseek", name: "DeepSeek", type: "OpenAI", endpoint: "https://api.deepseek.com", apiMode: "ChatCompletions", needsApiKey: true },
  { id: "qwen", labelKey: "models.providers.qwen", name: "Qwen", type: "OpenAI", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiMode: "ChatCompletions", needsApiKey: true },
  { id: "zhipu", labelKey: "models.providers.zhipu", name: "Zhipu GLM", type: "OpenAI", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", apiMode: "ChatCompletions", needsApiKey: true },
  { id: "zhipu-coding", labelKey: "models.providers.zhipuCoding", name: "Zhipu GLM Coding Plan", type: "OpenAI", endpoint: "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions", apiMode: "ChatCompletions", needsApiKey: true },
  { id: "gemini", labelKey: "models.providers.gemini", name: "Gemini", type: "Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta", apiMode: "Auto", needsApiKey: true },
  { id: "custom", labelKey: "models.providers.custom", name: "OpenAI Compatible", type: "OpenAI", endpoint: "", apiMode: "Auto", needsApiKey: true },
];

const emptyReadiness = (): SetupReadiness => ({
  checkedAt: new Date().toISOString(),
  bridge: "checking",
  pairing: "checking",
  model: "checking",
  updates: "checking",
});

function activeProfile(profiles: ProviderProfileView[], activeId: string): ProviderProfileView | undefined {
  return profiles.find((profile) => profile.id === activeId && profile.model.trim());
}

export async function inspectSetup(runtime: RuntimeClient): Promise<SetupReadiness> {
  const result = emptyReadiness();
  try {
    const health = await runtime.health();
    result.bridge = health.ready ? "ready" : "unavailable";
    result.bridgeVersion = health.bridgeVersion;
    if (!health.ready) return { ...result, pairing: "unavailable", model: "unavailable", updates: "unavailable" };
  } catch (error) {
    return {
      ...result,
      bridge: "unavailable",
      pairing: "unavailable",
      model: "unavailable",
      updates: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    if (!runtime.hasPairing()) await runtime.autoPair();
    result.pairing = "ready";
  } catch (error) {
    return {
      ...result,
      pairing: "action",
      model: "unavailable",
      updates: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const [providerResult, updateResult] = await Promise.allSettled([
    runtime.getProviderSettings(),
    runtime.checkForUpdates(),
  ]);
  if (providerResult.status === "fulfilled") {
    const active = activeProfile(providerResult.value.profiles, providerResult.value.activeProviderId);
    result.model = active ? "ready" : "action";
    result.modelName = active?.model;
    result.providerName = active?.name;
  } else {
    result.model = "unavailable";
    result.error ??= providerResult.reason instanceof Error
      ? providerResult.reason.message
      : String(providerResult.reason);
  }
  if (updateResult.status === "fulfilled") {
    const update = updateResult.value as UpdateCheckResult;
    result.updatesConfigured = update.configured;
    result.updates = update.configured ? "ready" : "action";
  } else {
    result.updates = "unavailable";
  }
  return result;
}

function profileFromPreset(
  preset: QuickProviderPreset,
  profiles: ProviderProfileView[],
  apiKey: string,
  endpoint: string,
  model: string,
): ProviderProfileUpdate {
  const ids = new Set(profiles.map((profile) => profile.id.toLowerCase()));
  let id = preset.id;
  for (let suffix = 2; ids.has(id.toLowerCase()); suffix += 1) id = `${preset.id}-${suffix}`;
  const isOnlineNative = preset.type === "Gemini";
  return {
    id,
    name: preset.name,
    type: preset.type,
    endpoint: endpoint.trim(),
    model: model.trim(),
    apiKey: apiKey.trim() || undefined,
    clearApiKey: false,
    toolCallingMode: "Auto",
    supportsStreaming: true,
    supportsVision: isOnlineNative,
    supportsJsonOutput: preset.type === "OpenAI" || isOnlineNative,
    contextWindow: 0,
    temperature: 0.5,
    maxTokens: preset.type === "Ollama" ? 4096 : 8192,
    keepAlive: "5m",
    apiMode: preset.apiMode,
    reasoningEffort: "Auto",
    thinkingBudget: 4096,
  };
}

function ReadinessIcon({ state }: { state: ReadinessState }) {
  if (state === "checking") return <RefreshCw className="animate-spin" size={18} aria-hidden="true" />;
  if (state === "ready") return <CircleCheck size={18} aria-hidden="true" />;
  return <CircleAlert size={18} aria-hidden="true" />;
}

function ReadinessRow({
  state,
  title,
  detail,
}: {
  state: ReadinessState;
  title: string;
  detail: string;
}) {
  return (
    <li className={`setup-readiness-row setup-state-${state}`}>
      <ReadinessIcon state={state} />
      <span><strong>{title}</strong><small>{detail}</small></span>
    </li>
  );
}

export function SetupHealthCenter({
  runtime,
  onConfigureModel,
}: {
  runtime: RuntimeClient;
  onConfigureModel: () => void;
}) {
  const { t } = useTranslation();
  const [readiness, setReadiness] = useState<SetupReadiness>(emptyReadiness);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [reportText, setReportText] = useState("");

  const check = useCallback(async (repair = false) => {
    setReadiness(emptyReadiness());
    if (repair) {
      runtime.clearPairing();
      try { await runtime.autoPair(); } catch { /* inspectSetup reports the recovery path. */ }
    }
    setReadiness(await inspectSetup(runtime));
  }, [runtime]);

  useEffect(() => { void check(); }, [check]);

  const copyReport = async () => {
    const report = {
      product: "WordOllama.JS",
      checkedAt: readiness.checkedAt,
      addinOrigin: window.location.origin,
      bridge: { state: readiness.bridge, version: readiness.bridgeVersion },
      pairing: readiness.pairing,
      model: { state: readiness.model, provider: readiness.providerName, name: readiness.modelName },
      updates: { state: readiness.updates, configured: readiness.updatesConfigured },
      error: readiness.error,
    };
    const text = JSON.stringify(report, null, 2);
    setReportText(text);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section className="settings-card setup-health-center" aria-labelledby="setup-health-title">
      <div className="settings-card-header">
        <div>
          <h2 className="settings-card-title" id="setup-health-title">{t("setup.health.title")}</h2>
          <p className="setup-card-subtitle">{t("setup.health.description")}</p>
        </div>
        <ShieldCheck size={20} aria-hidden="true" />
      </div>
      <div className="settings-card-body">
        <ul className="setup-readiness-list">
          <ReadinessRow state={readiness.bridge} title={t("setup.checks.bridge")}
            detail={readiness.bridge === "ready" ? t("setup.checks.bridgeReady", { version: readiness.bridgeVersion }) : t("setup.checks.bridgeHelp")} />
          <ReadinessRow state={readiness.pairing} title={t("setup.checks.pairing")}
            detail={readiness.pairing === "ready" ? t("setup.checks.pairingReady") : t("setup.checks.pairingHelp")} />
          <ReadinessRow state={readiness.model} title={t("setup.checks.model")}
            detail={readiness.model === "ready" ? t("setup.checks.modelReady", { provider: readiness.providerName, model: readiness.modelName }) : t("setup.checks.modelHelp")} />
          <ReadinessRow state={readiness.updates} title={t("setup.checks.updates")}
            detail={readiness.updates === "ready" ? t("setup.checks.updatesReady") : t("setup.checks.updatesHelp")} />
        </ul>
        {readiness.error ? <details className="setup-error-details"><summary>{t("setup.health.technicalDetails")}</summary><code>{readiness.error}</code></details> : null}
        <div className="settings-actions setup-health-actions">
          <button className="btn btn-primary btn-sm" type="button" onClick={() => void check(true)} disabled={readiness.bridge === "checking"}>
            <Wrench size={15} />{t("setup.health.repair")}
          </button>
          {readiness.model !== "ready" ? <button className="btn btn-sm" type="button" onClick={onConfigureModel}>{t("setup.health.configureModel")}</button> : null}
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void copyReport()}>
            <ClipboardCopy size={15} />{copyState === "copied" ? t("setup.health.copied") : copyState === "failed" ? t("setup.health.copyFailed") : t("setup.health.copy")}
          </button>
        </div>
        {copyState === "failed" ? <div className="setup-copy-fallback"><label htmlFor="setup-diagnostic-report">{t("setup.health.copyFallback")}</label><textarea id="setup-diagnostic-report" className="textarea w-full" readOnly value={reportText} onFocus={(event) => event.currentTarget.select()} /></div> : null}
      </div>
    </section>
  );
}

export function SetupAssistantDialog({
  runtime,
  open,
  onClose,
  onComplete,
  onOpenModels,
}: {
  runtime: RuntimeClient;
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  onOpenModels: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [readiness, setReadiness] = useState<SetupReadiness>(emptyReadiness);
  const [profiles, setProfiles] = useState<ProviderProfileView[]>([]);
  const [providerId, setProviderId] = useState("ollama");
  const preset = useMemo(() => quickProviders.find((item) => item.id === providerId) ?? quickProviders[0], [providerId]);
  const [endpoint, setEndpoint] = useState(quickProviders[0].endpoint);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);

  const runInspection = useCallback(async () => {
    setReadiness(emptyReadiness());
    const next = await inspectSetup(runtime);
    setReadiness(next);
  }, [runtime]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError("");
    void runInspection();
  }, [open, runInspection]);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open, step]);

  const chooseProvider = (nextId: string) => {
    const next = quickProviders.find((item) => item.id === nextId) ?? quickProviders[0];
    setProviderId(next.id);
    setEndpoint(next.endpoint);
    setApiKey("");
    setModels([]);
    setModel("");
    setError("");
  };

  const loadModels = async () => {
    setBusy(true);
    setError("");
    try {
      const view = await runtime.getProviderSettings();
      setProfiles(view.profiles);
      const profile = profileFromPreset(preset, view.profiles, apiKey, endpoint, model);
      const result = await runtime.fetchProviderModels(profile);
      setModels(result.models);
      if (result.models.length === 1) setModel(result.models[0]);
      if (!result.models.length) setError(t("setup.model.noModels"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("setup.model.fetchFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveModel = async () => {
    if (!endpoint.trim() || !model.trim()) return;
    setBusy(true);
    setError("");
    try {
      const view = profiles.length ? { profiles } : await runtime.getProviderSettings();
      const profile = profileFromPreset(preset, view.profiles, apiKey, endpoint, model);
      await runtime.saveProviderProfile(profile);
      await runtime.activateProvider(profile.id);
      window.localStorage.removeItem(SETUP_DISMISSED_KEY);
      setReadiness(await inspectSetup(runtime));
      setStep(3);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("setup.model.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    window.localStorage.setItem(SETUP_DISMISSED_KEY, "1");
    onClose();
  };

  if (!open) return null;
  return (
    <dialog className="modal modal-open setup-assistant-dialog" open aria-labelledby="setup-assistant-title" onCancel={dismiss}>
      <div className="modal-box setup-assistant-modal">
        <header className="setup-assistant-header">
          <div>
            <span className="setup-eyebrow">{t("setup.eyebrow")}</span>
            <h2 id="setup-assistant-title" ref={titleRef} tabIndex={-1}>{t(`setup.steps.${step}.title`)}</h2>
          </div>
          <button className="btn btn-ghost btn-square btn-sm" type="button" aria-label={t("common.close")} onClick={dismiss}><X size={18} /></button>
        </header>
        <ol className="setup-progress" aria-label={t("setup.progress")}>{[0, 1, 2, 3].map((index) => <li key={index} className={index <= step ? "active" : ""}><span>{index < step ? <Check size={13} /> : index + 1}</span></li>)}</ol>

        <div className="setup-assistant-content">
          {step === 0 ? (
            <div className="setup-welcome">
              <span className="setup-hero-icon"><Sparkles size={28} /></span>
              <p>{t("setup.welcome.description")}</p>
              <ul><li>{t("setup.welcome.private")}</li><li>{t("setup.welcome.fast")}</li><li>{t("setup.welcome.reversible")}</li></ul>
            </div>
          ) : null}

          {step === 1 ? (
            <div>
              <p className="setup-lead">{t("setup.connection.description")}</p>
              <ul className="setup-readiness-list">
                <ReadinessRow state={readiness.bridge} title={t("setup.checks.bridge")} detail={readiness.bridge === "ready" ? t("setup.checks.bridgeReady", { version: readiness.bridgeVersion }) : t("setup.checks.bridgeHelp")} />
                <ReadinessRow state={readiness.pairing} title={t("setup.checks.pairing")} detail={readiness.pairing === "ready" ? t("setup.checks.pairingReady") : t("setup.checks.pairingHelp")} />
              </ul>
              {readiness.error ? <div className="alert alert-warning setup-inline-alert"><CircleAlert size={17} /><span>{t("setup.connection.failed")}</span></div> : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="setup-model-form">
              <p className="setup-lead">{t("setup.model.description")}</p>
              <fieldset><legend>{t("models.provider")}</legend><select className="select w-full" value={providerId} onChange={(event) => chooseProvider(event.currentTarget.value)}>{quickProviders.map((item) => <option key={item.id} value={item.id}>{t(item.labelKey)}</option>)}</select></fieldset>
              <fieldset><legend>{t("models.endpoint")}</legend><input className="input w-full" value={endpoint} onChange={(event) => setEndpoint(event.currentTarget.value)} autoComplete="url" /></fieldset>
              {preset.needsApiKey ? <fieldset><legend>{t("models.apiKey")}</legend><input className="input w-full" type="password" value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} autoComplete="off" /><small>{t("setup.model.keyStoredLocally")}</small></fieldset> : <p className="setup-local-hint"><ShieldCheck size={16} />{t("setup.model.ollamaHint")}</p>}
              <div className="setup-model-picker">
                <fieldset><legend>{t("models.model")}</legend>{models.length ? <select className="select w-full" value={model} onChange={(event) => setModel(event.currentTarget.value)}><option value="">{t("models.selectModel")}</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select> : <input className="input w-full" value={model} onChange={(event) => setModel(event.currentTarget.value)} placeholder={t("setup.model.modelPlaceholder")} />}</fieldset>
                <button className="btn btn-sm" type="button" disabled={busy || !endpoint.trim()} onClick={() => void loadModels()}>{busy ? <span className="loading loading-spinner loading-xs" /> : <RefreshCw size={15} />}{t("models.fetchModels")}</button>
              </div>
              {error ? <div className="alert alert-warning setup-inline-alert" role="alert"><CircleAlert size={17} /><span>{t("setup.model.errorHint")}<details><summary>{t("setup.health.technicalDetails")}</summary><code>{error}</code></details></span></div> : null}
              <button className="btn btn-ghost btn-sm setup-advanced-model-link" type="button" onClick={onOpenModels}>{t("setup.model.openAdvanced")}</button>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="setup-complete" role="status">
              <span className="setup-complete-icon"><CircleCheck size={32} /></span>
              <p>{t("setup.complete.description", { provider: readiness.providerName, model: readiness.modelName })}</p>
              <div className="setup-example"><strong>{t("setup.complete.tryTitle")}</strong><span>{t("setup.complete.tryExample")}</span></div>
            </div>
          ) : null}
        </div>

        <footer className="setup-assistant-actions">
          <div>{step > 0 && step < 3 ? <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setStep((value) => value - 1)}><ChevronLeft size={16} />{t("setup.back")}</button> : null}</div>
          <div className="flex gap-2">
            {step < 3 ? <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={dismiss}>{t("setup.later")}</button> : null}
            {step === 0 ? <button className="btn btn-primary btn-sm" type="button" onClick={() => setStep(1)}>{t("setup.start")}</button> : null}
            {step === 1 ? <button className="btn btn-primary btn-sm" type="button" disabled={readiness.bridge === "checking"} onClick={() => readiness.pairing === "ready" ? setStep(2) : void runInspection()}>{readiness.pairing === "ready" ? t("setup.continue") : t("setup.retry")}</button> : null}
            {step === 2 ? <button className="btn btn-primary btn-sm" type="button" disabled={busy || !endpoint.trim() || !model.trim()} onClick={() => void saveModel()}>{busy ? <span className="loading loading-spinner loading-xs" /> : null}{t("setup.model.saveAndUse")}</button> : null}
            {step === 3 ? <button className="btn btn-primary btn-sm" type="button" onClick={onComplete}>{t("setup.complete.finish")}</button> : null}
          </div>
        </footer>
      </div>
      <form method="dialog" className="modal-backdrop" onSubmit={dismiss}><button aria-label={t("common.close")}>{t("common.close")}</button></form>
    </dialog>
  );
}
