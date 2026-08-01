import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const addinRoot = resolve(repoRoot, "officejs/apps/addin");
const htmlFiles = ["index.html", "settings.html", "commands.html"];
const officeJsCdn = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

for (const name of htmlFiles) {
  const html = readFileSync(resolve(addinRoot, name), "utf8");
  const remoteReferences = [...html.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)/gi)]
    .map((match) => match[1]);
  assert(
    remoteReferences.length === 1 && remoteReferences[0] === officeJsCdn,
    `${name} must have no remote bootstrap dependency except Microsoft's required Office.js CDN`,
  );
}

const contracts = readFileSync(resolve(addinRoot, "src/contracts.ts"), "utf8");
const packaging = readFileSync(resolve(repoRoot, "packaging/package-addin.ps1"), "utf8");
assert(
    contracts.includes("__WORDOLLAMA_BRIDGE_URL__") &&
    contracts.includes('"http://127.0.0.1:37421"') &&
    packaging.includes('[string]$BridgeUrl = "https://localhost:37421"') &&
    packaging.includes("$env:WORDOLLAMA_BRIDGE_URL = $productionBridgeUrl"),
  "production packaging must compile the runtime client against the local HTTPS Bridge and keep only a loopback development fallback",
);

const settings = readFileSync(resolve(addinRoot, "src/settings/SettingsApp.tsx"), "utf8");
for (const endpoint of [
  "http://127.0.0.1:11434",
  "http://127.0.0.1:1234/v1",
  "http://127.0.0.1:8000/v1",
  "http://127.0.0.1:8080/v1",
]) {
  assert(settings.includes(endpoint), `local provider preset is missing: ${endpoint}`);
}

console.log("Offline product boundary smoke passed: all product assets are local; only the required Office.js CDN bootstrap remains remote.");
