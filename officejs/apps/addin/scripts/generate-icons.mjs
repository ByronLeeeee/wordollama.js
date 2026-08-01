import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="#2563eb" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
const icons = [
  ["writing", "Writing", `<path d="M6 3h8l4 4v14H6zM14 3v5h5M9 16l5-5 2 2-5 5-3 1z"/>`],
  ["image", "Image", `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>`],
  ["table", "Table", `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/>`],
  ["html", "Html", `<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>`],
  ["markdown", "Markdown", `<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 15V9l3 3 3-3v6M15 9v6m-2-2 2 2 2-2"/>`],
  ["agent", "Agent", `<path d="m12 2 1.4 4.6L18 8l-4.6 1.4L12 14l-1.4-4.6L6 8l4.6-1.4zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8zM5 14l.7 1.8 1.8.7-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7z"/>`],
  ["custom-prompts", "CustomPrompts", `<path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h4m5-3 .7 1.8 1.8.7-1.8.7L17 18l-.7-1.8-1.8-.7 1.8-.7z"/>`],
  ["polish", "Polish", `<path d="M4 18h10M4 13h8M4 8h6m7-5 .9 2.6 2.6.9-2.6.9L17 10l-.9-2.6-2.6-.9 2.6-.9zM19 14l.6 1.4L21 16l-1.4.6L19 18l-.6-1.4L17 16l1.4-.6z"/>`],
  ["expand", "Expand", `<path d="M9 9 4 4m0 0v4m0-4h4M15 9l5-5m0 0v4m0-4h-4M9 15l-5 5m0 0v-4m0 4h4M15 15l5 5m0 0v-4m0 4h-4"/>`],
  ["simplify", "Simplify", `<path d="M4 4l5 5M4 4v4m0-4h4M20 4l-5 5m5-5v4m0-4h-4M4 20l5-5m-5 5v-4m0 4h4M20 20l-5-5m5 5v-4m0 4h-4"/>`],
  ["modify", "Modify", `<path d="M4 20h4l11-11-4-4L4 16zM13 7l4 4M4 12H2M8 8H2M10 4H2"/>`],
  ["continue", "Continue", `<path d="M3 6h10M3 11h8M3 16h10M14 12l5 4-5 4"/>`],
  ["summarize", "Summarize", `<path d="M4 5h16M7 9h10M9 13h6M11 17h2m-4 3 3 2 3-2"/>`],
  ["fix", "Fix", `<path d="M4 6h10M4 11h8M4 16h7m3 0 2 2 5-6"/>`],
  ["translate", "Translate", `<path d="M3 5h9M7.5 3v2M5 5c0 4 3 7 7 8M10 5c0 3-3 7-7 8M14 20l3-8 3 8M15 17h4"/>`],
  ["risk", "Risk", `<path d="M12 3 2.5 20h19zM12 9v5M12 17h.01"/>`],
  ["fairness", "Fairness", `<path d="M12 3v18M6 6h12M5 6l-3 7h6zM19 6l-3 7h6zM8 21h8"/>`],
  ["moot-court", "MootCourt", `<path d="m14 4 6 6M12 6l6 6M4 20l9-9M3 21h7M16 3l5 5-3 3-5-5z"/>`],
  ["contract-compare", "ContractCompare", `<path d="M4 3h7v18H4zM13 3h7v18h-7zM7 8h1M7 12h1M16 8h1M16 12h1m-9 5 2-2m6 2-2-2"/>`],
  ["compare", "Compare", `<path d="M7 4H3v16h4M17 4h4v16h-4M8 9h8M8 15h8m-5-9L8 9l3 3m2 0 3 3-3 3"/>`],
  ["law-search", "LawSearch", `<path d="M4 4h10v16H4zM7 8h4M7 12h4"/><circle cx="17" cy="16" r="3"/><path d="m19 18 3 3"/>`],
  ["review", "Review", `<path d="M7 4h10v17H7zM9 2h6v4H9zM10 10h4M10 14h2m1 3 2 2 4-5"/>`],
  ["settings", "Settings", `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>`],
  ["create-group", "CreateGroup", `<path d="M5 3h10l4 4v14H5zM15 3v5h5M9 14h6M12 11v6"/>`],
  ["edit-group", "EditGroup", `<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4M4 12H2M8 8H2"/>`],
  ["edit-more-group", "EditMoreGroup", `<path d="M5 5h14M5 10h14M5 15h8M5 20h5m7-6v6m-3-3h6"/>`],
  ["translate-group", "TranslateGroup", `<path d="M3 5h9M7.5 3v2M5 5c0 4 3 7 7 8M10 5c0 3-3 7-7 8M14 20l3-8 3 8M15 17h4"/>`],
  ["legal-group", "LegalGroup", `<path d="M12 3v18M6 6h12M5 6l-3 7h6zM19 6l-3 7h6zM8 21h8"/>`],
  ["settings-group", "SettingsGroup", `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>`],
  ["settings-general", "NavGeneral", `<path d="M3 11.5 12 4l9 7.5M5 10v10h14V10M9 20v-6h6v6"/>`],
  ["settings-models", "NavModels", `<rect x="4" y="6" width="16" height="13" rx="3"/><path d="M9 2h6M12 2v4M8 11h.01M16 11h.01M8 15h8"/>`],
  ["settings-agent", "NavAgent", `<path d="m12 2 1.4 4.6L18 8l-4.6 1.4L12 14l-1.4-4.6L6 8l4.6-1.4zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/>`],
  ["settings-markdown", "NavMarkdown", `<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 15V9l3 3 3-3v6M15 9v6m-2-2 2 2 2-2"/>`],
  ["settings-skills", "NavSkills", `<path d="m12 3 4 2.3v4.6L12 12l-4-2.1V5.3zM7 12l4 2.3v4.6L7 21l-4-2.1v-4.6zM17 12l4 2.3v4.6L17 21l-4-2.1v-4.6z"/>`],
  ["settings-mcp", "NavMcp", `<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5M5 17v-3h14v3"/>`],
  ["settings-advanced", "NavAdvanced", `<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="14" cy="18" r="2"/>`],
  ["settings-updates", "NavUpdates", `<path d="M20 7v5h-5M4 17v-5h5M18 12a6 6 0 0 0-10-4L5 11M6 12a6 6 0 0 0 10 4l3-3"/>`],
  ["settings-about", "NavAbout", `<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>`],
];

const root = join(import.meta.dirname, "..", "assets", "ribbon");
await mkdir(root, { recursive: true });
const catalog = [];
for (const [name, resource, body] of icons) {
  const svg = wrap(body);
  await writeFile(join(root, `${name}.svg`), `${svg}\n`, "utf8");
  for (const size of [16, 32, 80]) {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
    await writeFile(join(root, `${name}-${size}.png`), png);
  }
  catalog.push({ name, resource, svg: `assets/ribbon/${name}.svg` });
}
await writeFile(join(root, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

const manifestPath = join(import.meta.dirname, "..", "manifest.xml");
let manifest = await readFile(manifestPath, "utf8");
const manifestIcons = [
  ["Group", "WordOllama.JS.CreateGroup", "CreateGroup"],
  ["Group", "WordOllama.JS.EditGroup", "EditGroup"],
  ["Group", "WordOllama.JS.EditMoreGroup", "EditMoreGroup"],
  ["Group", "WordOllama.JS.TranslateGroup", "TranslateGroup"],
  ["Group", "WordOllama.JS.LegalGroup", "LegalGroup"],
  ["Group", "WordOllama.JS.SettingsGroup", "SettingsGroup"],
  ...icons.slice(0, 23).map(([, resource]) => ["Control", `WordOllama.JS.${resource}`, resource]),
];
for (const [element, id, resource] of manifestIcons) {
  const matcher = new RegExp(`(<${element}[^>]*id="${id.replaceAll(".", "\\.")}"[\\s\\S]*?<Icon>)[\\s\\S]*?(</Icon>)`);
  if (!matcher.test(manifest)) throw new Error(`Manifest element not found: ${id}`);
  const images = [16, 32, 80].map((size) => `<bt:Image size="${size}" resid="${resource}.Icon${size}" />`).join("");
  manifest = manifest.replace(matcher, `$1${images}$2`);
}
const imageResources = icons.flatMap(([name, resource]) => [16, 32, 80].map((size) =>
  `        <bt:Image id="${resource}.Icon${size}" DefaultValue="https://localhost:3000/assets/ribbon/${name}-${size}.png" />`,
)).join("\n");
manifest = manifest.replace(/      <bt:Images>[\s\S]*?      <\/bt:Images>/, `      <bt:Images>\n${imageResources}\n      </bt:Images>`);
await writeFile(manifestPath, manifest, "utf8");
console.log(`Generated ${icons.length} semantic SVG icons and Ribbon PNG variants.`);
