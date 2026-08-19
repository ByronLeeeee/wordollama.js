import { OfficeJsWordAdapter } from "./officejs-word-adapter";
import { ADDIN_VERSION } from "./contracts";

type DialogCommandEvent = {
  completed: (options?: { allowEvent?: boolean }) => void;
};

export const SHARED_RUNTIME_NAVIGATION_EVENT = "wordollama:shared-runtime-navigate";

export type SharedRuntimeRoute = {
  surface: "agent" | "create" | "edit" | "review" | "legal" | "compare";
  workflow: string;
};

const WORKFLOW_COMMANDS: Record<string, SharedRuntimeRoute> = {
  openWriting: { surface: "create", workflow: "writing" },
  openImage: { surface: "create", workflow: "image" },
  openTable: { surface: "create", workflow: "table" },
  openHtml: { surface: "create", workflow: "html" },
  openMarkdown: { surface: "create", workflow: "markdown" },
  openAgent: { surface: "agent", workflow: "agent" },
  openCustomPrompts: { surface: "create", workflow: "custom-prompts" },
  openPolish: { surface: "edit", workflow: "polish" },
  openExpand: { surface: "edit", workflow: "expand" },
  openSimplify: { surface: "edit", workflow: "simplify" },
  openModify: { surface: "edit", workflow: "modify" },
  openContinue: { surface: "edit", workflow: "continue" },
  openSummarize: { surface: "edit", workflow: "summarize" },
  openFix: { surface: "edit", workflow: "fix" },
  openTranslate: { surface: "edit", workflow: "translate" },
  openRisk: { surface: "legal", workflow: "risk" },
  openFairness: { surface: "legal", workflow: "fairness" },
  openMootCourt: { surface: "legal", workflow: "moot-court" },
  openContractCompare: { surface: "compare", workflow: "contract-compare" },
  openCompare: { surface: "compare", workflow: "compare" },
  openLawSearch: { surface: "legal", workflow: "law-search" },
  openReview: { surface: "review", workflow: "review" },
};

type DialogRequest =
  | { id: string; method: "word.listStyles" }
  | { id: string; method: "word.createParagraphStyle"; name: string }
  | { id: string; method: "settings.close" };

type DialogResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

let settingsDialog: Office.Dialog | null = null;
const word = new OfficeJsWordAdapter(async () => {
  throw new Error("settings-command-interaction-unavailable");
});

function sendDialogResponse(response: DialogResponse): void {
  if (!settingsDialog) return;
  settingsDialog.messageChild(JSON.stringify(response), {
    targetOrigin: window.location.origin,
  });
}

async function handleDialogMessage(event: { message: string }): Promise<void> {
  let request: DialogRequest;
  try {
    request = JSON.parse(event.message) as DialogRequest;
  } catch {
    return;
  }

  if (request.method === "settings.close") {
    const dialog = settingsDialog;
    settingsDialog = null;
    dialog?.close();
    return;
  }

  try {
    const result = request.method === "word.listStyles"
      ? await word.listStyles()
      : await word.createParagraphStyle(request.name);
    sendDialogResponse({ id: request.id, ok: true, result });
  } catch (error) {
    sendDialogResponse({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function openSettingsDialog(event: DialogCommandEvent): void {
  if (settingsDialog) {
    settingsDialog.close();
    settingsDialog = null;
  }

  const dialogUrl = new URL("/settings.html", window.location.origin);
  dialogUrl.searchParams.set("v", ADDIN_VERSION);

  Office.context.ui.displayDialogAsync(
    dialogUrl.href,
    {
      height: 78,
      width: 72,
      displayInIframe: true,
    },
    (result) => {
      if (result.status === Office.AsyncResultStatus.Failed) {
        console.error("[settings-dialog-open-failed]", result.error.message);
        event.completed();
        return;
      }

      settingsDialog = result.value;
      settingsDialog.addEventHandler(
        Office.EventType.DialogMessageReceived,
        (message) => {
          if ("message" in message) void handleDialogMessage(message);
        },
      );
      settingsDialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
        settingsDialog = null;
      });
      event.completed();
    },
  );
}

function openWorkflow(route: SharedRuntimeRoute, event: DialogCommandEvent): void {
  window.dispatchEvent(new CustomEvent<SharedRuntimeRoute>(
    SHARED_RUNTIME_NAVIGATION_EVENT,
    { detail: route },
  ));
  const showTaskpane = Office.addin?.showAsTaskpane?.();
  if (showTaskpane) {
    void showTaskpane.then(() => event.completed()).catch((error) => {
      console.error("[shared-runtime-show-taskpane-failed]", error);
      event.completed();
    });
    return;
  }
  event.completed();
}

Office.onReady(() => {
  Office.actions.associate("openSettingsDialog", openSettingsDialog);
  for (const [name, route] of Object.entries(WORKFLOW_COMMANDS)) {
    Office.actions.associate(name, (event: DialogCommandEvent) => openWorkflow(route, event));
  }
});
