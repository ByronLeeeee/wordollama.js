import type { RuntimeClient } from "./runtime-client";
import i18n from "./i18n.ts";
import { streamText, type TextStreamUpdate } from "./stream-text.ts";

export interface TextWorkflowDefinition {
  key: string;
  title: string;
  description: string;
  defaultInstruction: string;
  systemPrompt: string;
  defaultScope: "selection" | "document" | "none";
  supportsAutoApply: boolean;
  preferredAction?: "replace" | "insert" | "comment";
}

export type TextWorkflowOutputMode =
  "InsertBelow" | "InsertBelowWithDiff" | "ReplaceOriginal" | "Comment" | "ReviewPane";

const MAX_SOURCE_CHARACTERS = 100_000;
const REVIEW_PANE_CHARACTER_THRESHOLD = 4_000;
const REVIEW_PANE_PARAGRAPH_THRESHOLD = 8;
const OUTPUT_PREFERENCE_WORKFLOWS = new Set([
  "writing", "modify", "polish", "expand", "simplify", "continue", "summarize", "fix",
]);

export function resolveTextWorkflowOutputPreference(
  definition: TextWorkflowDefinition,
  outputPreference: string,
): string {
  return OUTPUT_PREFERENCE_WORKFLOWS.has(definition.key) ? outputPreference.trim() : "";
}

export function resolveTextWorkflowOutputMode(
  configuredMode: string,
  definition: TextWorkflowDefinition,
  source: string,
  sourceScope: "selection" | "document" | "none" = definition.defaultScope,
): TextWorkflowOutputMode {
  if (definition.preferredAction === "comment") return "Comment";
  if ([
    "InsertBelow",
    "InsertBelowWithDiff",
    "ReplaceOriginal",
    "Comment",
    "ReviewPane",
  ].includes(configuredMode)) {
    const explicitMode = configuredMode as TextWorkflowOutputMode;
    return sourceScope !== "selection" &&
      (explicitMode === "ReplaceOriginal" ||
        explicitMode === "Comment" ||
        explicitMode === "ReviewPane")
      ? "InsertBelow"
      : explicitMode;
  }
  const paragraphCount = source
    .split(/\r?\n/)
    .filter((line) => line.trim()).length;
  return sourceScope === "selection" &&
    source.trim() &&
    (source.length >= REVIEW_PANE_CHARACTER_THRESHOLD ||
      paragraphCount >= REVIEW_PANE_PARAGRAPH_THRESHOLD)
    ? "ReviewPane"
    : "InsertBelow";
}


function localizedWorkflow(
  key: string,
  resourceKey: string,
  defaultScope: TextWorkflowDefinition["defaultScope"],
  supportsAutoApply = false,
  preferredAction?: TextWorkflowDefinition["preferredAction"],
): TextWorkflowDefinition {
  const path = `taskpane.workflows.${resourceKey}`;
  return {
    key,
    get title() { return i18n.t(`${path}.title`); },
    get description() { return i18n.t(`${path}.description`); },
    get defaultInstruction() { return i18n.t(`${path}.defaultInstruction`); },
    get systemPrompt() { return i18n.t(`${path}.systemPrompt`); },
    defaultScope,
    supportsAutoApply,
    preferredAction,
  };
}

export const TEXT_WORKFLOWS: Record<string, TextWorkflowDefinition> = {
  writing: localizedWorkflow("writing", "writing", "none"),
  modify: localizedWorkflow("modify", "modify", "selection", true),
  polish: localizedWorkflow("polish", "polish", "selection", true),
  expand: localizedWorkflow("expand", "expand", "selection", true),
  simplify: localizedWorkflow("simplify", "simplify", "selection", true),
  continue: localizedWorkflow("continue", "continue", "selection", true, "insert"),
  summarize: localizedWorkflow("summarize", "summarize", "selection", true, "replace"),
  fix: localizedWorkflow("fix", "fix", "selection", true),
  translate: localizedWorkflow("translate", "translate", "selection"),
  "translate-zh": localizedWorkflow("translate-zh", "translateZh", "selection"),
  "translate-en": localizedWorkflow("translate-en", "translateEn", "selection"),
  fairness: localizedWorkflow("fairness", "fairness", "selection", true, "replace"),
  risk: localizedWorkflow("risk", "risk", "selection", true, "comment"),
};

export async function generateTextWorkflow(
  runtime: RuntimeClient,
  definition: TextWorkflowDefinition,
  source: string,
  scopeLabel: string,
  instruction: string,
  outputLanguage: string,
  writingProfile: string,
  signal?: AbortSignal,
  onUpdate?: TextStreamUpdate,
): Promise<string> {
  const boundedSource = source.length > MAX_SOURCE_CHARACTERS
    ? i18n.t("taskpane.textWorkflowModel.truncatedSource", {
        source: source.slice(0, MAX_SOURCE_CHARACTERS),
        max: MAX_SOURCE_CHARACTERS,
        interpolation: { escapeValue: false },
      })
    : source;
  const result = await streamText(runtime, [
    {
      role: "system",
      content: i18n.t("taskpane.textWorkflowModel.systemMessage", {
        systemPrompt: definition.systemPrompt,
        outputLanguage: outputLanguage || i18n.t("taskpane.textWorkflowModel.followSource"),
        interpolation: { escapeValue: false },
      }),
    },
    {
      role: "user",
      content: i18n.t("taskpane.textWorkflowModel.userMessage", {
        workflow: definition.title,
        scope: scopeLabel || i18n.t("taskpane.textWorkflowModel.noSource"),
        instruction: instruction || definition.defaultInstruction,
        profile: writingProfile || i18n.t("taskpane.textWorkflowModel.noProfile"),
        source: boundedSource
          ? i18n.t("taskpane.textWorkflowModel.source", {
              source: boundedSource,
              interpolation: { escapeValue: false },
            })
          : "",
        interpolation: { escapeValue: false },
      }),
    },
  ], signal, onUpdate);
  if (!result) throw new Error(i18n.t("taskpane.textWorkflowModel.emptyResult"));
  return result;
}
