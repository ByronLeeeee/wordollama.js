import type { PairResponse, ToolCatalogResponse } from "../contracts";

type DialogRequest =
  | { id: string; method: "word.listStyles" }
  | { id: string; method: "word.createParagraphStyle"; name: string }
  | { id: string; method: "runtime.adoptPairing"; pairing: PairResponse }
  | { id: string; method: "settings.close" };

type DialogRequestInput =
  | { method: "word.listStyles" }
  | { method: "word.createParagraphStyle"; name: string }
  | { method: "runtime.adoptPairing"; pairing: PairResponse };

type DialogResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

const pending = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}>();

let initialized = false;

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const random = Math.random().toString(36).slice(2);
  return `wps-${Date.now().toString(36)}-${random}`;
}

function isDirectWpsDialog(): boolean {
  const application = window.wps ?? window.Application;
  return Boolean(application) &&
    new URLSearchParams(window.location.search).get("wpsDialog") === "1";
}

function ensureInitialized(): void {
  if (initialized) return;
  if (typeof Office !== "undefined" && typeof Office.context?.ui?.addHandlerAsync === "function") {
    Office.context.ui.addHandlerAsync(
      Office.EventType.DialogParentMessageReceived,
      (event) => handleResponse(event.message),
    );
    initialized = true;
    return;
  }
  if (!window.opener) throw new Error("dialog-parent-messaging-unavailable");
  window.addEventListener("message", (event) => {
    if (event.source !== window.opener || event.origin !== window.location.origin) return;
    handleResponse(typeof event.data === "string" ? event.data : JSON.stringify(event.data));
  });
  initialized = true;
}

function handleResponse(message: string): void {
  let response: DialogResponse;
  try {
    response = JSON.parse(message) as DialogResponse;
  } catch {
    return;
  }
  if (!response || typeof response.id !== "string" || typeof response.ok !== "boolean") return;
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  if (response.ok) request.resolve(response.result);
  else request.reject(new Error(response.error ?? "dialog-parent-request-failed"));
}

function requestParent<T>(input: DialogRequestInput): Promise<T> {
  ensureInitialized();
  const id = createRequestId();
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error("dialog-parent-request-timeout"));
    }, 15000);
    pending.set(id, {
      resolve: (value) => {
        window.clearTimeout(timeout);
        resolve(value as T);
      },
      reject: (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    });
    const message = JSON.stringify({ ...input, id });
    if (typeof Office !== "undefined" && typeof Office.context?.ui?.messageParent === "function") {
      Office.context.ui.messageParent(message, { targetOrigin: window.location.origin });
    } else if (window.opener) {
      window.opener.postMessage(message, window.location.origin);
    } else {
      pending.delete(id);
      window.clearTimeout(timeout);
      reject(new Error("dialog-parent-messaging-unavailable"));
    }
  });
}

export async function listWordStyles(): Promise<string[]> {
  if (isDirectWpsDialog()) {
    const { WpsWordAdapter } = await import("../wps-word-adapter.ts");
    return new WpsWordAdapter().listStyles();
  }
  return requestParent<string[]>({ method: "word.listStyles" });
}

export async function createWordParagraphStyle(name: string): Promise<void> {
  if (isDirectWpsDialog()) {
    const { WpsWordAdapter } = await import("../wps-word-adapter.ts");
    return new WpsWordAdapter().createParagraphStyle(name);
  }
  return requestParent<void>({ method: "word.createParagraphStyle", name });
}

export async function adoptPairingInTaskPane(pairing: PairResponse): Promise<ToolCatalogResponse> {
  if (isDirectWpsDialog()) {
    const [{ WpsWordAdapter }, { OfficeJsToolRegistry }, { RuntimeClient }] = await Promise.all([
      import("../wps-word-adapter.ts"),
      import("../officejs-tool-registry.ts"),
      import("../runtime-client.ts"),
    ]);
    const adapter = new WpsWordAdapter();
    const runtime = new RuntimeClient();
    runtime.adoptPairing(pairing);
    return runtime.registerOfficeTools(new OfficeJsToolRegistry(adapter).list());
  }
  return requestParent<ToolCatalogResponse>({ method: "runtime.adoptPairing", pairing });
}

export function closeSettingsWindow(): void {
  if (isDirectWpsDialog()) {
    window.close();
    return;
  }
  if (typeof Office !== "undefined" && typeof Office.context?.ui?.messageParent === "function") {
    Office.context.ui.messageParent(JSON.stringify({
      id: createRequestId(),
      method: "settings.close",
    }), {
      targetOrigin: window.location.origin,
    });
    return;
  }
  if (window.opener) {
    window.opener.postMessage(JSON.stringify({
      id: createRequestId(),
      method: "settings.close",
    }), window.location.origin);
  }
  window.close();
}
