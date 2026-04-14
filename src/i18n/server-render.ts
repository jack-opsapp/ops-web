/**
 * Server-side i18n rendering for agent/service-layer strings.
 *
 * The AI-drafting and lifecycle services generate client-facing text
 * (email subjects, fallback drafts, notification titles/bodies, lifecycle
 * task titles) entirely on the server. This module resolves those strings
 * against the correct locale using the company's stored locale setting.
 *
 * Design goals:
 *  - Plain-string API: callers get a localized string they can hand to
 *    the email send endpoint or store in action_data without the approval
 *    queue UI needing to know about i18n.
 *  - Reuse the existing {{var}} interpolation convention already used by
 *    the dictionary JSON files.
 *  - Cache loaded dictionaries per (locale, namespace) to avoid repeated
 *    disk reads on cron ticks.
 */

import type { Locale } from "./types";
import { defaultLocale, supportedLocales } from "./config";
import { requireSupabase } from "@/lib/supabase/helpers";

// Dictionary cache: `${locale}:${namespace}` → flat key→string map.
const dictionaryCache = new Map<string, Record<string, string>>();

async function loadNamespace(
  locale: Locale,
  namespace: string
): Promise<Record<string, string>> {
  const cacheKey = `${locale}:${namespace}`;
  const cached = dictionaryCache.get(cacheKey);
  if (cached) return cached;

  try {
    const mod = await import(`./dictionaries/${locale}/${namespace}.json`);
    const dict = (mod.default ?? mod) as Record<string, unknown>;
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(dict)) {
      if (typeof v === "string") flat[k] = v;
    }
    dictionaryCache.set(cacheKey, flat);
    return flat;
  } catch {
    if (locale !== defaultLocale) {
      return loadNamespace(defaultLocale, namespace);
    }
    return {};
  }
}

/**
 * Look up the company's preferred locale from `companies.locale`. Falls
 * back to the default locale if the row is missing, the column is empty,
 * or the stored value isn't in supportedLocales.
 */
export async function getCompanyLocale(companyId: string): Promise<Locale> {
  try {
    const supabase = requireSupabase();
    const { data } = await supabase
      .from("companies")
      .select("locale")
      .eq("id", companyId)
      .single();
    const raw = (data?.locale as string) ?? "";
    if (supportedLocales.includes(raw as Locale)) {
      return raw as Locale;
    }
  } catch {
    // Non-fatal — always fall back to defaultLocale.
  }
  return defaultLocale;
}

function interpolate(
  template: string,
  params: Record<string, string | number>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = params[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

/**
 * Resolve a dictionary key to a localized string, substituting {{var}}
 * placeholders with values from `params`. If the key is missing, returns
 * the key itself so missing translations are visually obvious in prod
 * rather than silently rendering empty text.
 */
export async function renderServerString(
  locale: Locale,
  namespace: string,
  key: string,
  params: Record<string, string | number> = {}
): Promise<string> {
  const dict = await loadNamespace(locale, namespace);
  const template = dict[key];
  if (typeof template !== "string") return key;
  return interpolate(template, params);
}

/**
 * Convenience: look up the company's locale and render in one call.
 * Use this from services that only need a single string rendered at
 * generation time.
 */
export async function renderForCompany(
  companyId: string,
  namespace: string,
  key: string,
  params: Record<string, string | number> = {}
): Promise<string> {
  const locale = await getCompanyLocale(companyId);
  return renderServerString(locale, namespace, key, params);
}
