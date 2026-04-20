import * as Localization from "expo-localization";
import i18next from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";
import { catalogLoaders, englishCatalog, resolveLocale } from "@jellyfuse/i18n";
import { applyPluralRulesPolyfill } from "./polyfills";

/**
 * Boots i18next against the locale loaders generated at
 * `packages/i18n/src/loaders.ts`. Metro turns each dynamic `import()`
 * in that file into its own async chunk, so only the active locale's
 * JSON is fetched at runtime — other locales sit as dormant assets on
 * disk until requested.
 *
 * English is also passed in as a synchronous resource so `fallbackLng`
 * works on the very first render, before the dynamic `en` chunk has
 * had a chance to resolve.
 *
 * Before init we gate on `applyPluralRulesPolyfill` — on Hermes builds
 * that already expose `Intl.PluralRules` the promise resolves
 * immediately and nothing extra ships; on older runtimes we
 * dynamic-import the `@formatjs/intl-pluralrules` core plus the plural
 * tables for the active + fallback locale. The polyfill has to land
 * before `i18next.init()` because its plural resolver is built
 * synchronously there.
 *
 * Imported for its side effect from `_layout.tsx` before any screen
 * renders.
 */

const osLocale = Localization.getLocales()[0]?.languageCode ?? null;
const active = resolveLocale(osLocale);

// Register plugins + the English fallback resource synchronously at
// module load so `useTranslation()` always sees an initialised React
// bridge — even before `init()` has resolved. Without this, screens
// that render during the polyfill await would warn
// `NO_I18NEXT_INSTANCE` and the hook shape returned by useTranslation
// would flip after init completed, triggering a hooks-order error.
i18next.use(initReactI18next).use(
  resourcesToBackend(async (lang: string) => {
    const loader = catalogLoaders[lang];
    return loader ? await loader() : {};
  }),
);

async function bootstrap(): Promise<void> {
  const needed = active === "en" ? (["en"] as const) : (["en", active] as const);
  await applyPluralRulesPolyfill(needed);
  await i18next.init({
    lng: active,
    fallbackLng: "en",
    resources: { en: { translation: englishCatalog } },
    interpolation: { escapeValue: false },
    compatibilityJSON: "v4",
    returnNull: false,
    partialBundledLanguages: true,
    // Catalogs use flat dotted keys (e.g. "auth.server.title") rather
    // than nested objects, so disable i18next's default path splitter.
    keySeparator: false,
    nsSeparator: false,
  });
}

void bootstrap();
