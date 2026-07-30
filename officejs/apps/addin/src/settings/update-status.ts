import type { UpdateCheckResult } from "../contracts";

export type UpdateStatusKind =
  | "not-configured"
  | "missing-artifact"
  | "available"
  | "current";

export function classifyUpdateResult(result: UpdateCheckResult): UpdateStatusKind {
  if (!result.configured) return "not-configured";
  if (result.updateAvailable && !result.artifact) return "missing-artifact";
  return result.updateAvailable ? "available" : "current";
}
