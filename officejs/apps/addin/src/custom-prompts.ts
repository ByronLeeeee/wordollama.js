import type { RuntimeClient } from "./runtime-client";
import i18n from "./i18n.ts";
import { streamText, type TextStreamUpdate } from "./stream-text.ts";

export type CustomPromptOutputMode = "Insert" | "TrackedChanges" | "Comment";

export interface CustomPromptDefinition {
  id: string;
  name: string;
  prompt: string;
  outputMode: CustomPromptOutputMode;
  favorite?: boolean;
  lastUsedAt?: string;
  /** Kept for migration from the former fixed Ribbon shortcut slots. */
  quickSlot?: 1 | 2 | 3 | 4;
}

const STORAGE_KEY = "wordollama-custom-prompts";
const MAX_PROMPTS = 50;
const MAX_PROMPT_LENGTH = 20_000;

export function loadCustomPrompts(storage: Storage): CustomPromptDefinition[] {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CustomPromptDefinition => {
      if (!item || typeof item !== "object") return false;
      const prompt = item as CustomPromptDefinition;
      return typeof prompt.id === "string" &&
        typeof prompt.name === "string" &&
        typeof prompt.prompt === "string" &&
        ["Insert", "TrackedChanges", "Comment"].includes(prompt.outputMode);
    }).slice(0, MAX_PROMPTS).map((prompt) => ({
      id: prompt.id,
      name: prompt.name,
      prompt: prompt.prompt,
      outputMode: prompt.outputMode,
      favorite: prompt.favorite === true || Boolean(prompt.quickSlot),
      lastUsedAt: typeof prompt.lastUsedAt === "string" ? prompt.lastUsedAt : undefined,
    }));
  } catch {
    return [];
  }
}

export function saveCustomPrompts(storage: Storage, prompts: CustomPromptDefinition[]): void {
  if (prompts.length > MAX_PROMPTS) {
    throw new Error(i18n.t("taskpane.prompts.errors.maxCount", { count: MAX_PROMPTS }));
  }
  const names = new Set<string>();
  for (const prompt of prompts) {
    if (!prompt || typeof prompt !== "object" || typeof prompt.id !== "string" ||
      typeof prompt.name !== "string" || typeof prompt.prompt !== "string" ||
      !["Insert", "TrackedChanges", "Comment"].includes(prompt.outputMode)) {
      throw new Error(i18n.t("taskpane.prompts.errors.invalidImport"));
    }
    const normalizedName = prompt.name.trim().toLocaleLowerCase();
    if (!normalizedName || prompt.name.length > 80) {
      throw new Error(i18n.t("taskpane.prompts.errors.invalidName"));
    }
    if (names.has(normalizedName)) {
      throw new Error(i18n.t("taskpane.prompts.errors.duplicateName", { name: prompt.name }));
    }
    names.add(normalizedName);
    if (!prompt.prompt.trim() || prompt.prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(i18n.t("taskpane.prompts.errors.invalidBody", {
        name: prompt.name,
        max: MAX_PROMPT_LENGTH,
      }));
    }
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(prompts.map((prompt) => ({
    id: prompt.id,
    name: prompt.name,
    prompt: prompt.prompt,
    outputMode: prompt.outputMode,
    favorite: prompt.favorite === true,
    lastUsedAt: prompt.lastUsedAt,
  }))));
}

export async function runCustomPrompt(
  runtime: RuntimeClient,
  definition: CustomPromptDefinition,
  selectedText: string,
  signal?: AbortSignal,
  onUpdate?: TextStreamUpdate,
): Promise<string> {
  if (!selectedText.trim()) throw new Error(i18n.t("taskpane.prompts.errors.selectText"));
  const result = await streamText(runtime, [
    {
      role: "system",
      content: [
        i18n.t("taskpane.prompts.model.systemApply"),
        i18n.t("taskpane.prompts.model.systemPreserve"),
        definition.outputMode === "Comment"
          ? i18n.t("taskpane.prompts.model.returnComment")
          : i18n.t("taskpane.prompts.model.returnDocument"),
      ].join("\n"),
    },
    {
      role: "user",
      content: i18n.t("taskpane.prompts.model.userMessage", {
        instruction: definition.prompt,
        selection: selectedText.slice(0, 100_000),
        interpolation: { escapeValue: false },
      }),
    },
  ], signal, onUpdate);
  if (!result) throw new Error(i18n.t("taskpane.prompts.errors.emptyResult"));
  return result;
}
