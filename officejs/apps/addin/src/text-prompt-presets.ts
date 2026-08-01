export interface TextPromptPreset {
  id: string;
  workflowKey: string;
  name: string;
  instruction: string;
}

export const TEXT_PROMPT_PRESETS_STORAGE_KEY = "wordollama-text-prompt-presets-v1";

function normalizePreset(value: Partial<TextPromptPreset>): TextPromptPreset | null {
  const id = String(value.id ?? "").trim();
  const workflowKey = String(value.workflowKey ?? "").trim();
  const name = String(value.name ?? "").trim();
  const instruction = String(value.instruction ?? "").trim();
  if (!id || !workflowKey || !name || !instruction) return null;
  return { id, workflowKey, name, instruction };
}

export function loadTextPromptPresets(storage: Pick<Storage, "getItem">): TextPromptPreset[] {
  try {
    const raw = storage.getItem(TEXT_PROMPT_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizePreset(item as Partial<TextPromptPreset>))
      .filter((item): item is TextPromptPreset => item !== null);
  } catch {
    return [];
  }
}

export function saveTextPromptPresets(
  storage: Pick<Storage, "setItem">,
  presets: TextPromptPreset[],
): TextPromptPreset[] {
  const normalized = presets
    .map((item) => normalizePreset(item))
    .filter((item): item is TextPromptPreset => item !== null);
  storage.setItem(TEXT_PROMPT_PRESETS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function createTextPromptPreset(
  workflowKey: string,
  name: string,
  instruction: string,
): TextPromptPreset {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    workflowKey: workflowKey.trim(),
    name: name.trim(),
    instruction: instruction.trim(),
  };
}
