import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const addinRoot = resolve(repoRoot, "officejs/apps/addin");
const manifest = readFileSync(resolve(addinRoot, "manifest.xml"), "utf8");
const catalog = JSON.parse(readFileSync(resolve(addinRoot, "assets/ribbon/catalog.json"), "utf8")) as Array<{
  name: string;
  resource: string;
  svg: string;
}>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Feature icon smoke failed: ${message}`);
}

assert(catalog.length === 38, `expected 38 function/group/settings icons, got ${catalog.length}`);
assert(new Set(catalog.map(({ name }) => name)).size === catalog.length, "icon names must be unique");
assert(new Set(catalog.map(({ resource }) => resource)).size === catalog.length, "resource names must be unique");

for (const { name, resource, svg } of catalog) {
  const svgPath = resolve(addinRoot, svg);
  assert(existsSync(svgPath), `missing SVG source for ${name}`);
  const markup = readFileSync(svgPath, "utf8");
  assert(markup.includes('viewBox="0 0 24 24"'), `${name} SVG must be resolution independent`);
  assert(!/fill="(?:white|#fff(?:fff)?)"/iu.test(markup), `${name} SVG must not paint a light background`);
  for (const size of [16, 32, 80]) {
    const file = resolve(addinRoot, `assets/ribbon/${name}-${size}.png`);
    assert(existsSync(file) && statSync(file).size > 100, `missing ${size}px Ribbon PNG for ${name}`);
    assert(manifest.includes(`id="${resource}.Icon${size}"`), `manifest resource missing ${resource}.Icon${size}`);
    assert(manifest.includes(`assets/ribbon/${name}-${size}.png`), `manifest URL missing ${name}-${size}.png`);
  }
}

const controls = Array.from(manifest.matchAll(/<Control xsi:type="Button" id="WordOllama\.JS\.([^"]+)"[\s\S]*?<Icon>([\s\S]*?)<\/Icon>/gu));
assert(controls.length === 23, `expected 23 Ribbon commands, got ${controls.length}`);
for (const [, control, iconMarkup] of controls) {
  for (const size of [16, 32, 80]) {
    assert(iconMarkup.includes(`resid="${control}.Icon${size}"`), `${control} must use its own ${size}px icon`);
  }
}
assert(!manifest.includes('resid="Icon.'), "generic Ribbon icon resources must not remain");

const featureIcon = readFileSync(resolve(addinRoot, "src/taskpane/FeatureIcon.tsx"), "utf8");
const styles = readFileSync(resolve(addinRoot, "src/styles.css"), "utf8");
const settingsApp = readFileSync(resolve(addinRoot, "src/settings/SettingsApp.tsx"), "utf8");
const main = readFileSync(resolve(addinRoot, "src/main.ts"), "utf8");
assert(featureIcon.includes("/assets/ribbon/${name}.svg"), "task panes must reference the repo-native SVG set");
assert(featureIcon.includes("maskImage") && styles.includes("background: currentColor"), "task-pane icons must inherit theme/high-contrast color");
for (const name of ["general", "models", "agent", "markdown", "skills", "mcp", "advanced", "updates", "about"]) {
  assert(settingsApp.includes(`icon: "settings-${name}"`), `settings navigation missing its semantic ${name} icon`);
}
assert(main.includes("surface-feature-icon") && main.includes("surfaceFeatureName"), "deep-linked task panes must select the matching feature icon");

console.log("Feature icon smoke passed (unique SVG sources, Ribbon PNG resources, and theme-aware task-pane rendering).");
