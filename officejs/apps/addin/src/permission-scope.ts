function canonicalize(value: unknown): unknown {
  if (value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return String(value);
}

const SENSITIVE_FIELD_PATTERN =
  /(?:^|[-_])(api[-_]?key|authorization|cookie|credential|password|secret|token)(?:$|[-_])/iu;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_FIELD_PATTERN.test(key) ? "[redacted]" : redact(item),
      ]),
    );
  }
  return value;
}

export function buildPermissionScopeKey(name: string, params: unknown): string {
  return `${name}\n${JSON.stringify(canonicalize(params))}`;
}

export function formatPermissionParams(params: unknown): string {
  return JSON.stringify(redact(params), null, 2);
}
