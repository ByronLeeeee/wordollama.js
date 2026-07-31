import type { ChatMessage } from "./contracts";
import type { RuntimeClient } from "./runtime-client";

export type TextStreamUpdate = (content: string, delta: string) => void;

export async function streamText(
  runtime: Pick<RuntimeClient, "streamChat">,
  messages: ChatMessage[],
  signal?: AbortSignal,
  onUpdate?: TextStreamUpdate,
): Promise<string> {
  let content = "";
  for await (const chunk of runtime.streamChat(messages, undefined, signal)) {
    if (!chunk.delta) continue;
    content += chunk.delta;
    onUpdate?.(content, chunk.delta);
  }
  return content.trim();
}
