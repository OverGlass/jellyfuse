import { englishCatalog } from "@jellyfuse/i18n";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

// Tests use the bundled English catalog synchronously — no lazy
// loading, no OS locale detection. Keeping this init mirrors the
// runtime behaviour well enough for label assertions like
// `getByLabelText("Add user")`.
if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishCatalog } },
    interpolation: { escapeValue: false },
    compatibilityJSON: "v4",
    returnNull: false,
    keySeparator: false,
    nsSeparator: false,
  });
}
