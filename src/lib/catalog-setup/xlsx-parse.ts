// XLSX adapter — projects a spreadsheet's first worksheet into the SAME
// `ParsedSheet` shape `parseCsv` emits, so the deterministic mappers are
// source-agnostic.
//
// TWO LAYERS, split so only the binary read is deferred:
//
//   1. `rowsFromSheetMatrix` — PURE, no dependency. Takes the rows-as-arrays
//      (stringified cells) matrix SheetJS produces and projects it to
//      `{ headers, rows, lineNumbers }` with the exact same trimming /
//      short-row padding / blank-row skipping / 1-based physical line numbers
//      as `parseCsv`. This is fully implemented and tested NOW.
//
//   2. `parseXlsx` — the binary read. SheetJS (`xlsx`) is a wave-2 dependency
//      and is NOT installed in this wave, so this is a // DEFERRED(wave-2) seam:
//      it throws an explicit, actionable error instead of silently returning an
//      empty sheet. When the dependency lands, the body is a few lines (see the
//      DEFERRED block) and routes its matrix straight through
//      `rowsFromSheetMatrix` — no mapper change required.

import type { ParsedSheet } from "./csv-parse";

/** Marker so callers/tests can assert the binary read is still deferred. */
export const XLSX_PARSE_DEFERRED = true as const;

/** Strip a leading UTF-8 BOM from the first header cell (defensive parity). */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Project a rows-as-arrays matrix (header row first, stringified cells) into the
 * shared `ParsedSheet`. Matches `parseCsv` exactly: trimmed headers, each cell
 * keyed by header, short rows padded with "", blank rows skipped while line
 * numbers stay honest (header = physical line 1, first data row = 2).
 */
export function rowsFromSheetMatrix(matrix: string[][]): ParsedSheet {
  if (matrix.length === 0) {
    return { headers: [], rows: [], lineNumbers: [] };
  }

  const [headerRow, ...dataRows] = matrix;
  const headers = headerRow.map((h, idx) =>
    (idx === 0 ? stripBom(String(h ?? "")) : String(h ?? "")).trim(),
  );

  const rows: Record<string, string>[] = [];
  const lineNumbers: number[] = [];

  dataRows.forEach((cells, dataIdx) => {
    const safe = cells.map((c) => String(c ?? ""));
    const isBlank = safe.every((c) => c.trim() === "");
    if (isBlank) return;

    const row: Record<string, string> = {};
    headers.forEach((header, colIdx) => {
      row[header] = safe[colIdx] ?? "";
    });
    rows.push(row);
    // +2: skip the header row (index 0 → line 1), 1-based physical line.
    lineNumbers.push(dataIdx + 2);
  });

  return { headers, rows, lineNumbers };
}

/**
 * Parse the first worksheet of an XLSX/XLS binary into a `ParsedSheet`.
 *
 * // DEFERRED(wave-2): the SheetJS (`xlsx`) dependency is not installed in this
 * wave (mapper-only slice; no new deps). When it lands, replace the throw with:
 *
 *     import * as XLSX from "xlsx";
 *     const wb = XLSX.read(data, { type: "array" });
 *     const ws = wb.Sheets[wb.SheetNames[0]];
 *     const matrix = XLSX.utils.sheet_to_json<string[]>(ws, {
 *       header: 1, raw: false, defval: "",
 *     });
 *     return rowsFromSheetMatrix(matrix);
 *
 * The pure projection (`rowsFromSheetMatrix`) is already implemented + tested,
 * so the only outstanding work is the binary read.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function parseXlsx(
  _data: ArrayBuffer | Uint8Array,
): Promise<ParsedSheet> {
  throw new Error(
    "DEFERRED(wave-2): parseXlsx requires the SheetJS (`xlsx`) dependency, " +
      "which is not installed in this wave. Install `xlsx`, then wire the " +
      "documented XLSX.read + sheet_to_json call through rowsFromSheetMatrix.",
  );
}
