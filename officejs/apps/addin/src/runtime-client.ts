import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_URL,
  type BridgeHealthResponse,
  type ChatMessage,
  type CommandRequest,
  type OfficeToolDescriptor,
  type PairResponse,
  type ProviderChatResponse,
  type ProviderChatChunk,
  type AgentStartResponse,
  type AgentStartOptions,
  type RuntimeEvent,
  type AgentCheckpoint,
  type AgentRecoveryDescriptor,
  type SkillSummary,
  type GenerateSkillRequest,
  type GeneratedSkillResponse,
  type ProviderModelsResponse,
  type ProviderRuntimeResponse,
  type ProviderCapabilityProbeResponse,
  type OllamaModelProgress,
  type ReviewSettingsView,
  type ProviderProfileUpdate,
  type ProviderSettingsView,
  type GoogleOAuthRequest,
  type GoogleOAuthResponse,
  type McpServerUpdate,
  type McpServerView,
  type McpServerHealth,
  type McpImportResult,
  type McpToolDefinition,
  type ToolCatalogResponse,
  type DocumentCompareResponse,
  type LawArticleResult,
  type UpdateCheckResult,
  type UpdateInstallResult,
  type UpdateRollbackStatus,
  type UpdateRollbackResult,
  type ResourceDiagnosticsSnapshot,
} from "./contracts";
import i18n from "./i18n";

const tr = (key: string, values?: Record<string, unknown>): string =>
  i18n.t(key, values);
const HTTP_ONLY_COOKIE_SESSION = "__wordollama_http_only_cookie__";

export class RuntimeRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RuntimeRequestError";
  }
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    const payload = await response.json() as { error?: string; detail?: string };
    return new Error(payload.error ?? payload.detail ?? fallback);
  } catch {
    return new Error(fallback);
  }
}
import {
  applyOutputLanguage,
  type OutputLanguageMode,
} from "./output-language";
import {
  browserPairingStorage,
  clearPairingSession,
  isPairingSessionValid,
  readPairingSession,
  writePairingSession,
  type PairingStorage,
} from "./pairing-session";

export class RuntimeClient {
  private cookieSession = false;
  private sessionToken: string | undefined;
  private csrfToken: string | undefined;
  private autoPairPromise: Promise<PairResponse> | undefined;
  private outputLanguage: OutputLanguageMode = "auto";
  private readonly pairingStorage: PairingStorage | undefined;

  constructor(pairingStorage: PairingStorage | undefined = browserPairingStorage()) {
    this.pairingStorage = pairingStorage;
    const pairing = readPairingSession(pairingStorage);
    this.cookieSession = pairing?.cookieSession === true;
    this.sessionToken = this.cookieSession ? HTTP_ONLY_COOKIE_SESSION : pairing?.sessionToken;
    this.csrfToken = pairing?.csrfToken;
  }

  hasPairing(): boolean {
    return this.cookieSession || Boolean(this.sessionToken);
  }

  refreshPairing(): boolean {
    const pairing = readPairingSession(this.pairingStorage);
    this.cookieSession = pairing?.cookieSession === true;
    this.sessionToken = this.cookieSession ? HTTP_ONLY_COOKIE_SESSION : pairing?.sessionToken;
    this.csrfToken = pairing?.csrfToken;
    return this.hasPairing();
  }

  adoptPairing(result: PairResponse): void {
    if (result.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new Error(tr("runtime.protocolIncompatible", { version: result.protocolVersion }));
    }
    if (!isPairingSessionValid(result)) {
      throw new Error(tr("runtime.pairingInvalid"));
    }
    writePairingSession(this.pairingStorage, result);
    this.cookieSession = result.cookieSession === true;
    this.sessionToken = this.cookieSession
      ? result.sessionToken || HTTP_ONLY_COOKIE_SESSION
      : result.sessionToken;
    this.csrfToken = result.csrfToken;
  }

  clearPairing(): void {
    this.cookieSession = false;
    this.sessionToken = undefined;
    this.csrfToken = undefined;
    clearPairingSession(this.pairingStorage);
  }

  private async sessionFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (this.cookieSession && this.sessionToken === HTTP_ONLY_COOKIE_SESSION) {
      headers.delete("X-WordOllama-Session");
    }
    if (this.csrfToken && init?.method && !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())) {
      headers.set("X-WordOllama-CSRF", this.csrfToken);
    }
    const response = await fetch(input, { ...init, headers, credentials: "include" });
    if (response.status === 401) this.clearPairing();
    return response;
  }

  setOutputLanguage(mode: string): void {
    this.outputLanguage = mode === "zh" || mode === "en" || mode === "source"
      ? mode
      : "auto";
  }

  async health(): Promise<BridgeHealthResponse> {
    const response = await fetch(`${BRIDGE_URL}/health`);
    if (!response.ok) {
      throw new Error(`Bridge health failed (${response.status})`);
    }
    return response.json() as Promise<BridgeHealthResponse>;
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    return this.settingsRequest("/updates/check");
  }

  async installUpdate(): Promise<UpdateInstallResult> {
    return this.settingsRequest("/updates/install", { method: "POST" });
  }

  async getUpdateRollbackStatus(): Promise<UpdateRollbackStatus> {
    return this.settingsRequest("/updates/rollback");
  }

  async rollbackUpdate(): Promise<UpdateRollbackResult> {
    return this.settingsRequest("/updates/rollback", { method: "POST" });
  }

  async getResourceDiagnostics(): Promise<ResourceDiagnosticsSnapshot> {
    return this.settingsRequest("/diagnostics/resources");
  }

  async pair(pairingCode: string): Promise<PairResponse> {
    const response = await fetch(`${BRIDGE_URL}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairingCode,
        origin: window.location.origin,
      }),
    });

    if (!response.ok) {
      throw new Error(response.status === 401
        ? tr("runtime.pairingCodeInvalid")
        : tr("runtime.pairingFailed", { status: response.status }));
    }

    const result = (await response.json()) as PairResponse;
    this.adoptPairing(result);
    return result;
  }

  async autoPair(): Promise<PairResponse> {
    if (this.autoPairPromise) return this.autoPairPromise;
    this.autoPairPromise = this.performAutoPair();
    try {
      return await this.autoPairPromise;
    } finally {
      this.autoPairPromise = undefined;
    }
  }

  private async performAutoPair(): Promise<PairResponse> {
    const origin = window.location.origin;
    const response = await fetch(`${BRIDGE_URL}/pair/automatic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ origin }),
    });

    if (!response.ok) {
      throw new Error(tr("runtime.automaticPairingFailed", { status: response.status }));
    }

    const result = (await response.json()) as PairResponse;
    this.adoptPairing(result);
    return result;
  }

  async execute(command: CommandRequest): Promise<unknown> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }

    const response = await this.sessionFetch(`${BRIDGE_URL}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WordOllama-Session": this.sessionToken,
        "Accept-Language": i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en-US",
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(tr("runtime.commandFailed", { status: response.status }));
    }
    return response.json();
  }

  async registerOfficeTools(tools: OfficeToolDescriptor[]): Promise<ToolCatalogResponse> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }

    const response = await this.sessionFetch(`${BRIDGE_URL}/capabilities`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WordOllama-Session": this.sessionToken,
      },
      body: JSON.stringify({ tools }),
    });

    if (!response.ok) {
      throw new Error(tr("runtime.registerToolsFailed", { status: response.status }));
    }
    return response.json() as Promise<ToolCatalogResponse>;
  }

  async chat(
    messages: ChatMessage[],
    model?: string,
    signal?: AbortSignal,
    providerProfileId?: string,
  ): Promise<ProviderChatResponse> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }

    const response = await this.sessionFetch(BRIDGE_URL + "/providers/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WordOllama-Session": this.sessionToken,
      },
      body: JSON.stringify({
        messages: applyOutputLanguage(messages, this.outputLanguage),
        model,
        providerProfileId,
      }),
      signal,
    });

    if (!response.ok) {
      throw await responseError(response, tr("runtime.providerRequestFailed", { status: response.status }));
    }
    return response.json() as Promise<ProviderChatResponse>;
  }

  async *streamChat(
    messages: ChatMessage[],
    model?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderChatChunk> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }
    const response = await this.sessionFetch(BRIDGE_URL + "/providers/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
        "X-WordOllama-Session": this.sessionToken,
      },
      body: JSON.stringify({
        messages: applyOutputLanguage(messages, this.outputLanguage),
        model,
      }),
      signal,
    });
    if (!response.ok || !response.body) {
      throw await responseError(response, tr("runtime.providerStreamFailed", { status: response.status }));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as ProviderChatChunk;
      }
      if (chunk.done) {
        if (buffer.trim()) yield JSON.parse(buffer) as ProviderChatChunk;
        return;
      }
    }
  }

  async searchLawArticle(
    law: string,
    article: string,
    signal?: AbortSignal,
  ): Promise<LawArticleResult> {
    if (!this.sessionToken) throw new Error(tr("runtime.pairFirst"));
    const query = new URLSearchParams({ law, article });
    const response = await this.sessionFetch(`${BRIDGE_URL}/legal/article?${query}`, {
      headers: { "X-WordOllama-Session": this.sessionToken },
      signal,
    });
    if (response.status === 404) throw new Error(tr("runtime.legalArticleNotFound"));
    if (!response.ok) throw new Error(tr("runtime.legalSearchFailed", { status: response.status }));
    return response.json() as Promise<LawArticleResult>;
  }

  async startAgent(
    userRequirement: string,
    tools: OfficeToolDescriptor[],
    options: AgentStartOptions,
  ): Promise<AgentStartResponse> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }

    const response = await this.sessionFetch(BRIDGE_URL + "/agent/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WordOllama-Session": this.sessionToken,
      },
      body: JSON.stringify({
        userRequirement,
        tools,
        ...options,
      }),
    });

    if (!response.ok) {
      throw await responseError(response, tr("runtime.agentStartFailed", { status: response.status }));
    }
    return response.json() as Promise<AgentStartResponse>;
  }

  async *pullOllamaModel(model: string): AsyncGenerator<OllamaModelProgress> {
    if (!this.sessionToken) throw new Error(tr("runtime.pairFirst"));
    const response = await this.sessionFetch(`${BRIDGE_URL}/providers/ollama/models/pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WordOllama-Session": this.sessionToken,
        "Accept-Language": i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en-US",
      },
      body: JSON.stringify({ model }),
    });
    if (!response.ok || !response.body) {
      throw new Error(tr("runtime.ollamaPullFailed", { status: response.status }));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as OllamaModelProgress;
      }
      if (chunk.done) {
        if (buffer.trim()) yield JSON.parse(buffer) as OllamaModelProgress;
        return;
      }
    }
  }

  async loadOllamaModel(model: string): Promise<void> {
    await this.settingsRequest("/providers/ollama/models/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
  }

  async getProviderRuntime(): Promise<ProviderRuntimeResponse> {
    return this.settingsRequest<ProviderRuntimeResponse>("/providers/runtime");
  }

  async deleteOllamaModel(model: string): Promise<void> {
    await this.settingsRequest(`/providers/ollama/models/${encodeURIComponent(model)}`, {
      method: "DELETE",
    });
  }

  async getReviewSettings(): Promise<ReviewSettingsView> {
    return this.settingsRequest<ReviewSettingsView>("/settings/review");
  }

  async saveReviewSettings(
    outputPreference: string,
    autoMemory: boolean,
    memoryProviderProfileId = "",
  ): Promise<ReviewSettingsView> {
    return this.settingsRequest<ReviewSettingsView>("/settings/review", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputPreference, autoMemory, memoryProviderProfileId }),
    });
  }

  async addMemory(content: string): Promise<ReviewSettingsView> {
    return this.settingsRequest<ReviewSettingsView>("/settings/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  async updateMemory(id: string, content: string): Promise<ReviewSettingsView> {
    return this.settingsRequest<ReviewSettingsView>(`/settings/memories/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  async deleteMemories(ids: string[]): Promise<ReviewSettingsView> {
    return this.settingsRequest<ReviewSettingsView>("/settings/memories/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  }

  async confirmAgentPlan(sessionId: string, approved: boolean, note?: string): Promise<void> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }
    const response = await this.sessionFetch(
      BRIDGE_URL + "/agent/sessions/" + encodeURIComponent(sessionId) + "/plan-confirmation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WordOllama-Session": this.sessionToken,
        },
        body: JSON.stringify({ approved, note }),
      },
    );
    if (!response.ok) {
      throw new Error(tr("runtime.agentPlanFailed", { status: response.status }));
    }
  }

  async submitPermission(
    sessionId: string,
    callId: string,
    approved: boolean,
    note?: string,
  ): Promise<void> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }
    const response = await this.sessionFetch(
      BRIDGE_URL + "/agent/sessions/" + encodeURIComponent(sessionId) + "/permissions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WordOllama-Session": this.sessionToken,
        },
        body: JSON.stringify({ callId, approved, note }),
      },
    );
    if (!response.ok) {
      throw new Error(tr("runtime.agentPermissionFailed", { status: response.status }));
    }
  }

  async *readAgentEvents(sessionId: string): AsyncGenerator<RuntimeEvent> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }

    const response = await this.sessionFetch(
      BRIDGE_URL + "/agent/sessions/" + encodeURIComponent(sessionId) + "/events",
      {
        headers: {
          Accept: "application/x-ndjson",
          "X-WordOllama-Session": this.sessionToken,
        },
      },
    );
    if (!response.ok || !response.body) {
      throw new Error(tr("runtime.agentEventsFailed", { status: response.status }));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          yield JSON.parse(line) as RuntimeEvent;
        }
      }
      if (chunk.done) {
        if (buffer.trim()) {
          yield JSON.parse(buffer) as RuntimeEvent;
        }
        return;
      }
    }
  }

  async submitToolResult(
    sessionId: string,
    callId: string,
    result: unknown,
    isError = false,
  ): Promise<void> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }

    const response = await this.sessionFetch(
      BRIDGE_URL + "/agent/sessions/" + encodeURIComponent(sessionId) + "/tool-results",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WordOllama-Session": this.sessionToken,
        },
        body: JSON.stringify({
          callId,
          result: typeof result === "string" ? result : JSON.stringify(result),
          isError,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(tr("runtime.agentToolResultFailed", { status: response.status }));
    }
  }

  async cancelAgent(sessionId: string): Promise<void> {
    if (!this.sessionToken) {
      return;
    }
    await this.sessionFetch(
      BRIDGE_URL + "/agent/sessions/" + encodeURIComponent(sessionId) + "/cancel",
      {
        method: "POST",
        headers: { "X-WordOllama-Session": this.sessionToken },
      },
    );
  }

  async getAgentCheckpoint(sessionId: string): Promise<AgentCheckpoint> {
    if (!this.sessionToken) throw new Error(tr("runtime.pairFirst"));
    const response = await this.sessionFetch(
      `${BRIDGE_URL}/agent/sessions/${encodeURIComponent(sessionId)}/checkpoint`,
      { headers: { "X-WordOllama-Session": this.sessionToken } },
    );
    if (!response.ok) throw new Error(tr("runtime.agentCheckpointUnavailable", { status: response.status }));
    return response.json() as Promise<AgentCheckpoint>;
  }

  async listAgentRecoveries(): Promise<AgentRecoveryDescriptor[]> {
    if (!this.sessionToken) throw new Error(tr("runtime.pairFirst"));
    const response = await this.sessionFetch(`${BRIDGE_URL}/agent/recoveries`, {
      headers: { "X-WordOllama-Session": this.sessionToken },
    });
    if (!response.ok) throw new Error(tr("runtime.agentRecoveriesUnavailable", { status: response.status }));
    return response.json() as Promise<AgentRecoveryDescriptor[]>;
  }

  async compareDocuments(
    originalBase64: string,
    revisedBase64: string,
    ignoreCase = false,
  ): Promise<DocumentCompareResponse> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }
    const response = await this.sessionFetch(BRIDGE_URL + "/documents/compare", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WordOllama-Session": this.sessionToken,
      },
      body: JSON.stringify({ originalBase64, revisedBase64, ignoreCase }),
    });
    if (!response.ok) {
      let detail = "";
      try {
        const payload = await response.json() as { error?: string };
        detail = payload.error ? `：${payload.error}` : "";
      } catch {
        // Keep the status-only fallback for non-JSON proxy errors.
      }
      throw new Error(tr("runtime.documentCompareFailed", { status: response.status, detail }));
    }
    return response.json() as Promise<DocumentCompareResponse>;
  }

  async listSkills(): Promise<SkillSummary[]> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }
    const response = await this.sessionFetch(BRIDGE_URL + "/skills", {
      headers: { "X-WordOllama-Session": this.sessionToken },
    });
    if (!response.ok) {
      throw new Error(tr("runtime.skillsReadFailed", { status: response.status }));
    }
    return response.json() as Promise<SkillSummary[]>;
  }

  async readSkill(name: string): Promise<string> {
    if (!this.sessionToken) {
      throw new Error(tr("runtime.pairFirst"));
    }
    const response = await this.sessionFetch(BRIDGE_URL + "/skills/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WordOllama-Session": this.sessionToken,
      },
      body: JSON.stringify({ skillName: name }),
    });
    if (!response.ok) {
      throw new Error(tr("runtime.skillsReadFailed", { status: response.status }));
    }
    const result = await response.json() as { content: string };
    return result.content;
  }

  async importSkill(fileName: string, zipBase64: string): Promise<SkillSummary> {
    return this.settingsRequest("/skills/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, zipBase64 }),
    });
  }

  async deleteSkill(name: string): Promise<void> {
    await this.settingsRequest(`/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  async openSkillsFolder(): Promise<void> {
    await this.settingsRequest("/skills/open-folder", { method: "POST" });
  }

  async listProviderModels(): Promise<ProviderModelsResponse> {
    if (!this.sessionToken) throw new Error(tr("runtime.pairFirst"));
    const response = await this.sessionFetch(BRIDGE_URL + "/providers/models", {
      headers: { "X-WordOllama-Session": this.sessionToken },
    });
    if (!response.ok) throw new Error(tr("runtime.providerModelsFailed", { status: response.status }));
    return response.json() as Promise<ProviderModelsResponse>;
  }

  async getProviderSettings(): Promise<ProviderSettingsView> {
    return this.settingsRequest("/settings/providers");
  }

  async saveProviderProfile(profile: ProviderProfileUpdate): Promise<ProviderSettingsView> {
    return this.settingsRequest(`/settings/providers/${encodeURIComponent(profile.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
  }

  async activateProvider(id: string): Promise<ProviderSettingsView> {
    return this.settingsRequest(`/settings/providers/${encodeURIComponent(id)}/activate`, { method: "POST" });
  }

  async deleteProvider(id: string): Promise<ProviderSettingsView> {
    return this.settingsRequest(`/settings/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async fetchProviderModels(profile: ProviderProfileUpdate): Promise<ProviderModelsResponse> {
    return this.settingsRequest("/settings/providers/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
  }

  async authorizeGoogleProvider(
    id: string,
    request: GoogleOAuthRequest,
  ): Promise<GoogleOAuthResponse> {
    return this.settingsRequest(`/settings/providers/${encodeURIComponent(id)}/oauth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  async listMcpServers(): Promise<McpServerView[]> {
    return this.settingsRequest("/mcp/servers");
  }

  async probeProvider(providerProfileId: string): Promise<ProviderCapabilityProbeResponse> {
    return this.settingsRequest("/providers/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerProfileId }),
    });
  }

  async generateSkill(request: GenerateSkillRequest): Promise<GeneratedSkillResponse> {
    return this.settingsRequest("/skills/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  async importMcpJson(json: string): Promise<McpImportResult> {
    return this.settingsRequest("/mcp/servers/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json }),
    });
  }

  async saveMcpServer(server: McpServerUpdate): Promise<{ server: McpServerView; tools: McpToolDefinition[] }> {
    return this.settingsRequest("/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(server),
    });
  }

  async connectMcpServer(name: string): Promise<{ tools: McpToolDefinition[] }> {
    return this.settingsRequest(`/mcp/servers/${encodeURIComponent(name)}/connect`, { method: "POST" });
  }

  async disconnectMcpServer(name: string): Promise<{ disconnected: boolean }> {
    return this.settingsRequest(`/mcp/servers/${encodeURIComponent(name)}/disconnect`, { method: "POST" });
  }

  async deleteMcpServer(name: string): Promise<void> {
    await this.settingsRequest(`/mcp/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  async listMcpTools(name: string): Promise<McpToolDefinition[]> {
    return this.settingsRequest(`/mcp/servers/${encodeURIComponent(name)}/tools`);
  }

  async checkMcpHealth(name: string): Promise<McpServerHealth> {
    return this.settingsRequest(`/mcp/servers/${encodeURIComponent(name)}/health`, { method: "POST" });
  }

  async saveMcpPermissions(name: string, permissions: Record<string, boolean>): Promise<void> {
    await this.settingsRequest(`/mcp/servers/${encodeURIComponent(name)}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(permissions),
    });
  }

  private async settingsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.hasPairing()) await this.autoPair();
    const request = async (): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (this.sessionToken && this.sessionToken !== HTTP_ONLY_COOKIE_SESSION) {
        headers.set("X-WordOllama-Session", this.sessionToken);
      }
      headers.set(
        "Accept-Language",
        i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en-US",
      );
      return this.sessionFetch(BRIDGE_URL + path, { ...init, headers });
    };
    let response = await request();
    if (response.status === 401) {
      await this.autoPair();
      response = await request();
    }
    if (!response.ok) {
      let detail = "";
      try {
        const payload = await response.json() as { error?: string; detail?: string };
        detail = payload.error ?? payload.detail ?? "";
      } catch { /* Status fallback below. */ }
      throw new RuntimeRequestError(
        detail || tr("runtime.settingsRequestFailed", { status: response.status }),
        response.status,
      );
    }
    return response.json() as Promise<T>;
  }
}
