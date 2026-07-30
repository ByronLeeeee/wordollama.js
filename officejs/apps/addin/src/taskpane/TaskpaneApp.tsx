import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AgentWorkspace } from "./AgentWorkspace";
import { ContentWorkflows } from "./ContentWorkflows";
import { LegalWorkflows } from "./LegalWorkflows";
import { MediaWorkflows } from "./MediaWorkflows";
import { ReviewSurfaces } from "./ReviewWorkspace";
import { TaskpaneChrome } from "./TaskpaneChrome";
import { UtilityDialog } from "./UtilityDialog";

function TaskpaneApp() {
  return (
    <>
      <main className="agent-shell">
        <TaskpaneChrome />
        <ContentWorkflows />
        <MediaWorkflows />
        <LegalWorkflows />
        <AgentWorkspace />
        <ReviewSurfaces />
        <p id="error" className="error" role="alert" />
      </main>
      <UtilityDialog />
    </>
  );
}

export function mountTaskpaneApp(): void {
  const rootElement = document.getElementById("taskpane-root");
  if (!rootElement) {
    throw new Error("Missing #taskpane-root.");
  }
  flushSync(() => {
    createRoot(rootElement).render(<TaskpaneApp />);
  });
}
