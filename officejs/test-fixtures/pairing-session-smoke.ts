import type { PairResponse } from "../apps/addin/src/contracts.ts";
import {
  PAIRING_SESSION_STORAGE_KEY,
  clearPairingSession,
  isPairingSessionValid,
  readPairingSession,
  writePairingSession,
  type PairingStorage,
} from "../apps/addin/src/pairing-session.ts";

class MemoryStorage implements PairingStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const now = Date.parse("2026-07-30T08:00:00.000Z");
const validPairing: PairResponse = {
  protocolVersion: "1.0",
  sessionToken: "a".repeat(44),
  expiresAt: new Date(now + 8 * 60 * 60 * 1000).toISOString(),
  capabilities: ["agent", "settings"],
};
const storage = new MemoryStorage();

if (!isPairingSessionValid(validPairing, now)) {
  throw new Error("A valid Bridge pairing session was rejected.");
}
if (!writePairingSession(storage, validPairing, now)) {
  throw new Error("A valid Bridge pairing session was not stored.");
}
if (readPairingSession(storage, now)?.sessionToken !== validPairing.sessionToken) {
  throw new Error("A stored Bridge pairing session was not restored.");
}

storage.setItem(PAIRING_SESSION_STORAGE_KEY, JSON.stringify({
  ...validPairing,
  expiresAt: new Date(now + 20_000).toISOString(),
}));
if (readPairingSession(storage, now) !== undefined ||
    storage.getItem(PAIRING_SESSION_STORAGE_KEY) !== null) {
  throw new Error("An expiring Bridge pairing session was not discarded.");
}

storage.setItem(PAIRING_SESSION_STORAGE_KEY, "{not-json");
if (readPairingSession(storage, now) !== undefined ||
    storage.getItem(PAIRING_SESSION_STORAGE_KEY) !== null) {
  throw new Error("A malformed Bridge pairing session was not discarded.");
}

if (isPairingSessionValid({ ...validPairing, protocolVersion: "2.0" }, now)) {
  throw new Error("An incompatible Bridge protocol session was accepted.");
}
if (isPairingSessionValid({ ...validPairing, sessionToken: "short" }, now)) {
  throw new Error("A malformed Bridge session token was accepted.");
}

writePairingSession(storage, validPairing, now);
clearPairingSession(storage);
if (storage.getItem(PAIRING_SESSION_STORAGE_KEY) !== null) {
  throw new Error("Bridge pairing session cleanup failed.");
}

console.log("Office.js shared pairing session smoke passed.");
