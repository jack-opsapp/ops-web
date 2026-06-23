export type AscChannel =
  | "app_store_search"
  | "app_store_browse"
  | "app_referrer"
  | "web_referrer"
  | "app_clip"
  | "institutional"
  | "unavailable"
  | "other";

/**
 * Map Apple's App Store `Source Type` (+ optional `Source Info`) to the canonical
 * channel taxonomy shared by every connector. App Store "Search" stays a single
 * channel here; the ASA-paid vs organic split happens later, once Apple Ads
 * campaign data is joined.
 */
export function mapAppStoreSourceToChannel(sourceType: string | null, _info: string | null): AscChannel {
  const s = (sourceType ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (s === "") return "unavailable";
  if (s === "app store search") return "app_store_search";
  if (s === "app store browse") return "app_store_browse";
  if (s === "app referrer") return "app_referrer";
  if (s === "web referrer") return "web_referrer";
  if (s === "app clip") return "app_clip";
  if (s === "institutional purchase") return "institutional";
  if (s === "unavailable") return "unavailable";
  return "other";
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Canonical column names whose values are numeric (everything else is text). */
const NUMERIC_CANON = new Set(["counts", "unique_counts"]);

export interface ParsedRow {
  [canonical: string]: string | number | Record<string, string>;
  raw: Record<string, string>;
}

/**
 * Parse a tab-delimited App Store report into rows keyed by canonical column name.
 *
 * Resolves each canonical column by HEADER NAME (never position) so Apple
 * reordering columns can't corrupt the data, and preserves the full original
 * header→value map in `raw` so a renamed/added Apple column is never lost.
 *
 * @param text     decompressed `.txt` (tab-delimited, first line = header)
 * @param aliases  canonicalName -> additional normalized header aliases
 */
export function parseTsv(text: string, aliases: Record<string, string[]>): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split("\t").map(norm);

  // canonical -> column index
  const resolve: Record<string, number> = {};
  for (const [canon, alist] of Object.entries(aliases)) {
    const candidates = [norm(canon.replace(/_/g, " ")), ...alist.map(norm)];
    const idx = headers.findIndex((h) => candidates.includes(h));
    if (idx >= 0) resolve[canon] = idx;
  }

  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      raw[h] = cells[i] ?? "";
    });
    const out: ParsedRow = { raw };
    for (const [canon, idx] of Object.entries(resolve)) {
      const v = (cells[idx] ?? "").trim();
      out[canon] = NUMERIC_CANON.has(canon) ? parseNum(v) : v;
    }
    return out;
  });
}

function parseNum(v: string): number {
  const n = Number(v.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
