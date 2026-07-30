import type { UpdateCheckResult } from "../apps/addin/src/contracts.ts";
import {
  classifyUpdateResult,
  type UpdateStatusKind,
} from "../apps/addin/src/settings/update-status.ts";

function result(
  overrides: Partial<UpdateCheckResult>,
): UpdateCheckResult {
  return {
    configured: true,
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    updateAvailable: true,
    runtime: "win-x64",
    ...overrides,
  };
}

function assertStatus(
  value: UpdateCheckResult,
  expected: UpdateStatusKind,
): void {
  const actual = classifyUpdateResult(value);
  if (actual !== expected) {
    throw new Error(`Expected update status '${expected}', received '${actual}'.`);
  }
}

assertStatus(result({ configured: false, updateAvailable: false }), "not-configured");
assertStatus(result({ artifact: undefined }), "missing-artifact");
assertStatus(result({
  artifact: {
    kind: "installer",
    runtime: "win-x64",
    url: "https://updates.example.test/WordOllama-Installer.exe",
    sha256: "a".repeat(64),
    sizeBytes: 123,
  },
}), "available");
assertStatus(result({
  latestVersion: "1.0.0",
  updateAvailable: false,
}), "current");

console.log("Office.js update status smoke passed.");
