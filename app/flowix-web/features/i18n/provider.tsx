'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  DEFAULT_APP_LANGUAGE,
  messages,
  sanitizeAppLanguage,
  type AppLanguage,
  type I18nKey,
} from '@features/i18n/locales';

interface I18nContextValue {
  language: AppLanguage;
  t: (key: I18nKey) => string;
}

const I18nContext = createContext<I18nContextValue>({
  language: DEFAULT_APP_LANGUAGE,
  t: (key) => messages[DEFAULT_APP_LANGUAGE][key],
});

export function I18nProvider({
  language,
  children,
}: {
  language: AppLanguage;
  children: ReactNode;
}) {
  const normalizedLanguage = sanitizeAppLanguage(language);
  const value = useMemo<I18nContextValue>(() => ({
    language: normalizedLanguage,
    t: (key) => messages[normalizedLanguage][key] ?? messages[DEFAULT_APP_LANGUAGE][key],
  }), [normalizedLanguage]);

  useEffect(() => {
    document.documentElement.lang = normalizedLanguage;
  }, [normalizedLanguage]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function translate(language: AppLanguage, key: I18nKey): string {
  const normalizedLanguage = sanitizeAppLanguage(language);
  return messages[normalizedLanguage][key] ?? messages[DEFAULT_APP_LANGUAGE][key];
}
