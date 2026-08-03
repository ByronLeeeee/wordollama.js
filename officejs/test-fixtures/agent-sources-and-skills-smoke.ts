import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const main = readFileSync(resolve(root, "apps/addin/src/main.ts"), "utf8");
const runtime = readFileSync(resolve(root, "apps/addin/src/runtime-client.ts"), "utf8");
const settings = readFileSync(resolve(root, "apps/addin/src/settings/SettingsApp.tsx"), "utf8");
const session = readFileSync(resolve(root, "../src/WordOllama.Core/AgentSession.cs"), "utf8");
const adapter = readFileSync(resolve(root, "apps/addin/src/officejs-word-adapter.ts"), "utf8");

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

assert(main.includes('event.type === "source"') && main.includes("appendAgentSources"),
  "Agent source events are not rendered as clickable references");
assert(main.includes('label: "/make-skill"') && main.includes("appendCreateSkillAction"),
  "task-to-Skill actions are missing from Agent");
assert(runtime.includes('settingsRequest("/skills/generate"'),
  "Skill generation API is not connected to the Office client");
assert(settings.includes("runtime.generateSkill") && settings.includes("skills.createWithAi"),
  "Settings no longer exposes the AI Skill creator");
assert(session.includes("AgentContextWindow.Prepare") && session.includes("PublishSources"),
  "Agent context governance or source extraction is missing");
assert(adapter.includes('paragraphs.load("items");') && adapter.includes("selected.forEach"),
  "paragraph range reads reverted to loading all paragraph text");
assert(adapter.includes('verified: false') && adapter.includes('check: "format-only"'),
  "citation format checks are again presented as source verification");

console.log("Agent sources, Skill creator, and long-document smoke passed.");
