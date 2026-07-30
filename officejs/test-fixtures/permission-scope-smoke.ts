import {
  buildPermissionScopeKey,
  formatPermissionParams,
} from "../apps/addin/src/permission-scope.ts";

const first = buildPermissionScopeKey("execute_command", {
  executable: "git",
  arguments: ["status", "--short"],
  options: { timeout: 10, workingDirectory: "C:\\repo" },
});
const reordered = buildPermissionScopeKey("execute_command", {
  options: { workingDirectory: "C:\\repo", timeout: 10 },
  arguments: ["status", "--short"],
  executable: "git",
});
if (first !== reordered) {
  throw new Error("Equivalent permission parameters did not produce a stable scope.");
}

const changedArguments = buildPermissionScopeKey("execute_command", {
  executable: "git",
  arguments: ["push"],
  options: { timeout: 10, workingDirectory: "C:\\repo" },
});
if (first === changedArguments) {
  throw new Error("Different command arguments reused a permission scope.");
}

const changedTool = buildPermissionScopeKey("http_request", {
  executable: "git",
  arguments: ["status", "--short"],
  options: { timeout: 10, workingDirectory: "C:\\repo" },
});
if (first === changedTool) {
  throw new Error("Different tools reused a permission scope.");
}

const redacted = formatPermissionParams({
  url: "https://example.test",
  headers: {
    Authorization: "Bearer visible-secret",
    "X-API-Key": "visible-api-key",
    Accept: "application/json",
  },
  password: "visible-password",
});
for (const secret of ["visible-secret", "visible-api-key", "visible-password"]) {
  if (redacted.includes(secret)) {
    throw new Error(`Permission UI exposed sensitive value: ${secret}.`);
  }
}
if (!redacted.includes("application/json") || !redacted.includes("[redacted]")) {
  throw new Error("Permission UI redaction removed safe context or omitted its marker.");
}

console.log("Office.js Agent permission scope smoke passed.");
