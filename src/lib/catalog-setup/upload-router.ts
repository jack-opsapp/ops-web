// Upload auto-router — the clean-vs-messy lane decision (spec §8).
//
// "Uploads auto-route: a clean CSV/XLSX goes to the deterministic mapper
//  (exact, instant, free, handles hundreds of rows); a messy doc/photo goes
//  to the agent. The owner never picks a lane — they just hand over what they
//  have." (spec §8)
//
// This is a PURE decision over already-extracted facts about the file
// (filename, mime, and — for spreadsheets — the parsed header row). It does
// NOT read the file: the caller parses CSV/XLSX first (csv-parse / xlsx-parse)
// and passes the headers in; non-spreadsheet files pass `headers: null`.
//
// Rule (mirrors the iOS readiness gate via `suggest*().isReadyToMap`):
//   1. not a CSV/XLSX/XLS (by mime OR extension)  → agent (unsupported)
//   2. no parseable headers (null / empty)        → agent (unparseable)
//   3. headers alias-map name+price               → deterministic (products)
//   4. headers alias-map family_name+quantity     → deterministic (stock)
//   5. otherwise (spreadsheet, no required cols)   → agent (no_required_columns)
//
// Products wins when a sheet maps BOTH required sets — flat products is the
// more common, lower-surprise interpretation of an ambiguous sheet.

import {
  suggestProductsMapping,
  suggestStockMapping,
} from "./column-mapping";

/** Which deterministic mapper a clean spreadsheet routes to. */
export type DeterministicKind = "products" | "stock";

/** Why a file was sent to the agent lane instead of the deterministic mapper. */
export type AgentReason =
  /** Not a CSV/XLSX/XLS (PDF, image, doc, etc.). */
  | "unsupported_for_deterministic"
  /** A supported extension but no parseable header row. */
  | "unparseable"
  /** A parseable spreadsheet whose headers map neither required set. */
  | "no_required_columns";

export type RouteDecision =
  | { lane: "deterministic"; kind: DeterministicKind }
  | { lane: "agent"; reason: AgentReason };

export interface RouteUploadInput {
  /** Original filename (used for the extension fallback). */
  filename: string;
  /** Reported MIME type (may be empty/generic — extension is the fallback). */
  mime: string;
  /**
   * The parsed header row for a spreadsheet, or null for a non-spreadsheet
   * file the caller could not parse (PDF/image/etc.). An empty array means a
   * spreadsheet that parsed to nothing usable.
   */
  headers: string[] | null;
}

/** MIME types that the deterministic mapper can parse. */
const SPREADSHEET_MIMES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel", // legacy .xls (also some CSVs on Windows)
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
]);

/** File extensions the deterministic mapper can parse. */
const SPREADSHEET_EXTENSIONS = new Set(["csv", "xlsx", "xls"]);

/** Lowercased extension after the final dot, or "" when there is none. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * A file is spreadsheet-shaped when EITHER its mime is a known spreadsheet
 * type OR its extension is csv/xlsx/xls. The extension fallback covers generic
 * `application/octet-stream` uploads and browsers that mislabel CSVs.
 */
function isSpreadsheet(mime: string, filename: string): boolean {
  return (
    SPREADSHEET_MIMES.has(mime.toLowerCase().trim()) ||
    SPREADSHEET_EXTENSIONS.has(extensionOf(filename))
  );
}

export function routeUpload(input: RouteUploadInput): RouteDecision {
  const { filename, mime, headers } = input;

  // 1. Not a spreadsheet the deterministic mapper can read → agent.
  if (!isSpreadsheet(mime, filename)) {
    return { lane: "agent", reason: "unsupported_for_deterministic" };
  }

  // 2. Supported extension but nothing to map → agent.
  if (headers === null || headers.length === 0) {
    return { lane: "agent", reason: "unparseable" };
  }

  // 3–4. Required columns present → deterministic. Products wins ties.
  if (suggestProductsMapping(headers).isReadyToMap) {
    return { lane: "deterministic", kind: "products" };
  }
  if (suggestStockMapping(headers).isReadyToMap) {
    return { lane: "deterministic", kind: "stock" };
  }

  // 5. Parseable spreadsheet, but no required column set maps → agent.
  return { lane: "agent", reason: "no_required_columns" };
}
