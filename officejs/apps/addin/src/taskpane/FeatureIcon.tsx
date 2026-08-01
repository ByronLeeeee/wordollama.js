import type { CSSProperties } from "react";

export type FeatureIconName =
  | "agent" | "compare" | "continue" | "contract-compare" | "custom-prompts"
  | "expand" | "fairness" | "fix" | "html" | "image" | "law-search"
  | "markdown" | "modify" | "moot-court" | "polish" | "review" | "risk"
  | "settings" | "simplify" | "summarize" | "table" | "translate" | "writing"
  | "settings-general" | "settings-models" | "settings-agent" | "settings-markdown"
  | "settings-skills" | "settings-mcp" | "settings-advanced" | "settings-updates" | "settings-about";

export function FeatureIcon({ id, name, size = 18 }: { id?: string; name: FeatureIconName; size?: number }) {
  const source = `url("/assets/ribbon/${name}.svg")`;
  const style = { width: size, height: size, maskImage: source, WebkitMaskImage: source } as CSSProperties;
  return <span id={id} className="feature-icon" style={style} aria-hidden="true" data-feature-icon={name} />;
}
