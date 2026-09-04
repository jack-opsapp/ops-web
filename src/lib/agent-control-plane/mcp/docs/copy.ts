import "server-only";

import en from "@/i18n/dictionaries/en/mcp-docs.json";
import es from "@/i18n/dictionaries/es/mcp-docs.json";
import type { Locale } from "@/i18n/types";

export type McpDocsCopy = typeof en;

const MCP_DOCS_COPY_BY_LOCALE = {
  en,
  es,
} satisfies Readonly<Record<Locale, McpDocsCopy>>;

export function getMcpDocsCopy(locale: Locale): McpDocsCopy {
  return MCP_DOCS_COPY_BY_LOCALE[locale];
}
