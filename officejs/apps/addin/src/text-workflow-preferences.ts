export interface TextWorkflowPreference {
  defaultPresetId: string;
  autoApply: boolean;
}

export type TextWorkflowPreferences = Record<string, TextWorkflowPreference>;

export const TEXT_WORKFLOW_PREFERENCES_STORAGE_KEY = "wordollama-text-workflow-preferences-v1";

export function loadTextWorkflowPreferences(
  storage: Pick<Storage, "getItem">,
): TextWorkflowPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(TEXT_WORKFLOW_PREFERENCES_STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => {
      const item = value as Partial<TextWorkflowPreference>;
      return [key, {
        defaultPresetId: String(item.defaultPresetId ?? "builtin"),
        autoApply: item.autoApply === true,
      }];
    }));
  } catch {
    return {};
  }
}

export function saveTextWorkflowPreferences(
  storage: Pick<Storage, "setItem">,
  preferences: TextWorkflowPreferences,
): void {
  storage.setItem(TEXT_WORKFLOW_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export function workflowPreference(
  preferences: TextWorkflowPreferences,
  workflowKey: string,
): TextWorkflowPreference {
  return preferences[workflowKey] ?? { defaultPresetId: "builtin", autoApply: false };
}
