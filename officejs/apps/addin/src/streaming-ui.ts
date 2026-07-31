interface StreamingTextState {
  frame: number | null;
  pending: string;
}

const states = new WeakMap<HTMLTextAreaElement, StreamingTextState>();

function renderPending(textarea: HTMLTextAreaElement, state: StreamingTextState): void {
  const followOutput =
    textarea.scrollHeight - textarea.scrollTop - textarea.clientHeight < 40;
  textarea.value = state.pending;
  if (followOutput) textarea.scrollTop = textarea.scrollHeight;
  textarea.dispatchEvent(new Event("input"));
  state.frame = null;
}

export function beginStreamingText(textarea: HTMLTextAreaElement): void {
  const previous = states.get(textarea);
  if (previous?.frame !== null && previous?.frame !== undefined) {
    window.cancelAnimationFrame(previous.frame);
  }
  textarea.value = "";
  textarea.readOnly = true;
  textarea.dataset.streaming = "true";
  states.set(textarea, { frame: null, pending: "" });
}

export function updateStreamingText(
  textarea: HTMLTextAreaElement,
  content: string,
): void {
  const state = states.get(textarea) ?? { frame: null, pending: "" };
  state.pending = content;
  states.set(textarea, state);
  if (state.frame !== null) return;
  state.frame = window.requestAnimationFrame(() => renderPending(textarea, state));
}

export function endStreamingText(
  textarea: HTMLTextAreaElement,
  finalContent?: string,
): void {
  const state = states.get(textarea);
  if (state) {
    if (state.frame !== null) window.cancelAnimationFrame(state.frame);
    if (finalContent !== undefined) state.pending = finalContent;
    renderPending(textarea, state);
    states.delete(textarea);
  } else if (finalContent !== undefined) {
    textarea.value = finalContent;
  }
  textarea.readOnly = false;
  delete textarea.dataset.streaming;
}
