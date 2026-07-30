import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeImage } from "../apps/addin/src/image-workflow.ts";
import type { RuntimeClient } from "../apps/addin/src/runtime-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Image workflow smoke failed: ${message}`);
}

const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
let capturedImage = "";
let capturedPrompt = "";
const runtime = {
  async getProviderSettings() {
    return {
      activeProviderId: "vision",
      profiles: [{
        id: "vision",
        name: "Vision",
        type: "OpenAI",
        endpoint: "https://example.invalid/v1",
        model: "vision-model",
        toolCallingMode: "Auto",
        supportsStreaming: true,
        supportsVision: true,
        supportsJsonOutput: false,
        contextWindow: 0,
        hasApiKey: true,
      }],
    };
  },
  async chat(messages: Array<{ content: string; imageDataUrl?: string }>) {
    capturedPrompt = messages.map((message) => message.content).join("\n");
    capturedImage = messages.find((message) => message.imageDataUrl)?.imageDataUrl ?? "";
    return { provider: "fake", model: "vision", content: "visible facts" };
  },
} as unknown as RuntimeClient;

const result = await analyzeImage(runtime, imageDataUrl, "read the chart");
assert(result === "visible facts", "analysis result was not returned");
assert(capturedImage === imageDataUrl, "image data URL was not sent to the Provider");
assert(capturedPrompt.includes("read the chart"), "image prompt was lost");

const noVisionRuntime = {
  async getProviderSettings() {
    return {
      activeProviderId: "text",
      profiles: [{ id: "text", name: "Text only", supportsVision: false }],
    };
  },
} as unknown as RuntimeClient;
let noVisionRejected = false;
try { await analyzeImage(noVisionRuntime, imageDataUrl, "analyze"); } catch { noVisionRejected = true; }
assert(noVisionRejected, "text-only Provider was accepted for image analysis");

const repoRoot = resolve(import.meta.dirname, "../..");
const contracts = readFileSync(resolve(repoRoot, "src/WordOllama.Contracts/BridgeProtocol.cs"), "utf8");
const openAi = readFileSync(resolve(repoRoot, "src/WordOllama.Core/OpenAiCompatibleProvider.cs"), "utf8");
const ollama = readFileSync(resolve(repoRoot, "src/WordOllama.Core/OllamaProvider.cs"), "utf8");
const anthropic = readFileSync(resolve(repoRoot, "src/WordOllama.Core/AnthropicProvider.cs"), "utf8");
const gemini = readFileSync(resolve(repoRoot, "src/WordOllama.Core/GeminiProvider.cs"), "utf8");
assert(contracts.includes("string? ImageDataUrl = null"), "Bridge protocol lacks optional image data");
assert(openAi.includes('type = "image_url"'), "OpenAI-compatible vision payload is missing");
assert(ollama.includes("images = ParseOllamaImages"), "Ollama vision payload is missing");
assert(anthropic.includes('type = "image"') && anthropic.includes('type = "base64"'), "Anthropic vision payload is missing");
assert(gemini.includes("inlineData") && gemini.includes("mimeType"), "Gemini vision payload is missing");

console.log("Unified image understanding workflow smoke passed.");

