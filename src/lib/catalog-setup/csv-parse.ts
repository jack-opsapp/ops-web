// Pure, dependency-light CSV tokenizer (RFC-4180-ish).
//
// The iOS mappers consume already-parsed `[[String:String]]`; on web we must
// parse the raw file first. This module is the CSV side of that parse. The XLSX
// side (Task 2.4, SheetJS) emits the IDENTICAL `ParsedSheet` shape so the
// downstream mappers are source-agnostic — they only ever see
// `{ headers, rows, lineNumbers }`.
//
// We intentionally do NOT pull in PapaParse: keeping the CSV parse pure and
// dependency-free means it ships without adding a runtime dependency, and the
// only binary dependency (SheetJS) is isolated to the xlsx adapter.
//
// Guarantees:
//   - quoted fields may contain commas, escaped `""` quotes, and newlines
//   - CR, LF, and CRLF row terminators all work
//   - `lineNumbers[i]` is the 1-based PHYSICAL line of `rows[i]` (header = 1,
//     so the first data row is 2); a quoted embedded newline advances the
//     physical line count, and fully-blank physical lines are skipped while
//     keeping the numbering honest
//   - header names are trimmed; each cell is keyed by its header; short rows
//     are padded with "" and overflow cells past the header count are dropped

/** The shared parsed-sheet shape produced by both the CSV and XLSX adapters. */
export interface ParsedSheet {
  /** Trimmed header names, in column order. */
  headers: string[];
  /** Each data row keyed by header name. */
  rows: Record<string, string>[];
  /** 1-based physical source line for each row, parallel to `rows`. */
  lineNumbers: number[];
}

interface RawRecord {
  cells: string[];
  /** 1-based physical line where this record STARTS. */
  line: number;
}

/**
 * Tokenize CSV text into physical records. A record spans multiple physical
 * lines when a quoted field contains a newline; `line` is the 1-based line the
 * record begins on, and the returned `nextLine` cursor accounts for every
 * physical line consumed (including those inside quotes).
 */
function tokenize(text: string): RawRecord[] {
  const records: RawRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let recordStartLine = 1;
  let line = 1;
  let recordHasContent = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    cells.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push({ cells, line: recordStartLine });
    cells = [];
    recordHasContent = false;
  };

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      // A newline inside quotes is part of the field but still advances the
      // physical line counter so downstream line numbers stay honest.
      if (ch === "\r") {
        field += "\n";
        if (text[i + 1] === "\n") i += 1;
        line += 1;
        i += 1;
        continue;
      }
      if (ch === "\n") {
        field += "\n";
        line += 1;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      recordHasContent = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      recordHasContent = true;
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      const consumedTwo = ch === "\r" && text[i + 1] === "\n";
      // End the current record.
      pushRecord();
      i += consumedTwo ? 2 : 1;
      line += 1;
      recordStartLine = line;
      continue;
    }

    recordHasContent = true;
    field += ch;
    i += 1;
  }

  // Flush a trailing record that did not end in a newline. Only flush when the
  // record actually had content (avoids a phantom empty record after a
  // trailing newline).
  if (recordHasContent || field !== "" || cells.length > 0) {
    pushRecord();
  }

  return records;
}

/** Strip a leading UTF-8 BOM from the first header cell. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function parseCsv(text: string): ParsedSheet {
  if (text.length === 0) {
    return { headers: [], rows: [], lineNumbers: [] };
  }

  const records = tokenize(text);
  if (records.length === 0) {
    return { headers: [], rows: [], lineNumbers: [] };
  }

  const [headerRecord, ...dataRecords] = records;
  const headers = headerRecord.cells.map((h, idx) =>
    (idx === 0 ? stripBom(h) : h).trim(),
  );

  const rows: Record<string, string>[] = [];
  const lineNumbers: number[] = [];

  for (const rec of dataRecords) {
    // Skip fully-blank physical lines (every cell empty/whitespace).
    const isBlank = rec.cells.every((c) => c.trim() === "");
    if (isBlank) continue;

    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = rec.cells[idx] ?? "";
    });
    rows.push(row);
    lineNumbers.push(rec.line);
  }

  return { headers, rows, lineNumbers };
}
