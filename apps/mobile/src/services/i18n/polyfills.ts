import { shouldPolyfill } from "@formatjs/intl-pluralrules/should-polyfill.js";

/**
 * Synchronous `Intl.PluralRules` polyfill, applied at module load
 * **before** `i18next.init()` runs in `init.ts`. i18next builds its
 * plural resolver during init and caches the rule set, so the polyfill
 * has to be in place by then — an async polyfill load races init and
 * leaves the resolver running on i18next's v3-compatibility fallback
 * (the warning Hermes prints if `Intl.PluralRules` is missing).
 *
 * Static `require`s mean the polyfill ships in the JS bundle
 * unconditionally for any runtime that needs it. The locale-data files
 * are ~2–5KB each — well below the cost of an async chunk + the
 * complexity of gating init on its arrival. `shouldPolyfill()` still
 * gates the install, so Hermes builds with native ICU pay nothing
 * beyond the import itself.
 *
 * Keep the locale list in lockstep with `SUPPORTED_LOCALES` in
 * `@jellyfuse/i18n`.
 */
function applyPluralRulesPolyfill(): void {
  if (!shouldPolyfill()) return;
  // The core shim patches `Intl.PluralRules` on globalThis; the locale
  // data registers per-locale rule tables onto the shim. Both must
  // execute synchronously here.
  require("@formatjs/intl-pluralrules/polyfill.js");
  require("@formatjs/intl-pluralrules/locale-data/en.js");
  require("@formatjs/intl-pluralrules/locale-data/fr.js");
}

applyPluralRulesPolyfill();
