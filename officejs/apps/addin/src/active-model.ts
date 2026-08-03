import type { ProviderSettingsView } from "./contracts";

export interface ActiveModelIdentity {
  model: string;
  provider: string;
}

export function formatActiveModelLabel(model: string, provider: string): string {
  return [model.trim(), provider.trim()].filter(Boolean).join(" · ");
}

export function activeModelFromSettings(
  settings: ProviderSettingsView,
): ActiveModelIdentity | null {
  const active = settings.profiles.find(
    (profile) => profile.id === settings.activeProviderId,
  );
  if (!active?.model.trim()) return null;
  return {
    model: active.model.trim(),
    provider: (active.name || active.type).trim(),
  };
}
