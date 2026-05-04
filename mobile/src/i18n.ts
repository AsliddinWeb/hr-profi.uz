import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { NativeModules, Platform } from "react-native";

import en from "@/locales/en.json";
import ru from "@/locales/ru.json";
import uz from "@/locales/uz.json";

const SUPPORTED = ["uz", "ru", "en"] as const;
const STORAGE_KEY = "wtp.lang";

function detect(): string {
  // Read the device locale from the host platform; fall back to UZ. We avoid
  // expo-localization to keep the Phase 3 mobile MVP installable in Expo Go
  // without extra native modules.
  let locale = "uz";
  try {
    if (Platform.OS === "ios") {
      const settings = NativeModules.SettingsManager?.settings;
      locale =
        settings?.AppleLocale ||
        settings?.AppleLanguages?.[0] ||
        Intl.DateTimeFormat().resolvedOptions().locale ||
        "uz";
    } else if (Platform.OS === "android") {
      locale =
        NativeModules.I18nManager?.localeIdentifier ||
        Intl.DateTimeFormat().resolvedOptions().locale ||
        "uz";
    } else {
      locale = Intl.DateTimeFormat().resolvedOptions().locale || "uz";
    }
  } catch {
    locale = "uz";
  }
  const tag = locale.slice(0, 2).toLowerCase();
  return (SUPPORTED as readonly string[]).includes(tag) ? tag : "uz";
}

void (async () => {
  const stored = (await AsyncStorage.getItem(STORAGE_KEY)) ?? detect();
  await i18n.use(initReactI18next).init({
    resources: {
      uz: { translation: uz },
      ru: { translation: ru },
      en: { translation: en },
    },
    lng: stored,
    fallbackLng: "uz",
    supportedLngs: SUPPORTED as unknown as string[],
    interpolation: { escapeValue: false },
  });

  i18n.on("languageChanged", (lng) => {
    void AsyncStorage.setItem(STORAGE_KEY, lng);
  });
})();

export default i18n;
