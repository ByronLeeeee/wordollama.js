import type { PairResponse, ToolCatalogResponse } from "../contracts";

type DialogRequest =
  | { id: string; method: "word.listStyles" }
  | { id: string; method: "word.createParagraphStyle"; name: string }
  | { id: string; method: "runtime.adoptPairing"; pairing: PairResponse };

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
  if (typeof Office === "undefined" || typeof Office.context?.ui?.addHandlerAsync !== "function") {
    throw new Error("dialog-parent-messaging-unavailable");
  }
  Office.context.ui.addHandlerAsync(
    Office.EventType.DialogParentMessageReceived,
    (event) => {
      const response = JSON.parse(event.message) as DialogResponse;
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.ok) request.resolve(response.result);
      else request.reject(new Error(response.error ?? "dialog-parent-request-failed"));
    },
  );
  initialized = true;
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
    Office.context.ui.messageParent(JSON.stringify({ ...input, id }), {
      targetOrigin: window.location.origin,
    });
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
