import { shouldPolyfill } from "@formatjs/intl-pluralrules/should-polyfill.js";

/**
 * Lazy loaders for `Intl.PluralRules` locale-data, one per supported UI
 * locale. Mirrors the `catalogLoaders` pattern in `@jellyfuse/i18n` so
 * Metro emits a separate async chunk per locale — only the active
 * language's plural table ships to disk at runtime.
 *
 * Keep entries in lockstep with `SUPPORTED_LOCALES` in the i18n package.
 */
const pluralDataLoaders: Record<string, () => Promise<unknown>> = {
  en: () => import("@formatjs/intl-pluralrules/locale-data/en.js"),
  fr: () => import("@formatjs/intl-pluralrules/locale-data/fr.js"),
};

/**
 * Install `@formatjs/intl-pluralrules` only when the runtime lacks a
 * working `Intl.PluralRules` — newer Hermes builds ship ICU natively
 * and need neither the core polyfill nor the per-locale data. When a
 * polyfill is needed, we install the core shim and the plural tables
 * for the requested locales in parallel before resolving.
 *
 * Must resolve before `i18next.init()` because i18next constructs its
 * plural resolver synchronously at init time and caches the rule set.
 */
export async function applyPluralRulesPolyfill(locales: readonly string[]): Promise<void> {
  if (!shouldPolyfill()) return;
  await import("@formatjs/intl-pluralrules/polyfill.js");
  const loaders = locales
    .map((l) => pluralDataLoaders[l])
    .filter((fn): fn is () => Promise<unknown> => Boolean(fn));
  await Promise.all(loaders.map((fn) => fn()));
}
