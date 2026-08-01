import {
  BRIDGE_PROTOCOL_VERSION,
  type PairResponse,
} from "./contracts.ts";

export const PAIRING_SESSION_STORAGE_KEY = "wordollama.bridge-pairing.v1";
const EXPIRY_SAFETY_MARGIN_MS = 30_000;

export interface PairingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isValidPairing(
  value: unknown,
  now: number,
): value is PairResponse {
  if (!value || typeof value !== "object") return false;
  const pairing = value as Partial<PairResponse>;
  const expiresAt = typeof pairing.expiresAt === "string"
    ? Date.parse(pairing.expiresAt)
    : Number.NaN;
  return pairing.protocolVersion === BRIDGE_PROTOCOL_VERSION &&
    typeof pairing.sessionToken === "string" &&
    pairing.sessionToken.length >= 32 &&
    typeof pairing.csrfToken === "string" &&
    pairing.csrfToken.length >= 32 &&
    Array.isArray(pairing.capabilities) &&
    Number.isFinite(expiresAt) &&
    expiresAt > now + EXPIRY_SAFETY_MARGIN_MS;
}

export function isPairingSessionValid(
  pairing: unknown,
  now = Date.now(),
): pairing is PairResponse {
  return isValidPairing(pairing, now);
}

export function readPairingSession(
  storage: PairingStorage | undefined,
  now = Date.now(),
): PairResponse | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(PAIRING_SESSION_STORAGE_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (isValidPairing(value, now)) return value;
    storage.removeItem(PAIRING_SESSION_STORAGE_KEY);
  } catch {
    try {
      storage.removeItem(PAIRING_SESSION_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in privacy-restricted Office webviews.
    }
  }
  return undefined;
}

export function writePairingSession(
  storage: PairingStorage | undefined,
  pairing: PairResponse,
  now = Date.now(),
): boolean {
  if (!storage || !isValidPairing(pairing, now)) return false;
  try {
    storage.setItem(PAIRING_SESSION_STORAGE_KEY, JSON.stringify(pairing));
    return true;
  } catch {
    return false;
  }
}

export function clearPairingSession(storage: PairingStorage | undefined): void {
  try {
    storage?.removeItem(PAIRING_SESSION_STORAGE_KEY);
  } catch {
    // The in-memory session is still cleared by RuntimeClient.
  }
}

export function browserPairingStorage(): PairingStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
