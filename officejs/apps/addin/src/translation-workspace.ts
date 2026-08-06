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
import {
  createTextPromptPreset,
  loadTextPromptPresets,
  saveTextPromptPresets,
  type TextPromptPreset,
} from "./text-prompt-presets";

type TranslationWordAdapter = Pick<
  OfficeJsWordAdapter,
  "getSelection" | "replaceSelection" | "insertAfterSelection" | "insertAtCursor" | "applyPreciseRevision"
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
  const sourceLanguageOptions = element<HTMLDivElement>(
    "#translation-source-language-options",
  );
  const targetLanguageOptions = element<HTMLDivElement>(
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
  const retryButton = element<HTMLButtonElement>("#translation-retry");
  const preciseButton = element<HTMLButtonElement>("#translation-precise-revision");
  const copyButton = element<HTMLButtonElement>("#translation-copy");
  const promptSelect = element<HTMLSelectElement>("#translation-prompt-select");
  let linkedSelection = "";
  let abortController: AbortController | null = null;
  let recentLanguages = readRecentLanguages();
  let promptPresets: TextPromptPreset[] = loadTextPromptPresets(localStorage);

  const translationPrompts = () => promptPresets.filter((preset) => preset.workflowKey === "translate");
  const renderPromptSelect = (selectedId = "builtin") => {
    promptSelect.replaceChildren();
    const builtin = document.createElement("option");
    builtin.value = "builtin";
    builtin.textContent = i18n.t("taskpane.text.builtinPrompt");
    promptSelect.appendChild(builtin);
    for (const preset of translationPrompts()) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      promptSelect.appendChild(option);
    }
    promptSelect.value = Array.from(promptSelect.options).some((option) => option.value === selectedId)
      ? selectedId : "builtin";
  };
  const applySelectedPrompt = () => {
    instructions.value = promptPresets.find((preset) => preset.id === promptSelect.value)?.instruction ?? "";
  };
  const renderPromptList = () => {
    const list = element<HTMLUListElement>("#translation-prompt-list");
    list.replaceChildren();
    const presets = translationPrompts();
    if (!presets.length) {
      const empty = document.createElement("li");
      empty.className = "p-4 text-xs opacity-60 tracking-wide workflow-prompt-empty";
      empty.textContent = i18n.t("taskpane.text.noSavedPrompts");
      list.appendChild(empty);
      return;
    }
    for (const preset of presets) {
      const row = document.createElement("li");
      row.className = "list-row workflow-prompt-row";
      const content = document.createElement("div");
      content.className = "list-col-grow workflow-prompt-row-main";
      const title = document.createElement("strong");
      title.className = "font-semibold";
      title.textContent = preset.name;
      const detail = document.createElement("span");
      detail.className = "text-xs opacity-60 workflow-prompt-detail";
      detail.textContent = preset.instruction;
      content.append(title, detail);
      const edit = document.createElement("button");
      edit.className = "btn btn-square btn-ghost btn-xs";
      edit.type = "button";
      edit.title = i18n.t("taskpane.common.edit");
      edit.setAttribute("aria-label", edit.title);
      edit.innerHTML = '<svg class="size-[1em]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
      edit.addEventListener("click", () => {
        element<HTMLInputElement>("#translation-prompt-name").value = preset.name;
        element<HTMLTextAreaElement>("#translation-prompt-content").value = preset.instruction;
        element<HTMLButtonElement>("#translation-prompt-create").dataset.editId = preset.id;
      });
      const remove = document.createElement("button");
      remove.className = "btn btn-square btn-ghost btn-xs text-error";
      remove.type = "button";
      remove.title = i18n.t("taskpane.common.delete");
      remove.setAttribute("aria-label", remove.title);
      remove.innerHTML = '<svg class="size-[1em]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>';
      remove.addEventListener("click", () => {
        promptPresets = saveTextPromptPresets(localStorage, promptPresets.filter((item) => item.id !== preset.id));
        renderPromptSelect();
        renderPromptList();
      });
      row.append(content, edit, remove);
      list.appendChild(row);
    }
  };
  const openPromptDialog = () => {
    element<HTMLInputElement>("#translation-prompt-name").value = "";
    element<HTMLTextAreaElement>("#translation-prompt-content").value = "";
    delete element<HTMLButtonElement>("#translation-prompt-create").dataset.editId;
    renderPromptList();
    element<HTMLDialogElement>("#translation-prompt-dialog").showModal();
  };

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
    list: HTMLDivElement,
    input: HTMLInputElement,
    includeAdaptive: boolean,
    query = "",
  ) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const options = translationLanguageOptions(recentLanguages, includeAdaptive)
      .filter(({ code, label }) => !normalizedQuery ||
        code.toLocaleLowerCase().includes(normalizedQuery) ||
        label.toLocaleLowerCase().includes(normalizedQuery));
    list.replaceChildren(...options.map(({ code, label }) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "translation-language-option";
      option.dataset.languageCode = code;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(input.dataset.languageCode === code));
      const name = document.createElement("span");
      name.textContent = label;
      const languageCode = document.createElement("small");
      languageCode.textContent = code === "auto" ? "" : code;
      option.append(name, languageCode);
      const selectOption = () => {
        if (input.dataset.languageCode === code && input.value === label && list.hidden) return;
        setLanguage(input, code);
        list.hidden = true;
        input.setAttribute("aria-expanded", "false");
        updateState();
        input.focus();
      };
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectOption();
      });
      option.addEventListener("click", selectOption);
      return option;
    }));
  };
  const renderLanguageOptions = (input?: HTMLInputElement, query = "") => {
    if (!input || input === sourceLanguage) {
      fillOptions(sourceLanguageOptions, sourceLanguage, true, query);
    }
    if (!input || input === targetLanguage) {
      fillOptions(targetLanguageOptions, targetLanguage, false, query);
    }
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
    replaceButton.disabled = !hasResult;
    preciseButton.disabled = !hasResult;
    insertButton.disabled = !hasResult;
    retryButton.disabled = !hasSource || !hasLanguages || abortController !== null || !result.value.trim();
    copyButton.disabled = !hasResult;
  };

  const configureLanguageCombobox = (
    input: HTMLInputElement,
    list: HTMLDivElement,
    includeAdaptive: boolean,
  ) => {
    const showOptions = (query = "") => {
      renderLanguageOptions(input, query);
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    };
    const hideOptions = () => {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
    };
    input.addEventListener("focus", () => {
      input.select();
      showOptions();
    });
    input.addEventListener("click", () => showOptions(input.selectionStart === 0 &&
      input.selectionEnd === input.value.length ? "" : input.value));
    input.addEventListener("input", () => {
      const code = resolveLanguageCode(input.value, includeAdaptive);
      if (code) input.dataset.languageCode = code;
      showOptions(input.value);
      updateState();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hideOptions();
        return;
      }
      if (event.key === "Enter" || event.key === "ArrowDown") {
        const firstOption = list.querySelector<HTMLButtonElement>(".translation-language-option");
        if (!firstOption) return;
        event.preventDefault();
        if (event.key === "Enter") firstOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        else firstOption.focus();
      }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (list.contains(document.activeElement)) return;
        const resolved = resolveLanguageCode(input.value, includeAdaptive);
        if (resolved) setLanguage(input, resolved);
        else {
          const previous = input.dataset.languageCode as SourceLanguageCode | undefined;
          if (previous) setLanguage(input, previous);
        }
        hideOptions();
        updateState();
      }, 100);
    });
    list.addEventListener("keydown", (event) => {
      const options = Array.from(list.querySelectorAll<HTMLButtonElement>(".translation-language-option"));
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") {
        event.preventDefault();
        input.focus();
        hideOptions();
      } else if (event.key === "ArrowDown" && index >= 0) {
        event.preventDefault();
        options[Math.min(index + 1, options.length - 1)]?.focus();
      } else if (event.key === "ArrowUp" && index >= 0) {
        event.preventDefault();
        (index === 0 ? input : options[index - 1])?.focus();
      }
    });
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

  const currentSelection = async () => {
    const current = await dependencies.word.getSelection();
    if (!current.text.trim()) throw new Error(i18n.t("taskpane.translation.errors.selectionRequired"));
    return current.text;
  };

  renderLanguageOptions();
  renderPromptSelect();
  applySelectedPrompt();
  setLanguage(sourceLanguage, "auto");
  setLanguage(targetLanguage, i18n.resolvedLanguage === "zh-CN" ? "en" : "zh-CN");
  configureLanguageCombobox(sourceLanguage, sourceLanguageOptions, true);
  configureLanguageCombobox(targetLanguage, targetLanguageOptions, false);

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
  source.addEventListener("input", updateState);
  result.addEventListener("input", updateState);
  promptSelect.addEventListener("change", () => {
    applySelectedPrompt();
  });
  element<HTMLButtonElement>("#translation-manage-prompts").addEventListener("click", () => openPromptDialog());
  element<HTMLButtonElement>("#translation-prompt-close").addEventListener("click", () => element<HTMLDialogElement>("#translation-prompt-dialog").close());
  element<HTMLButtonElement>("#translation-prompt-create").addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const name = element<HTMLInputElement>("#translation-prompt-name").value.trim();
    const instruction = element<HTMLTextAreaElement>("#translation-prompt-content").value.trim();
    if (!name || !instruction) {
      dependencies.showError(new Error(i18n.t("taskpane.text.promptRequired")));
      return;
    }
    const editingId = button.dataset.editId;
    let savedId = editingId;
    if (editingId) {
      promptPresets = promptPresets.map((preset) => preset.id === editingId ? { ...preset, name, instruction } : preset);
    } else {
      const preset = createTextPromptPreset("translate", name, instruction);
      promptPresets.push(preset);
      savedId = preset.id;
    }
    promptPresets = saveTextPromptPresets(localStorage, promptPresets);
    renderPromptSelect(savedId);
    instructions.value = instruction;
    renderPromptList();
    element<HTMLInputElement>("#translation-prompt-name").value = "";
    element<HTMLTextAreaElement>("#translation-prompt-content").value = "";
    delete button.dataset.editId;
  });

  const applyPreciseTranslation = async () => {
    const selectedText = await currentSelection();
    const precise = await dependencies.word.applyPreciseRevision(selectedText, result.value);
    setLinkedSelection("");
    actionStatus.textContent = i18n.t(precise
      ? "taskpane.status.preciseRevisionApplied"
      : "taskpane.status.trackedReplaceApplied");
  };

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
  retryButton.addEventListener("click", () => runButton.click());
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
      await currentSelection();
      await dependencies.word.replaceSelection(result.value);
      actionStatus.textContent = i18n.t("taskpane.translation.replaced");
      setLinkedSelection("");
    } catch (error) {
      dependencies.showError(error);
    }
  });
  insertButton.addEventListener("click", async () => {
    try {
      const selectedText = await dependencies.word.getSelection();
      if (selectedText.text.trim()) {
        await dependencies.word.insertAfterSelection(`\n${result.value}`);
      } else {
        await dependencies.word.insertAtCursor(result.value);
      }
      actionStatus.textContent = i18n.t("taskpane.translation.inserted");
    } catch (error) {
      dependencies.showError(error);
    }
  });
  preciseButton.addEventListener("click", async () => {
    try {
      await applyPreciseTranslation();
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
    renderPromptSelect(promptSelect.value);
    renderPromptList();
    setLanguage(sourceLanguage, sourceCode);
    setLanguage(targetLanguage, targetCode);
    updateState();
  });

  updateState();

  return {
    async open() {
      abortController?.abort();
      promptPresets = loadTextPromptPresets(localStorage);
      renderPromptSelect();
      applySelectedPrompt();
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
