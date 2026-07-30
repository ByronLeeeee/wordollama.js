import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export function WorkspaceHeader({
  closeId,
  title,
}: {
  closeId: string;
  title: ReactNode;
}) {
  return (
    <div className="workflow-workspace-header">
      <button
        id={closeId}
        className="icon-button"
        type="button"
        aria-label="Back to Agent"
        data-i18n-aria-label="taskpane.common.backToAgent"
      >
        <ArrowLeft size={17} strokeWidth={2} aria-hidden="true" />
      </button>
      {title}
    </div>
  );
}
