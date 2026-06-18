// XLSX adapter — projects a spreadsheet's first worksheet into the SAME
// `ParsedSheet` shape `parseCsv` emits, so the deterministic mappers are
// source-agnostic.
//
// TWO LAYERS:
//
//   1. `rowsFromSheetMatrix` — PURE, no dependency. Takes the rows-as-arrays
//      (stringified cells) matrix SheetJS produces and projects it to
//      `{ headers, rows, lineNumbers }` with the exact same trimming /
//      short-row padding / blank-row skipping / 1-based physical line numbers
//      as `parseCsv`.
//
//   2. `parseXlsx` — the binary read. LAZY-loads SheetJS (`xlsx`, ~900KB) via a
//      dynamic import so the dependency never sits in the main bundle — it loads
//      only when an owner actually drops an .xlsx/.xls file. Routes the parsed
//      matrix straight through `rowsFromSheetMatrix` — no mapper change.

import type { ParsedSheet } from "./csv-parse";

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
 * SheetJS is lazy-loaded (dynamic import) so its ~900KB never weighs down the
 * main bundle — it only loads when an .xlsx/.xls file is actually dropped.
 * `raw: false` stringifies every cell (so numbers/dates arrive as the displayed
 * text the mappers parse, matching the CSV path); `defval: ""` pads short rows.
 */
export async function parseXlsx(
  data: ArrayBuffer | Uint8Array,
): Promise<ParsedSheet> {
  const XLSX = await import("xlsx");
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = XLSX.read(bytes, { type: "array" });

  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [], lineNumbers: [] };
  const ws = wb.Sheets[firstSheetName];

  const matrix = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
  });
  return rowsFromSheetMatrix(matrix);
}
