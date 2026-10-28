"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { vi } from "./translations";
export type Language = "en" | "vi";
export const languageStorageKey = "gbp-language";
export function parseLanguage(value: unknown): Language {
  return value === "vi" ? "vi" : "en";
}
export type TranslationParams = Record<string, string | number>;
export function translate(
  language: Language,
  key: string,
  params: TranslationParams = {},
): string {
  const text = language === "vi" ? (vi[key] ?? key) : key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}
const LanguageContext = createContext({
  language: "en" as Language,
  setLanguage: (language: Language) => {
    void language;
  },
  t: (key: string, params?: TranslationParams) => translate("en", key, params),
});
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, update] = useState<Language>("en");
  const setLanguage = useCallback((next: Language) => {
    update(next);
    try {
      localStorage.setItem(languageStorageKey, next);
    } catch {}
  }, []);
  const t = useCallback(
    (key: string, params?: TranslationParams) =>
      translate(language, key, params),
    [language],
  );
  useEffect(() => {
    try {
      update(parseLanguage(localStorage.getItem(languageStorageKey)));
    } catch {}
    const sync = (event: StorageEvent) => {
      if (event.key === languageStorageKey || event.key === null)
        update(parseLanguage(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}
export function useLanguage() {
  return useContext(LanguageContext);
}
