import i18n from "./i18n";
import type { OfficeJsWordAdapter } from "./officejs-word-adapter";
import type { RuntimeClient } from "./runtime-client";
import {
  languageDisplayName,
  resolveLanguageCode,
  TRANSLATION_LANGUAGE_CODES,
  translationLanguageOptions,
  type SourceLanguageCode,
  type TranslationLanguageCode,
} from "./translation-languages";
import { generateTranslation } from "./translation-workflow";
import {
  beginStreamingText,
  endStreamingText,
  updateStreamingText,
} from "./streaming-ui";

type TranslationWordAdapter = Pick<
  OfficeJsWordAdapter,
  "getSelection" | "replaceSelection" | "insertAfterSelection" | "insertAtCursor"
>;

export interface TranslationWorkspaceController {
  open(): Promise<void>;
  close(): void;
}

interface TranslationWorkspaceDependencies {
  runtime: RuntimeClient;
  word: TranslationWordAdapter;
  showError(error: unknown): void;
  clearError(): void;
  refreshRuntimeStatus(): Promise<void>;
  showWorkspace(): void;
  closeWorkspace(): void;
}

const RECENT_LANGUAGES_KEY = "wordollama-recent-translation-languages";
const MAX_RECENT_LANGUAGES = 8;

function element<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing translation element: ${selector}`);
  return value;
}

function normalizeSelection(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readRecentLanguages(): TranslationLanguageCode[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_LANGUAGES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is TranslationLanguageCode =>
          TRANSLATION_LANGUAGE_CODES.includes(value as TranslationLanguageCode))
      : [];
  } catch {
    return [];
  }
}

export function initializeTranslationWorkspace(
  dependencies: TranslationWorkspaceDependencies,
): TranslationWorkspaceController {
  const sourceLanguage = element<HTMLInputElement>("#translation-source-language");
  const targetLanguage = element<HTMLInputElement>("#translation-target-language");
  const sourceLanguageOptions = element<HTMLDataListElement>(
    "#translation-source-language-options",
  );
  const targetLanguageOptions = element<HTMLDataListElement>(
    "#translation-target-language-options",
  );
  const source = element<HTMLTextAreaElement>("#translation-source");
  const result = element<HTMLTextAreaElement>("#translation-result");
  const instructions = element<HTMLInputElement>("#translation-instructions");
  const sourceCount = element<HTMLElement>("#translation-source-count");
  const resultCount = element<HTMLElement>("#translation-result-count");
  const selectionStatus = element<HTMLElement>("#translation-selection-status");
  const actionStatus = element<HTMLElement>("#translation-action-status");
  const runButton = element<HTMLButtonElement>("#translation-run");
  const cancelButton = element<HTMLButtonElement>("#translation-cancel");
  const replaceButton = element<HTMLButtonElement>("#translation-replace");
  const insertButton = element<HTMLButtonElement>("#translation-insert");
  const copyButton = element<HTMLButtonElement>("#translation-copy");
  let linkedSelection = "";
  let abortController: AbortController | null = null;
  let recentLanguages = readRecentLanguages();

  const getSourceLanguage = (): SourceLanguageCode | null =>
    resolveLanguageCode(sourceLanguage.value, true);
  const getTargetLanguage = (): TranslationLanguageCode | null => {
    const value = resolveLanguageCode(targetLanguage.value, false);
    return value && value !== "auto" ? value : null;
  };
  const setLanguage = (
    input: HTMLInputElement,
    code: SourceLanguageCode,
  ) => {
    input.dataset.languageCode = code;
    input.value = languageDisplayName(code);
  };
  const fillOptions = (
    list: HTMLDataListElement,
    includeAdaptive: boolean,
  ) => {
    list.replaceChildren(...translationLanguageOptions(recentLanguages, includeAdaptive)
      .map(({ code, label }) => {
        const option = document.createElement("option");
        option.value = label;
        option.label = code === "auto" ? label : `${label} · ${code}`;
        option.dataset.languageCode = code;
        return option;
      }));
  };
  const renderLanguageOptions = () => {
    fillOptions(sourceLanguageOptions, true);
    fillOptions(targetLanguageOptions, false);
  };
  const rememberLanguages = (
    sourceCode: SourceLanguageCode,
    targetCode: TranslationLanguageCode,
  ) => {
    recentLanguages = [
      targetCode,
      ...(sourceCode === "auto" ? [] : [sourceCode]),
      ...recentLanguages,
    ].filter((code, index, values) => values.indexOf(code) === index)
      .slice(0, MAX_RECENT_LANGUAGES);
    localStorage.setItem(RECENT_LANGUAGES_KEY, JSON.stringify(recentLanguages));
    renderLanguageOptions();
  };

  const updateState = () => {
    sourceCount.textContent = String(source.value.length);
    resultCount.textContent = String(result.value.length);
    const hasSource = Boolean(source.value.trim());
    const hasLanguages = Boolean(getSourceLanguage() && getTargetLanguage());
    const hasResult = Boolean(result.value.trim()) && abortController === null;
    runButton.disabled = !hasSource || !hasLanguages || abortController !== null;
    replaceButton.disabled = !hasResult || !linkedSelection;
    insertButton.disabled = !hasResult;
    copyButton.disabled = !hasResult;
  };

  const setLinkedSelection = (value: string) => {
    linkedSelection = value;
    selectionStatus.textContent = value
      ? i18n.t("taskpane.translation.selectionLinked", { count: value.length })
      : "";
    updateState();
  };

  const loadSelection = async (silent = false) => {
    try {
      const selection = await dependencies.word.getSelection();
      if (!selection.text.trim()) {
        setLinkedSelection("");
        if (!silent) throw new Error(i18n.t("taskpane.errors.selectionEmpty"));
        return;
      }
      source.value = selection.text;
      setLinkedSelection(selection.text);
    } catch (error) {
      setLinkedSelection("");
      if (!silent && (error as Error).message !== "Word is not defined") {
        dependencies.showError(error);
      }
    }
  };

  const assertSelectionUnchanged = async () => {
    if (!linkedSelection) {
      throw new Error(i18n.t("taskpane.translation.errors.selectionRequired"));
    }
    const current = await dependencies.word.getSelection();
    if (normalizeSelection(current.text) !== normalizeSelection(linkedSelection)) {
      throw new Error(i18n.t("taskpane.errors.selectionChanged"));
    }
  };

  renderLanguageOptions();
  setLanguage(sourceLanguage, "auto");
  setLanguage(targetLanguage, i18n.resolvedLanguage === "zh-CN" ? "en" : "zh-CN");

  element<HTMLButtonElement>("#translation-load-selection").addEventListener("click", () => {
    dependencies.clearError();
    void loadSelection();
  });
  element<HTMLButtonElement>("#translation-clear").addEventListener("click", () => {
    source.value = "";
    result.value = "";
    instructions.value = "";
    actionStatus.textContent = "";
    setLinkedSelection("");
    source.focus();
  });
  element<HTMLButtonElement>("#translation-swap-languages").addEventListener("click", () => {
    const previousSource = getSourceLanguage();
    const previousTarget = getTargetLanguage();
    if (!previousSource || !previousTarget) return;
    setLanguage(sourceLanguage, previousTarget);
    setLanguage(
      targetLanguage,
      previousSource === "auto"
        ? (previousTarget === "zh-CN" ? "en" : "zh-CN")
        : previousSource,
    );
    if (result.value.trim()) {
      const previousSourceText = source.value;
      source.value = result.value;
      result.value = previousSourceText;
      setLinkedSelection("");
    }
    updateState();
  });
  for (const input of [sourceLanguage, targetLanguage]) {
    input.addEventListener("input", () => {
      const code = resolveLanguageCode(input.value, input === sourceLanguage);
      input.dataset.languageCode = code ?? "";
      updateState();
    });
    input.addEventListener("focus", () => input.select());
  }
  source.addEventListener("input", updateState);
  result.addEventListener("input", updateState);

  runButton.addEventListener("click", async () => {
    const sourceLanguageValue = getSourceLanguage();
    const targetLanguageValue = getTargetLanguage();
    if (!sourceLanguageValue || !targetLanguageValue) {
      dependencies.showError(new Error(i18n.t("taskpane.translation.errors.languageInvalid")));
      return;
    }
    dependencies.clearError();
    actionStatus.textContent = i18n.t("taskpane.translation.translating");
    abortController = new AbortController();
    cancelButton.disabled = false;
    beginStreamingText(result);
    updateState();
    try {
      const finalResult = await generateTranslation(dependencies.runtime, {
        source: source.value,
        sourceLanguage: sourceLanguageValue,
        targetLanguage: targetLanguageValue,
        instructions: instructions.value,
      }, abortController.signal, (content) => {
        updateStreamingText(result, content);
        updateState();
      });
      endStreamingText(result, finalResult);
      rememberLanguages(sourceLanguageValue, targetLanguageValue);
      await dependencies.refreshRuntimeStatus();
      actionStatus.textContent = i18n.t("taskpane.translation.completed");
    } catch (error) {
      endStreamingText(result);
      if ((error as { name?: string }).name === "AbortError") {
        actionStatus.textContent = i18n.t("taskpane.status.cancelled");
      } else {
        dependencies.showError(error);
        actionStatus.textContent = "";
      }
    } finally {
      endStreamingText(result);
      abortController = null;
      cancelButton.disabled = true;
      updateState();
    }
  });
  cancelButton.addEventListener("click", () => abortController?.abort());
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(result.value);
      actionStatus.textContent = i18n.t("taskpane.translation.copied");
    } catch (error) {
      dependencies.showError(error);
    }
  });
  replaceButton.addEventListener("click", async () => {
    try {
      await assertSelectionUnchanged();
      await dependencies.word.replaceSelection(result.value);
      actionStatus.textContent = i18n.t("taskpane.translation.replaced");
      setLinkedSelection("");
    } catch (error) {
      dependencies.showError(error);
    }
  });
  insertButton.addEventListener("click", async () => {
    try {
      if (linkedSelection) {
        await assertSelectionUnchanged();
        await dependencies.word.insertAfterSelection(`\n${result.value}`);
      } else {
        await dependencies.word.insertAtCursor(result.value);
      }
      actionStatus.textContent = i18n.t("taskpane.translation.inserted");
    } catch (error) {
      dependencies.showError(error);
    }
  });
  element<HTMLButtonElement>("#close-translation-workspace").addEventListener("click", () => {
    abortController?.abort();
    dependencies.closeWorkspace();
  });
  i18n.on("languageChanged", () => {
    const sourceCode = getSourceLanguage() ?? "auto";
    const targetCode = getTargetLanguage() ??
      (i18n.resolvedLanguage === "zh-CN" ? "en" : "zh-CN");
    renderLanguageOptions();
    setLanguage(sourceLanguage, sourceCode);
    setLanguage(targetLanguage, targetCode);
    updateState();
  });

  updateState();

  return {
    async open() {
      abortController?.abort();
      result.value = "";
      actionStatus.textContent = "";
      setLanguage(sourceLanguage, "auto");
      if (!getTargetLanguage()) {
        setLanguage(targetLanguage, i18n.resolvedLanguage === "zh-CN" ? "en" : "zh-CN");
      }
      dependencies.showWorkspace();
      await loadSelection(true);
      updateState();
      source.focus();
    },
    close() {
      abortController?.abort();
      dependencies.closeWorkspace();
    },
  };
}
