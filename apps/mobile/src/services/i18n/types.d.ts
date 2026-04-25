import "react-i18next";
import type { EnglishCatalog } from "@jellyfuse/i18n";

// Makes every `t(key)` call type-checked against the English catalog
// shape. `@jellyfuse/i18n` bundles `en.json` as a flat dotted-key map
// (`"auth.server.title": "Connect to Jellyfin"`), so the derived
// `EnglishCatalog` type exposes every key as a string literal and
// anything mistyped fails at `tsgo --noEmit` time.
declare module "react-i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: EnglishCatalog;
    };
  }
}
