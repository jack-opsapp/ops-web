import { parseCsv, type ParsedSheet } from "@/lib/catalog-setup/csv-parse";
import { parseXlsx } from "@/lib/catalog-setup/xlsx-parse";

export const GUIDED_SOURCE_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const GUIDED_SOURCE_MAX_ROWS = 250;
export const GUIDED_SOURCE_MAX_COLUMNS = 50;
export const GUIDED_SOURCE_MAX_CELL_CHARS = 1_000;
export const GUIDED_SOURCE_MAX_ANSWER_BYTES = 150_000;

export type GuidedCatalogSourceDocumentErrorCode =
  | "unsupported_type"
  | "too_large"
  | "empty"
  | "invalid_headers"
  | "too_many_rows"
  | "too_many_columns"
  | "cell_too_large"
  | "answer_too_large"
  | "read_failed";

export class GuidedCatalogSourceDocumentError extends Error {
  constructor(
    public readonly code: GuidedCatalogSourceDocumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuidedCatalogSourceDocumentError";
  }
}

export interface GuidedCatalogSourceDocument {
  kind: "catalog_source_document";
  filename: string;
  format: "csv" | "excel";
  headers: string[];
  rows: Array<Record<string, string>>;
  rowCount: number;
}

function fileFormat(filename: string): GuidedCatalogSourceDocument["format"] | null {
  const extension = filename.split(".").pop()?.toLocaleLowerCase("en-CA");
  if (extension === "csv") return "csv";
  if (extension === "xlsx" || extension === "xls") return "excel";
  return null;
}

function validateSheet(sheet: ParsedSheet): void {
  if (sheet.headers.length === 0 || sheet.rows.length === 0) {
    throw new GuidedCatalogSourceDocumentError(
      "empty",
      "The price sheet has no rows.",
    );
  }
  if (sheet.headers.length > GUIDED_SOURCE_MAX_COLUMNS) {
    throw new GuidedCatalogSourceDocumentError(
      "too_many_columns",
      `Keep the price sheet to ${GUIDED_SOURCE_MAX_COLUMNS} columns or fewer.`,
    );
  }
  const normalizedHeaders = sheet.headers.map((header) => header.trim());
  if (
    normalizedHeaders.some((header) => !header || header.length > 120) ||
    new Set(normalizedHeaders).size !== normalizedHeaders.length
  ) {
    throw new GuidedCatalogSourceDocumentError(
      "invalid_headers",
      "Every price-sheet column needs a unique heading.",
    );
  }
  if (sheet.rows.length > GUIDED_SOURCE_MAX_ROWS) {
    throw new GuidedCatalogSourceDocumentError(
      "too_many_rows",
      `Split the price sheet into files with ${GUIDED_SOURCE_MAX_ROWS} rows or fewer.`,
    );
  }
  if (
    sheet.rows.some((row) =>
      Object.values(row).some(
        (cell) => cell.length > GUIDED_SOURCE_MAX_CELL_CHARS,
      ),
    )
  ) {
    throw new GuidedCatalogSourceDocumentError(
      "cell_too_large",
      "One price-sheet cell is too long. Shorten long notes and try again.",
    );
  }
}

function readWithFileReader(
  file: File,
  mode: "text" | "arrayBuffer",
): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    if (mode === "text") reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return readWithFileReader(file, "text") as Promise<string>;
}

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return readWithFileReader(file, "arrayBuffer") as Promise<ArrayBuffer>;
}

export function isGuidedCatalogSourceDocument(
  value: unknown,
): value is GuidedCatalogSourceDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  if (
    document.kind !== "catalog_source_document" ||
    typeof document.filename !== "string" ||
    document.filename.length < 1 ||
    document.filename.length > 255 ||
    (document.format !== "csv" && document.format !== "excel") ||
    !Array.isArray(document.headers) ||
    document.headers.length < 1 ||
    document.headers.length > GUIDED_SOURCE_MAX_COLUMNS ||
    !Array.isArray(document.rows) ||
    document.rows.length < 1 ||
    document.rows.length > GUIDED_SOURCE_MAX_ROWS ||
    document.rowCount !== document.rows.length
  ) {
    return false;
  }

  const headers = document.headers;
  if (
    headers.some(
      (header) =>
        typeof header !== "string" ||
        header.trim().length < 1 ||
        header.length > 120,
    ) ||
    new Set(headers).size !== headers.length
  ) {
    return false;
  }
  const headerSet = new Set(headers);
  if (
    document.rows.some((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return true;
      }
      const row = candidate as Record<string, unknown>;
      return (
        Object.keys(row).some((key) => !headerSet.has(key)) ||
        Object.values(row).some(
          (cell) =>
            typeof cell !== "string" ||
            cell.length > GUIDED_SOURCE_MAX_CELL_CHARS,
        )
      );
    })
  ) {
    return false;
  }

  return JSON.stringify(document).length <= GUIDED_SOURCE_MAX_ANSWER_BYTES;
}

export async function readGuidedCatalogSourceFile(
  file: File,
): Promise<GuidedCatalogSourceDocument> {
  const format = fileFormat(file.name);
  if (!format) {
    throw new GuidedCatalogSourceDocumentError(
      "unsupported_type",
      "Use a CSV or Excel price sheet.",
    );
  }
  if (file.size > GUIDED_SOURCE_MAX_FILE_BYTES) {
    throw new GuidedCatalogSourceDocumentError(
      "too_large",
      "Keep the price sheet under 5 MB.",
    );
  }

  let sheet: ParsedSheet;
  try {
    sheet =
      format === "csv"
        ? parseCsv(await readFileText(file))
        : await parseXlsx(await readFileBuffer(file));
  } catch (error) {
    if (error instanceof GuidedCatalogSourceDocumentError) throw error;
    throw new GuidedCatalogSourceDocumentError(
      "read_failed",
      "The price sheet could not be read.",
    );
  }
  validateSheet(sheet);

  const document: GuidedCatalogSourceDocument = {
    kind: "catalog_source_document",
    filename: file.name.slice(0, 255),
    format,
    headers: sheet.headers,
    rows: sheet.rows,
    rowCount: sheet.rows.length,
  };
  if (!isGuidedCatalogSourceDocument(document)) {
    throw new GuidedCatalogSourceDocumentError(
      "answer_too_large",
      "Split the price sheet into smaller files and try again.",
    );
  }
  return document;
}
