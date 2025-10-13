import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import translationsData from "./translations.json";

type Language = keyof typeof translationsData;

type I18nContextShape = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  availableLanguages: Language[];
};

const defaultLanguage: Language = "en";

const I18nContext = createContext<I18nContextShape>({
  language: defaultLanguage,
  setLanguage: () => undefined,
  t: (key: string) => key,
  availableLanguages: Object.keys(translationsData) as Language[],
});

export function I18nProvider({
  initialLanguage,
  children,
}: PropsWithChildren<{ initialLanguage?: Language }>) {
  const [language, setLanguage] = useState<Language>(
    initialLanguage ?? defaultLanguage,
  );

  const translate = useCallback(
    (key: string) =>
      translationsData[language][key] ??
      translationsData[defaultLanguage][key] ??
      key,
    [language],
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: translate,
      availableLanguages: Object.keys(translationsData) as Language[],
    }),
    [language, translate],
  );

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
