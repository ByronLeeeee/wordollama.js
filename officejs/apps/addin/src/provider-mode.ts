import type {
  ProviderProfileView,
  ProviderSettingsView,
} from "./contracts.ts";

export type AiMode = "ollama" | "online";

export interface ProviderModeSelection {
  active?: ProviderProfileView;
  candidate?: ProviderProfileView;
}

export function selectProviderForAiMode(
  view: ProviderSettingsView,
  requestedMode: string,
  selectedProviderId = "",
): ProviderModeSelection {
  const mode: AiMode = requestedMode === "ollama" ? "ollama" : "online";
  const matchesMode = (profile: ProviderProfileView): boolean =>
    (profile.type.toLowerCase() === "ollama") === (mode === "ollama");
  const active = view.profiles.find((profile) => profile.id === view.activeProviderId);
  if (active && matchesMode(active)) return { active, candidate: active };
  const selected = view.profiles.find((profile) =>
    profile.id === selectedProviderId && matchesMode(profile));
  return {
    active,
    candidate: selected ?? view.profiles.find(matchesMode),
  };
}
