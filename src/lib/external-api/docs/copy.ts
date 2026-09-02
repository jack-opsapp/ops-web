import type { Locale } from "@/i18n/types";

import en from "@/i18n/dictionaries/en/external-api-docs.json";
import es from "@/i18n/dictionaries/es/external-api-docs.json";

export type ExternalApiDocsCopy = Record<keyof typeof en, string>;

export function getExternalApiDocsCopy(locale: Locale): ExternalApiDocsCopy {
  return (locale === "es" ? es : en) as ExternalApiDocsCopy;
}
