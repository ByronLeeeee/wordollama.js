import { OfficeJsWordAdapter } from "./officejs-word-adapter";

type DialogCommandEvent = {
  completed: (options?: { allowEvent?: boolean }) => void;
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

  const dialogUrl = new URL(
    "/settings.html",
    window.location.origin,
  ).href;

  Office.context.ui.displayDialogAsync(
    dialogUrl,
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

Office.onReady(() => {
  Office.actions.associate("openSettingsDialog", openSettingsDialog);
});
