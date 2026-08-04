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
  const response = JSON.parse(message) as DialogResponse;
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  if (response.ok) request.resolve(response.result);
  else request.reject(new Error(response.error ?? "dialog-parent-request-failed"));
}

function requestParent<T>(input: DialogRequestInput): Promise<T> {
  ensureInitialized();
  const id = crypto.randomUUID();
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

export function listWordStyles(): Promise<string[]> {
  return requestParent<string[]>({ method: "word.listStyles" });
}

export function createWordParagraphStyle(name: string): Promise<void> {
  return requestParent<void>({ method: "word.createParagraphStyle", name });
}

export function adoptPairingInTaskPane(pairing: PairResponse): Promise<ToolCatalogResponse> {
  return requestParent<ToolCatalogResponse>({ method: "runtime.adoptPairing", pairing });
}

export function closeSettingsWindow(): void {
  if (typeof Office !== "undefined" && typeof Office.context?.ui?.messageParent === "function") {
    Office.context.ui.messageParent(JSON.stringify({
      id: crypto.randomUUID(),
      method: "settings.close",
    }), {
      targetOrigin: window.location.origin,
    });
    return;
  }
  if (window.opener) {
    window.opener.postMessage(JSON.stringify({
      id: crypto.randomUUID(),
      method: "settings.close",
    }), window.location.origin);
  }
  window.close();
}
