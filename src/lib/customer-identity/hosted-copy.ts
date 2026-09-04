/**
 * OPS Web - Hosted Customer Surface: server-side copy resolution
 *
 * The hosted pages are server-rendered for an anonymous visitor, so the
 * locale is decided per request from the `ops-lang` cookie (if the visitor
 * ever chose one) and otherwise from `Accept-Language`. The resolved
 * dictionary is passed to client components as a plain object — no
 * client-side dictionary fetch, no flash of untranslated keys.
 */

import "server-only";
import { cookies, headers } from "next/headers";
import type { Locale } from "@/i18n/types";
import { COOKIE_NAME, defaultLocale, supportedLocales } from "@/i18n/config";
import en from "@/i18n/dictionaries/en/customer.json";
import es from "@/i18n/dictionaries/es/customer.json";
import type { CustomerCopy } from "./hosted-format";

const DICTIONARIES: Record<Locale, CustomerCopy> = { en, es };

function isSupported(value: string): value is Locale {
  return (supportedLocales as string[]).includes(value);
}

/**
 * Pick a supported locale from an `Accept-Language` header, honoring the
 * visitor's stated order. Quality weights are ignored on purpose: browsers
 * already order the list by preference, and a two-locale product gains
 * nothing from the extra parsing surface.
 */
export function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.trim().split(";")[0]?.toLowerCase();
    if (!tag) continue;
    const base = tag.split("-")[0];
    if (base && isSupported(base)) return base;
  }
  return null;
}

/** Cookie first, then Accept-Language, then the product default. */
export async function resolveCustomerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const chosen = cookieStore.get(COOKIE_NAME)?.value;
  if (chosen && isSupported(chosen)) return chosen;

  const headerStore = await headers();
  return localeFromAcceptLanguage(headerStore.get("accept-language")) ?? defaultLocale;
}

export function getCustomerCopy(locale: Locale): CustomerCopy {
  return DICTIONARIES[locale] ?? DICTIONARIES[defaultLocale];
}
