// @jellyfuse/i18n — translation catalogs + locale mapping.
//
// The JS locale catalogs (`src/locales/*.json`) are loaded lazily at
// runtime by `apps/mobile/src/services/i18n/locale-loader.ts`; this
// package only exports the shared types, mapping helpers, and the
// English source-of-truth so TypeScript can derive key types.

import en from "./locales/en.json" with { type: "json" };

export { bcp47ToIso639_2, resolveLocale, SUPPORTED_LOCALES } from "./mapping";
export type { SupportedLocale } from "./mapping";
export { catalogLoaders } from "./loaders";

/** The English catalog shape — source of truth for all other locales. */
export type EnglishCatalog = typeof en;

/** Literal union of every translation key in the English catalog. */
export type TranslationKey = keyof EnglishCatalog;

/** The English catalog itself. Bundled as the i18next fallback. */
export const englishCatalog: EnglishCatalog = en;
