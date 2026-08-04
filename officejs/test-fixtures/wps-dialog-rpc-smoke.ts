import assert from "node:assert/strict";

type MessageHandler = (event: { source: unknown; origin: string; data: string }) => void;
const handlers: MessageHandler[] = [];
const origin = "https://localhost:37421";
let closed = false;
const methods: string[] = [];
const opener = {
  postMessage(message: string, targetOrigin: string) {
    assert.equal(targetOrigin, origin);
    const request = JSON.parse(message) as { id: string; method: string };
    methods.push(request.method);
    if (request.method === "settings.close") return;
    const result = request.method === "word.listStyles" ? ["正文", "标题 1"] : undefined;
    queueMicrotask(() => {
      for (const handler of handlers) {
        handler({
          source: opener,
          origin,
          data: JSON.stringify({ id: request.id, ok: true, result }),
        });
      }
    });
  },
};

Object.assign(globalThis, {
  window: {
    opener,
    location: { origin },
    setTimeout,
    clearTimeout,
    addEventListener(type: string, handler: MessageHandler) {
      if (type === "message") handlers.push(handler);
    },
    close() { closed = true; },
  },
});

const rpc = await import("../apps/addin/src/settings/dialog-rpc.ts");
assert.deepEqual(await rpc.listWordStyles(), ["正文", "标题 1"]);
await rpc.createWordParagraphStyle("自定义样式");
rpc.closeSettingsWindow();
assert(methods.includes("word.listStyles"));
assert(methods.includes("word.createParagraphStyle"));
assert(methods.includes("settings.close"));
assert.equal(closed, true);

console.log("WPS settings popup RPC smoke tests passed.");
