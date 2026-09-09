/**
 * Supported visitor-facing locales.
 *
 * The list is data, not hardcoded logic: adding an entry here is all it takes
 * to make a language selectable by a creator. `dir` exists from day one so a
 * right-to-left language can be added later without reworking the renderer
 * (requirement 31) — nothing below assumes left-to-right.
 */
export type Locale = string;

export type LocaleInfo = {
  code: Locale;
  /** Name in the language itself — what a visitor expects to see. */
  native: string;
  /** Name in English, for the creator-facing UI. */
  english: string;
  /** Short badge used by compact switchers, e.g. "GR". */
  short: string;
  flag: string;
  dir: "ltr" | "rtl";
};

export const LOCALES: LocaleInfo[] = [
  { code: "en", native: "English", english: "English", short: "EN", flag: "🇬🇧", dir: "ltr" },
  { code: "el", native: "Ελληνικά", english: "Greek", short: "GR", flag: "🇬🇷", dir: "ltr" },
  { code: "de", native: "Deutsch", english: "German", short: "DE", flag: "🇩🇪", dir: "ltr" },
  { code: "fr", native: "Français", english: "French", short: "FR", flag: "🇫🇷", dir: "ltr" },
  { code: "es", native: "Español", english: "Spanish", short: "ES", flag: "🇪🇸", dir: "ltr" },
  { code: "it", native: "Italiano", english: "Italian", short: "IT", flag: "🇮🇹", dir: "ltr" },
  { code: "pt", native: "Português", english: "Portuguese", short: "PT", flag: "🇵🇹", dir: "ltr" },
  { code: "nl", native: "Nederlands", english: "Dutch", short: "NL", flag: "🇳🇱", dir: "ltr" },
  { code: "tr", native: "Türkçe", english: "Turkish", short: "TR", flag: "🇹🇷", dir: "ltr" },
  { code: "ru", native: "Русский", english: "Russian", short: "RU", flag: "🇷🇺", dir: "ltr" },
  { code: "pl", native: "Polski", english: "Polish", short: "PL", flag: "🇵🇱", dir: "ltr" },
  { code: "ro", native: "Română", english: "Romanian", short: "RO", flag: "🇷🇴", dir: "ltr" },
  { code: "bg", native: "Български", english: "Bulgarian", short: "BG", flag: "🇧🇬", dir: "ltr" },
  { code: "sq", native: "Shqip", english: "Albanian", short: "AL", flag: "🇦🇱", dir: "ltr" },
  { code: "ar", native: "العربية", english: "Arabic", short: "AR", flag: "🇸🇦", dir: "rtl" },
  { code: "he", native: "עברית", english: "Hebrew", short: "HE", flag: "🇮🇱", dir: "rtl" },
];

const BY_CODE = new Map(LOCALES.map((l) => [l.code, l]));

export function localeInfo(code: Locale): LocaleInfo {
  return BY_CODE.get(code) ?? LOCALES[0];
}

export function isSupportedLocale(code: string): boolean {
  return BY_CODE.has(code);
}

export function localeDir(code: Locale): "ltr" | "rtl" {
  return localeInfo(code).dir;
}

/** URL segment for a locale, e.g. /en/, /el/. Kept identical to the code. */
export function localeSegment(code: Locale): string {
  return code;
}
