import type { PairResponse } from "../apps/addin/src/contracts.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  csrfToken: "b".repeat(44),
  expiresAt: new Date(now + 8 * 60 * 60 * 1000).toISOString(),
  capabilities: ["agent", "settings"],
};
const storage = new MemoryStorage();
const cookiePairing: PairResponse = {
  ...validPairing,
  sessionToken: "",
  cookieSession: true,
};

if (!isPairingSessionValid(validPairing, now)) {
  throw new Error("A valid Bridge pairing session was rejected.");
}
if (!writePairingSession(storage, validPairing, now)) {
  throw new Error("A valid Bridge pairing session was not stored.");
}
if (readPairingSession(storage, now)?.sessionToken !== validPairing.sessionToken) {
  throw new Error("A stored Bridge pairing session was not restored.");
}

if (!isPairingSessionValid(cookiePairing, now) ||
    !writePairingSession(storage, cookiePairing, now) ||
    readPairingSession(storage, now)?.cookieSession !== true) {
  throw new Error("A valid HttpOnly cookie session was rejected.");
}
const storedCookieSession = storage.getItem(PAIRING_SESSION_STORAGE_KEY) ?? "";
if (storedCookieSession.includes(validPairing.sessionToken)) {
  throw new Error("HttpOnly cookie mode leaked a bearer token to WebView storage.");
}
const secondPane = readPairingSession(storage, now);
if (!secondPane?.cookieSession || secondPane.csrfToken !== cookiePairing.csrfToken) {
  throw new Error("A second task pane could not reuse the shared cookie-session metadata.");
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
if (isPairingSessionValid({ ...cookiePairing, cookieSession: false }, now)) {
  throw new Error("An empty header-mode session token was accepted.");
}
if (isPairingSessionValid({ ...validPairing, csrfToken: "short" }, now)) {
  throw new Error("A malformed Bridge CSRF token was accepted.");
}

writePairingSession(storage, validPairing, now);
clearPairingSession(storage);
if (storage.getItem(PAIRING_SESSION_STORAGE_KEY) !== null) {
  throw new Error("Bridge pairing session cleanup failed.");
}

const repoRoot = resolve(import.meta.dirname, "../..");
const runtimeClient = readFileSync(resolve(repoRoot, "officejs/apps/addin/src/runtime-client.ts"), "utf8");
const bridgeProgram = readFileSync(resolve(repoRoot, "src/WordOllama.DesktopBridge/Program.cs"), "utf8");
if (!runtimeClient.includes('headers.delete("X-WordOllama-Session")') ||
    !runtimeClient.includes("HTTP_ONLY_COOKIE_SESSION") ||
    !runtimeClient.includes("if (response.status === 401) this.clearPairing()")) {
  throw new Error("RuntimeClient does not keep the bearer token out of JS or recover from Bridge restart/session expiry.");
}
if (!bridgeProgram.includes("CookieSession: isSameOrigin") ||
    !bridgeProgram.includes("!isSameOrigin && !environment.IsDevelopment()") ||
    !bridgeProgram.includes("frame-ancestors 'self'") ||
    !bridgeProgram.includes("Request.Cookies.TryGetValue")) {
  throw new Error("Bridge same-origin cookie, origin-spoofing, or Office-compatible frame policy is missing.");
}

console.log("Office.js shared HttpOnly pairing session smoke passed (expiry, restart recovery, multi-pane and frame/origin policy).");
