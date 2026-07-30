import i18n from "./i18n.ts";

export const TRANSLATION_LANGUAGE_CODES = [
  "af", "sq", "am", "ar", "hy", "az", "eu", "be", "bn", "bs",
  "bg", "my", "ca", "ceb", "zh-CN", "zh-TW", "co", "hr", "cs", "da",
  "nl", "en", "eo", "et", "fi", "fr", "fy", "gl", "ka", "de",
  "el", "gu", "ht", "ha", "haw", "he", "hi", "hmn", "hu", "is",
  "ig", "id", "ga", "it", "ja", "jv", "kn", "kk", "km", "ko",
  "ku", "ky", "lo", "la", "lv", "lt", "lb", "mk", "mg", "ms",
  "ml", "mt", "mi", "mr", "mn", "ne", "no", "ny", "ps", "fa",
  "pl", "pt", "pa", "ro", "ru", "sm", "gd", "sr", "st", "sn",
  "sd", "si", "sk", "sl", "so", "es", "su", "sw", "sv", "tl",
  "tg", "ta", "te", "th", "tr", "uk", "ur", "uz", "vi", "cy",
  "xh", "yi", "yo", "zu",
] as const;

export type TranslationLanguageCode = (typeof TRANSLATION_LANGUAGE_CODES)[number];
export type SourceLanguageCode = "auto" | TranslationLanguageCode;

export interface TranslationLanguageOption {
  code: SourceLanguageCode;
  label: string;
}

export function languageDisplayName(code: SourceLanguageCode): string {
  if (code === "auto") return i18n.t("taskpane.translation.languages.adaptive");
  try {
    return new Intl.DisplayNames([i18n.resolvedLanguage || "en-US"], {
      type: "language",
    }).of(code) || code;
  } catch {
    return code;
  }
}

export function translationLanguageOptions(
  recent: readonly TranslationLanguageCode[],
  includeAdaptive: boolean,
): TranslationLanguageOption[] {
  const recentSet = new Set(recent);
  const ordered = [
    ...recent.filter((code) => TRANSLATION_LANGUAGE_CODES.includes(code)),
    ...TRANSLATION_LANGUAGE_CODES.filter((code) => !recentSet.has(code)),
  ];
  const options = ordered.map((code) => ({ code, label: languageDisplayName(code) }));
  return includeAdaptive
    ? [{ code: "auto", label: languageDisplayName("auto") }, ...options]
    : options;
}

export function resolveLanguageCode(
  value: string,
  includeAdaptive: boolean,
): SourceLanguageCode | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return null;
  const options = translationLanguageOptions([], includeAdaptive);
  return options.find((option) =>
    option.code.toLocaleLowerCase() === normalized ||
    option.label.toLocaleLowerCase() === normalized)?.code ?? null;
}
