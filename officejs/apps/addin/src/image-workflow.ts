import type { RuntimeClient } from "./runtime-client";
import i18n from "./i18n.ts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function readImageDataUrl(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error(i18n.t("taskpane.image.errors.unsupportedType"));
  }
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    throw new Error(i18n.t("taskpane.image.errors.invalidSize"));
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(i18n.t("taskpane.image.errors.readFailed")));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (!value.startsWith(`data:${file.type};base64,`)) {
        reject(new Error(i18n.t("taskpane.image.errors.invalidEncoding")));
      }
      else resolve(value);
    };
    reader.readAsDataURL(file);
  });
}

export async function analyzeImage(
  runtime: RuntimeClient,
  imageDataUrl: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!imageDataUrl) throw new Error(i18n.t("taskpane.image.errors.selectImage"));
  const settings = await runtime.getProviderSettings();
  const active = settings.profiles.find((profile) => profile.id === settings.activeProviderId);
  if (!active) throw new Error(i18n.t("taskpane.image.errors.providerRequired"));
  if (!active.supportsVision) {
    throw new Error(i18n.t("taskpane.image.errors.visionRequired", { name: active.name }));
  }
  const response = await runtime.chat([
    {
      role: "system",
      content: "Analyze the supplied image accurately. Distinguish visible facts from inference, and never invent unreadable details.",
    },
    {
      role: "user",
      content: prompt.trim() || i18n.t("taskpane.image.defaultPrompt"),
      imageDataUrl,
    },
  ], undefined, signal);
  if (!response.content.trim()) throw new Error(i18n.t("taskpane.image.errors.emptyResult"));
  return response.content.trim();
}
