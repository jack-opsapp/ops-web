import type { Locale } from './types';

export const defaultLocale: Locale = 'en';
export const supportedLocales: Locale[] = ['en', 'es'];

export const COOKIE_NAME = 'ops-lang';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year in seconds
