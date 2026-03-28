'use client';

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import type { Locale, Namespace, Dictionary } from './types';
import { defaultLocale, COOKIE_NAME, COOKIE_MAX_AGE } from './config';

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: defaultLocale,
  setLocale: () => {},
});

interface LanguageProviderProps {
  locale: Locale;
  children: ReactNode;
}

export function LanguageProvider({ locale, children }: LanguageProviderProps) {
  const setLocale = useCallback((newLocale: Locale) => {
    document.cookie = `${COOKIE_NAME}=${newLocale};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
    window.location.reload();
  }, []);

  return (
    <LanguageContext.Provider value={{ locale, setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * Get the current locale and setter from context (Client Components).
 */
export function useLocale() {
  return useContext(LanguageContext);
}

/**
 * Dynamically load a dictionary for the current locale and return a t() function.
 * This is the primary hook for OPS-Web client components.
 */
export function useDictionary(namespace: Namespace) {
  const { locale } = useLocale();
  const [dict, setDict] = useState<Dictionary>({});

  useEffect(() => {
    import(`./dictionaries/${locale}/${namespace}.json`)
      .then((mod) => setDict(mod.default ?? mod))
      .catch(() => {
        import(`./dictionaries/en/${namespace}.json`).then((mod) =>
          setDict(mod.default ?? mod),
        );
      });
  }, [locale, namespace]);

  const t = useCallback((key: string) => {
    const value = dict[key];
    if (typeof value === 'string') return value;
    return key;
  }, [dict]);

  return { t, dict };
}
