/**
 * Resolves the document's strings from the books dictionary.
 *
 * Server-only: the model takes labels as an argument so it stays pure, and
 * this is where they come from. Every key falls back to the English default if
 * a translation is missing, so a document can never print a raw dictionary key
 * at a bookkeeper.
 */

import type { Locale } from "@/i18n/types";
import { renderServerString } from "@/i18n/server-render";
import { DEFAULT_EXPORT_LABELS, type ExportLabels } from "./expense-export-model";

const NAMESPACE = "books";
const KEY_PREFIX = "expenses.export.";

export async function resolveExportLabels(locale: Locale): Promise<ExportLabels> {
  const keys = Object.keys(DEFAULT_EXPORT_LABELS) as Array<keyof ExportLabels>;

  const resolved = await Promise.all(
    keys.map(async (key) => {
      const dictionaryKey = `${KEY_PREFIX}${key}`;
      const value = await renderServerString(locale, NAMESPACE, dictionaryKey);
      // renderServerString echoes the key back when it is missing.
      return [key, value === dictionaryKey ? DEFAULT_EXPORT_LABELS[key] : value] as const;
    })
  );

  return Object.fromEntries(resolved) as ExportLabels;
}
