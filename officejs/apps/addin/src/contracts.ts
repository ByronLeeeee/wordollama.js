declare const __WORDOLLAMA_BRIDGE_URL__: string | undefined;
declare const __WORDOLLAMA_ADDIN_VERSION__: string | undefined;

export const BRIDGE_PROTOCOL_VERSION = "1.0";
export const BRIDGE_URL = typeof __WORDOLLAMA_BRIDGE_URL__ === "string"
  ? __WORDOLLAMA_BRIDGE_URL__
  : "http://127.0.0.1:37421";
export const ADDIN_VERSION = typeof __WORDOLLAMA_ADDIN_VERSION__ === "string"
  ? __WORDOLLAMA_ADDIN_VERSION__
  : "development";

export interface ReleaseTestIdentity {
  addinVersion: string;
  bridgeVersion: string;
  protocolVersion: string;
}

export interface BridgeHealthResponse {
  protocolVersion: string;
  bridgeVersion: string;
  ready: boolean;
  capabilities: string[];
}

export interface UpdateArtifact {
  kind: "installer" | "archive";
  runtime: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  signatureUrl?: string;
  publisherSubject?: string;
}

export interface UpdateCheckResult {
  configured: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  runtime: string;
  generatedAt?: string;
  releaseNotes?: string;
  artifact?: UpdateArtifact;
}

export interface UpdateInstallResult {
  status: "launched";
  version: string;
  runtime: string;
  fileName: string;
}

export interface PairResponse {
  protocolVersion: string;
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
  capabilities: string[];
  cookieSession?: boolean;
}

export interface OfficeToolDescriptor {
  name: string;
  description: string;
  isWriteOperation: boolean;
  parameterSchema: Record<string, unknown>;
}

export interface ToolCatalogResponse {
  protocolVersion: string;
  registeredOfficeToolCount: number;
  tools: OfficeToolDescriptor[];
}

export interface SkillSummary {
  name: string;
  description: string;
}

export interface ProviderModelsResponse {
  provider: string;
  models: string[];
}

export interface ProviderRuntimeResponse {
  provider: string;
  type: string;
  models: string[];
}

export interface OllamaModelProgress {
  status: string;
  digest?: string;
  completed?: number;
  total?: number;
  done: boolean;
}

export interface ReviewSettingsView {
  memories: MemoryItemView[];
  outputPreference: string;
  autoMemory: boolean;
  memoryProviderProfileId: string;
  writingProfile: string;
}

export interface MemoryItemView {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderProfileView {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  model: string;
  toolCallingMode: string;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsJsonOutput: boolean;
  contextWindow: number;
  hasApiKey: boolean;
  temperature: number;
  maxTokens: number;
  keepAlive: string;
  apiMode: string;
}

export interface ProviderSettingsView {
  activeProviderId: string;
  profiles: ProviderProfileView[];
}

export interface GoogleOAuthRequest {
  clientId: string;
  clientSecret?: string;
  quotaProject?: string;
  uiLocale: "en-US" | "zh-CN";
}

export interface GoogleOAuthResponse {
  providerSettings: ProviderSettingsView;
  hasRefreshToken: boolean;
}

export interface ProviderProfileUpdate extends Omit<ProviderProfileView, "hasApiKey"> {
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface McpServerView {
  name: string;
  transport: string;
  command: string;
  arguments: string[];
  workingDirectory?: string;
  environmentKeys: string[];
  headerKeys: string[];
  enabled: boolean;
  trusted: boolean;
  toolPermissions: Record<string, boolean>;
  connected: boolean;
  toolCount: number;
  lastError?: string;
  lastConnectedAt?: string;
  lastCheckDurationMs?: number;
  webSearchEnabled: boolean;
  searchToolName?: string;
  allowedDomains: string[];
  searchMaxCalls: number;
  searchMaxResultCharacters: number;
}

export interface McpServerHealth {
  name: string;
  connected: boolean;
  toolCount: number;
  lastError?: string;
  lastConnectedAt?: string;
  lastCheckDurationMs?: number;
}

export interface McpServerUpdate {
  name: string;
  transport: string;
  command: string;
  arguments: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
  trusted: boolean;
  webSearchEnabled: boolean;
  searchToolName?: string;
  allowedDomains: string[];
  searchMaxCalls: number;
  searchMaxResultCharacters: number;
}

export interface McpImportResult {
  total: number;
  added: number;
  updated: number;
  connected: number;
  errors: Record<string, string>;
  servers: McpServerView[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  serverName: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  imageDataUrl?: string;
}

export interface ProviderChatResponse {
  provider: string;
  model: string;
  content: string;
}

export interface ProviderChatChunk {
  provider: string;
  model: string;
  delta: string;
  done: boolean;
}

export interface LawArticleResult {
  lawName: string;
  articleNumber: string;
  content: string;
  category: string;
}

export interface AgentStartResponse {
  sessionId: string;
  status: string;
}

export interface AgentStartOptions {
  goal?: string;
  model?: string;
  imageDataUrl?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  keepAlive?: string;
  requirePlanConfirmation: boolean;
  maxIterations: number;
  executionMode: "ViewOnly" | "ProposeChanges" | "TrackedChanges";
  allowExternalTools: boolean;
  allowLocalTools: boolean;
  allowNetworkTools: boolean;
  allowMcpTools: boolean;
  permissionMode: "request" | "auto" | "full";
  languageMode: "auto" | "zh" | "en" | "source";
  uiLocale: "en-US" | "zh-CN";
}

export interface RuntimeEvent {
  type: "text_delta" | "tool_call" | "completed" | "failed" | "cancelled" | string;
  requestId?: string;
  message?: string;
  data?: unknown;
}

export interface AgentCheckpoint {
  sessionId: string;
  iteration: number;
  messageCount: number;
  executionMode: "ViewOnly" | "ProposeChanges" | "TrackedChanges";
  createdAt: string;
}

export interface AgentRecoveryDescriptor {
  sessionId: string;
  userRequirement: string;
  iteration: number;
  executionMode: "ViewOnly" | "ProposeChanges" | "TrackedChanges";
  updatedAt: string;
  hasImage: boolean;
  goal?: string;
}

export interface CommandRequest {
  command: string;
  documentId?: string;
  arguments: unknown;
}

export interface DocumentTextDiff {
  kind: "added" | "removed" | "modified" | string;
  originalStart: number;
  originalLength: number;
  revisedStart: number;
  revisedLength: number;
  original?: string | null;
  revised?: string | null;
}

export interface DocumentDiff {
  kind: "added" | "removed" | "modified" | string;
  paragraphIndex: number;
  original?: string | null;
  revised?: string | null;
  originalParagraphIndex?: number | null;
  revisedParagraphIndex?: number | null;
  blockType: "paragraph" | "tableCell" | string;
  style?: string | null;
  location?: string | null;
  textChanges?: DocumentTextDiff[] | null;
  originalStyle?: string | null;
  revisedStyle?: string | null;
  originalLocation?: string | null;
  revisedLocation?: string | null;
  insertAfterOriginalParagraphIndex?: number | null;
  insertAfterOriginalText?: string | null;
  insertAfterOriginalBlockType?: string | null;
}

export interface DocumentCompareSummary {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  tableCellChanges: number;
  headingChanges: number;
}

export interface DocumentCompareResponse {
  originalParagraphCount: number;
  revisedParagraphCount: number;
  changes: DocumentDiff[];
  isApproximate: boolean;
  summary?: DocumentCompareSummary | null;
  algorithm?: string;
}
