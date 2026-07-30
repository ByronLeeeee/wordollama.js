import type { RuntimeClient } from "./runtime-client";
import i18n from "./i18n.ts";

export interface SavedHtmlApp {
  id: string;
  name: string;
  html: string;
  updatedAt: string;
}

const MAX_HTML_LENGTH = 500_000;
const MAX_SAVED_APPS = 20;

export function normalizeHtmlDocument(value: string): string {
  let html = value.trim();
  const fenced = /^```(?:html)?\s*([\s\S]*?)\s*```$/i.exec(html);
  if (fenced) html = fenced[1].trim();
  if (!html) throw new Error(i18n.t("taskpane.html.errors.emptyResult"));
  if (html.length > MAX_HTML_LENGTH) throw new Error(i18n.t("taskpane.html.errors.tooLarge"));
  if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html><html><head><meta charset="utf-8"><title>WordOllama App</title></head><body>${html}</body></html>`;
  }
  return html;
}

export function buildSandboxedPreview(html: string): string {
  const policy = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  return html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
}

export async function generateHtmlApp(
  runtime: RuntimeClient,
  requirement: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!requirement.trim()) throw new Error(i18n.t("taskpane.html.errors.requirementRequired"));
  const response = await runtime.chat([
    {
      role: "system",
      content: [
        "You are a senior full-stack developer.",
        "Generate a complete, production-quality HTML5 app for the user's requirement.",
        "Output one complete HTML document with embedded CSS and JavaScript.",
        "The page must be responsive and usable inside a narrow Office task pane.",
        "Do not use external scripts, stylesheets, fonts, images, APIs, or network requests.",
        "Return only HTML code without markdown fences or explanations.",
      ].join("\n"),
    },
    { role: "user", content: requirement.trim().slice(0, 20_000) },
  ], undefined, signal);
  return normalizeHtmlDocument(response.content);
}

export function loadHtmlLibrary(storage: Storage, key = "wordollama-html-apps"): SavedHtmlApp[] {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is SavedHtmlApp => Boolean(
        item && typeof item === "object" &&
        typeof (item as SavedHtmlApp).id === "string" &&
        typeof (item as SavedHtmlApp).name === "string" &&
        typeof (item as SavedHtmlApp).html === "string",
      ))
      .slice(0, MAX_SAVED_APPS);
  } catch {
    return [];
  }
}

export function saveHtmlLibrary(storage: Storage, apps: SavedHtmlApp[], key = "wordollama-html-apps"): void {
  if (apps.length > MAX_SAVED_APPS) {
    throw new Error(i18n.t("taskpane.html.errors.maxSaved", { count: MAX_SAVED_APPS }));
  }
  if (apps.some((app) => app.html.length > MAX_HTML_LENGTH)) {
    throw new Error(i18n.t("taskpane.html.errors.tooLarge"));
  }
  storage.setItem(key, JSON.stringify(apps));
}
