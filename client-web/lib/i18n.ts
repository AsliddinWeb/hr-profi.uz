"use client";

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import ru from "@/locales/ru.json";
import uz from "@/locales/uz.json";

if (!i18n.isInitialized) {
  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        uz: { translation: uz },
        ru: { translation: ru },
        en: { translation: en },
      },
      fallbackLng: "uz",
      supportedLngs: ["uz", "ru", "en"],
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
        lookupLocalStorage: "wtp.client.lang",
      },
    });
}

export default i18n;
