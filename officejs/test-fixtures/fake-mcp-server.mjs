import readline from "node:readline";

const tools = [{
  name: "echo",
  description: "Echo a message for protocol tests.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
}];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    reply(request.id, {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "fake-mcp", version: "1.0.0" },
    });
  } else if (request.method === "tools/list") {
    reply(request.id, { tools });
  } else if (request.method === "tools/call") {
    const message = request.params?.arguments?.message ?? "";
    reply(request.id, {
      content: [{ type: "text", text: "echo:" + message }],
      isError: false,
    });
  }
});
