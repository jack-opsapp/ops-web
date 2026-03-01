import type { Locale } from './types';

const dateLocaleMap: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-MX',
};

/**
 * Maps app locale to a BCP 47 date locale string.
 * 'en' -> 'en-US', 'es' -> 'es-MX'
 */
export function getDateLocale(locale: Locale): string {
  return dateLocaleMap[locale];
}
