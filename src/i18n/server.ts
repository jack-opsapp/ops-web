import { cookies } from 'next/headers';
import type { Locale } from './types';
import { defaultLocale, supportedLocales, COOKIE_NAME } from './config';

/**
 * Read the current locale from the ops-lang cookie (Server Components only).
 */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (raw && supportedLocales.includes(raw as Locale)) {
    return raw as Locale;
  }
  return defaultLocale;
}
