import http from "node:http";

const port = Number(process.env.PORT || 37429);
const toolName = process.env.TOOL_NAME || "get_selection";
const toolInput = process.env.TOOL_ARGS ? JSON.parse(process.env.TOOL_ARGS) : {};

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendSse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

function sendNdjson(res, events) {
  res.writeHead(200, { "content-type": "application/x-ndjson" });
  for (const event of events) res.write(`${JSON.stringify(event)}\n`);
  res.end();
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let parsedBody = {};
    try { parsedBody = body ? JSON.parse(body) : {}; } catch { /* keep malformed fixture input visible below */ }
    if (req.method === "POST" && req.url === "/v1/messages") {
      if (parsedBody.stream) {
        return sendSse(res, [
          { type: "message_start", message: {} },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "claude-compatible-ok" } },
          { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_claude", name: toolName, input: {} } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(toolInput) } },
          { type: "message_stop" },
        ]);
      }
      return send(res, 200, {
        id: "msg_fake",
        content: [
          { type: "text", text: "claude-compatible-ok" },
          { type: "tool_use", id: "call_claude", name: toolName, input: toolInput },
        ],
      });
    }
    if (req.method === "POST" && req.url?.includes(":streamGenerateContent")) {
      return sendSse(res, [
        { candidates: [{ content: { parts: [{ text: "gemini-compatible-ok" }] } }] },
        { candidates: [{ content: { parts: [{ functionCall: { name: toolName, args: toolInput } }] } }] },
      ]);
    }
    if (req.method === "POST" && req.url?.includes(":generateContent")) {
      return send(res, 200, {
        candidates: [{ content: { parts: [
          { text: "gemini-compatible-ok" },
          { functionCall: { name: toolName, args: toolInput } },
        ] } }],
      });
    }
    if (req.method === "POST" && req.url === "/api/chat") {
      const message = { role: "assistant", content: "ollama-compatible-ok", tool_calls: [
        { id: "call_ollama", function: { name: toolName, arguments: JSON.stringify(toolInput) } },
      ] };
      if (parsedBody.stream) {
        return sendNdjson(res, [
          { message: { role: "assistant", content: "ollama-compatible-ok" }, done: false },
          { message, done: true },
        ]);
      }
      return send(res, 200, { message });
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      if (parsedBody.stream) {
        return sendSse(res, [
          { choices: [{ delta: { content: "openai-compatible-ok" } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_openai", function: { name: toolName, arguments: JSON.stringify(toolInput) } }] } }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ]);
      }
      return send(res, 200, {
        choices: [{ message: {
          content: "openai-compatible-ok",
          tool_calls: [{ id: "call_openai", function: { name: toolName, arguments: JSON.stringify(toolInput) } }],
        } }],
      });
    }
    if (req.method === "GET" && req.url === "/v1beta/models") {
      return send(res, 200, { models: [{ name: "models/fake-gemini", supportedGenerationMethods: ["generateContent"] }] });
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      return send(res, 200, { data: [{ id: "fake-openai" }] });
    }
    return send(res, 404, { error: "not_found", url: req.url, body });
  });
});

server.listen(port, "127.0.0.1", () => console.log(`fake-provider-server:${port}`));
