import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptRoot, "..");
const outputPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(packageRoot, "dist/legal/THIRD-PARTY-LICENSES.txt");
const lock = JSON.parse(readFileSync(join(packageRoot, "package-lock.json"), "utf8"));

const packages = Object.entries(lock.packages ?? {})
  .filter(([key, value]) => key.startsWith("node_modules/") && !value.dev && !value.link)
  .map(([key, value]) => {
    const installedRoot = join(packageRoot, key);
    if (!existsSync(installedRoot)) {
      throw new Error(`Installed production dependency is missing: ${key}`);
    }
    const manifest = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
    const noticeFiles = readdirSync(installedRoot)
      .filter((name) => /^(licen[cs]e|copying|notice)/i.test(name))
      .sort((left, right) => left.localeCompare(right));
    if (noticeFiles.length === 0) {
      throw new Error(`No license or notice file found for ${manifest.name}@${manifest.version}`);
    }
    return {
      name: manifest.name,
      version: manifest.version ?? value.version ?? "unknown",
      license: manifest.license ?? value.license ?? "See included text",
      installedRoot,
      noticeFiles,
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

const sections = [
  "WordOllama.JS frontend third-party license texts",
  "Generated from package-lock.json; do not edit by hand.",
  "Only packages marked as production dependencies are included.",
];

for (const dependency of packages) {
  sections.push("", "=".repeat(78));
  sections.push(`${dependency.name}@${dependency.version} — ${dependency.license}`);
  sections.push("=".repeat(78));
  for (const name of dependency.noticeFiles) {
    sections.push("", `--- ${name} ---`, "");
    sections.push(readFileSync(join(dependency.installedRoot, name), "utf8").trim());
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${sections.join("\n")}\n`, "utf8");
console.log(`Wrote ${packages.length} production dependency notices to ${outputPath}`);
