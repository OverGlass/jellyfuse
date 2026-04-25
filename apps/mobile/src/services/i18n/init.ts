// Imported FIRST for its side effect: installs the Intl.PluralRules
// polyfill synchronously so i18next.init() below sees a working
// resolver and doesn't fall back to v3-compatibility plural handling.
import "./polyfills";

import * as Localization from "expo-localization";
import i18next from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";
import { catalogLoaders, englishCatalog, resolveLocale } from "@jellyfuse/i18n";

/**
 * Boots i18next against the locale loaders generated at
 * `packages/i18n/src/loaders.ts`. Metro turns each dynamic `import()`
 * in that file into its own async chunk, so only the active locale's
 * JSON is fetched at runtime — other locales sit as dormant assets on
 * disk until requested.
 *
 * **Init is synchronous** at module load. `useTranslation()` short-
 * circuits without calling its internal `useState`/`useEffect` if no
 * initialised i18next instance is available; awaiting init through a
 * `void bootstrap()` race lets the first render observe one hook
 * count and a later re-render observe a different one — a hooks-order
 * violation. The English catalog is passed in as a `resources` object
 * so init has nothing async to do; the dynamic backend kicks in lazily
 * for non-English locales.
 *
 * The plural-rules polyfill is applied synchronously by the side-effect
 * import at the top of this file. i18next builds its plural resolver
 * during init and caches it, so the polyfill must be in place before
 * `init()` runs.
 *
 * Imported for its side effect from `_layout.tsx` before any screen
 * renders.
 */

const osLocale = Localization.getLocales()[0]?.languageCode ?? null;
const active = resolveLocale(osLocale);

i18next
  .use(initReactI18next)
  .use(
    resourcesToBackend(async (lang: string) => {
      const loader = catalogLoaders[lang];
      return loader ? await loader() : {};
    }),
  )
  .init({
    lng: active,
    fallbackLng: "en",
    resources: { en: { translation: englishCatalog } },
    interpolation: { escapeValue: false },
    compatibilityJSON: "v4",
    returnNull: false,
    partialBundledLanguages: true,
    // initImmediate=false makes init resolve synchronously — the React
    // bridge sees `i18n.isInitialized === true` from the very first
    // useTranslation call, which is what keeps the hook shape stable.
    initImmediate: false,
    // Catalogs use flat dotted keys (e.g. "auth.server.title") rather
    // than nested objects, so disable i18next's default path splitter.
    keySeparator: false,
    nsSeparator: false,
  });
