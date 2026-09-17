/**
 * Renders an ExpenseExportDocument as a real .xlsx.
 *
 * This is the only file that knows about ExcelJS. It makes no decisions about
 * money or eligibility — the model already did that — it only lays the document
 * out and brands it.
 *
 * SURFACE NOTE: an exported workbook is a customer-branded portable document,
 * not an OPS product surface. It is white paper carrying the *company's* accent
 * colour, opened in Excel, Numbers or Google Sheets on someone else's machine.
 * So the OPS dark-canvas tokens do not apply and the OPS brand fonts are not
 * used: Mohave / JetBrains Mono / Cake Mono are not installed on a bookkeeper's
 * laptop and would substitute unpredictably. Arial renders identically
 * everywhere, and the portable equivalent of "tabular lining numerals" is a real
 * number format on a right-aligned cell — which is also what makes the figures
 * add up in the reader's spreadsheet instead of being dead text.
 */

import ExcelJS from "exceljs";
import type { ExpenseExportDocument, ExpenseExportRow } from "./expense-export-model";

// ─── Document tokens ──────────────────────────────────────────────────────────
// The light-canvas counterpart to the OPS text hierarchy. Defined once, used
// by name; no raw hex appears below this block.

const INK = "FF1A1A1A"; // primary text
const MUTED = "FF6B6B6B"; // labels, secondary text
const FAINT = "FF8A8A8A"; // de-emphasised rows
const TITLE_GREY = "FF9A9A9A"; // the big document title
const HAIRLINE = "FFD9D9D9"; // rules between rows
const ZEBRA = "FFF7F7F7"; // alternating row fill
const PAPER = "FFFFFFFF";

const FONT = "Arial";
const SIZE_TITLE = 22;
const SIZE_COMPANY = 14;
const SIZE_VALUE = 12;
const SIZE_BODY = 10;
const SIZE_LABEL = 9;

const COLUMN_WIDTHS = [12, 30, 34, 22, 26, 14];
const COL_COUNT = COLUMN_WIDTHS.length;
const COL_COST = 6;

const LOGO_MAX_W = 190;
const LOGO_MAX_H = 74;
/** Rows the logo needs to sit in without overlapping the block beneath it. */
const LOGO_ROWS = 4;

export interface WorkbookLogo {
  buffer: Buffer;
  extension: "png" | "jpeg" | "gif";
}

// ─── Colour ───────────────────────────────────────────────────────────────────

function normalizeHex(hex: string): string {
  const raw = hex.replace("#", "").trim();
  if (raw.length === 3) {
    return raw
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase();
  }
  return (raw.length === 8 ? raw.slice(2) : raw).toUpperCase();
}

export function toArgb(hex: string): string {
  const normalized = normalizeHex(hex);
  return /^[0-9A-F]{6}$/.test(normalized) ? `FF${normalized}` : "FF417394";
}

function relativeLuminance(hex: string): number {
  const normalized = normalizeHex(hex);
  const channel = (offset: number) => {
    const value = parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * Pick white or ink for text sitting on the brand colour, by WCAG contrast —
 * a company that chooses a pale accent must still get a readable header.
 */
export function contrastTextFor(hex: string): string {
  const normalized = normalizeHex(hex);
  if (!/^[0-9A-F]{6}$/.test(normalized)) return PAPER;
  const bg = relativeLuminance(normalized);
  const onWhite = 1.05 / (bg + 0.05);
  const onInk = (bg + 0.05) / (relativeLuminance(normalizeHex(INK)) + 0.05);
  return onWhite >= onInk ? PAPER : INK;
}

// ─── Number formats ───────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  CAD: "$",
  USD: "$",
  AUD: "$",
  NZD: "$",
  EUR: "€",
  GBP: "£",
};

export function currencyNumberFormat(currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency?.toUpperCase() ?? ""];
  return symbol ? `"${symbol}"#,##0.00` : `#,##0.00" ${currency.toUpperCase()}"`;
}

const DATE_FORMAT = "mm/dd/yyyy";

// ─── Image sizing ─────────────────────────────────────────────────────────────

/**
 * Read intrinsic pixel dimensions so the logo keeps its aspect ratio. A wide
 * lockup squashed into a square is worse than no logo at all.
 */
function intrinsicSize(logo: WorkbookLogo): { width: number; height: number } | null {
  const { buffer, extension } = logo;
  try {
    if (extension === "png" && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (extension === "jpeg") {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isFrame) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function fittedSize(logo: WorkbookLogo): { width: number; height: number } {
  const intrinsic = intrinsicSize(logo);
  if (!intrinsic || intrinsic.width <= 0 || intrinsic.height <= 0) {
    return { width: LOGO_MAX_H, height: LOGO_MAX_H };
  }
  const scale = Math.min(LOGO_MAX_W / intrinsic.width, LOGO_MAX_H / intrinsic.height, 1);
  return {
    width: Math.round(intrinsic.width * scale),
    height: Math.round(intrinsic.height * scale),
  };
}

// ─── Cell helpers ─────────────────────────────────────────────────────────────

type TextOptions = {
  size?: number;
  bold?: boolean;
  color?: string;
  align?: "left" | "right" | "center";
  italic?: boolean;
};

function writeText(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: string,
  options: TextOptions = {}
): ExcelJS.Cell {
  const cell = ws.getCell(row, col);
  // An absent value leaves a genuinely empty cell rather than an empty string —
  // a blank note should read as blank, not as a cell someone forgot to fill.
  if (value) cell.value = value;
  cell.font = {
    name: FONT,
    size: options.size ?? SIZE_BODY,
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    color: { argb: options.color ?? INK },
  };
  cell.alignment = { vertical: "middle", horizontal: options.align ?? "left" };
  return cell;
}

function mergeAcross(ws: ExcelJS.Worksheet, row: number, from: number, to: number): void {
  if (to > from) ws.mergeCells(row, from, row, to);
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function writeBrandBar(ws: ExcelJS.Worksheet, accent: string): void {
  ws.getRow(1).height = 7;
  for (let col = 1; col <= COL_COUNT; col += 1) {
    ws.getCell(1, col).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: accent },
    };
  }
  mergeAcross(ws, 1, 1, COL_COUNT);
}

/** Company identity + the document title. Returns the next free row. */
function writeMasthead(
  ws: ExcelJS.Worksheet,
  wb: ExcelJS.Workbook,
  doc: ExpenseExportDocument,
  accent: string,
  logo: WorkbookLogo | null
): number {
  const start = 2;
  const textCol = logo ? 2 : 1;

  writeText(ws, start, textCol, doc.company.name, {
    size: SIZE_COMPANY,
    bold: true,
    color: accent,
  });
  mergeAcross(ws, start, textCol, 4);

  doc.company.contactLines.forEach((contactLine, index) => {
    const row = start + 1 + index;
    writeText(ws, row, textCol, contactLine, { size: SIZE_LABEL, color: MUTED });
    mergeAcross(ws, row, textCol, 4);
  });

  const title = writeText(ws, start, 5, doc.labels.title, {
    size: SIZE_TITLE,
    bold: true,
    color: TITLE_GREY,
    align: "right",
  });
  title.alignment = { vertical: "middle", horizontal: "right" };
  mergeAcross(ws, start, 5, COL_COUNT);
  ws.getRow(start).height = 30;

  const textRows = 1 + doc.company.contactLines.length;
  const usedRows = logo ? Math.max(textRows, LOGO_ROWS) : textRows;

  if (logo) {
    const imageId = wb.addImage({ buffer: logo.buffer as never, extension: logo.extension });
    const { width, height } = fittedSize(logo);
    ws.addImage(imageId, {
      tl: { col: 0.15, row: start - 1 + 0.15 },
      ext: { width, height },
    });
  }

  return start + usedRows;
}

/** PAYABLE TO · PERIOD · BATCH. Returns the next free row. */
function writeFactStrip(
  ws: ExcelJS.Worksheet,
  doc: ExpenseExportDocument,
  accent: string,
  startRow: number
): number {
  const labelRow = startRow + 1;
  const valueRow = labelRow + 1;

  const personLabel = doc.companyFunded ? doc.labels.submittedBy : doc.labels.payableTo;
  const columns: Array<{ col: number; span: number; label: string; value: string; extras: string[] }> = [
    {
      col: 1,
      span: 2,
      label: personLabel,
      value: doc.person.name,
      extras: [doc.person.address, doc.person.phone].filter((v): v is string => !!v),
    },
    { col: 3, span: 2, label: doc.labels.period, value: doc.periodLabel, extras: [] },
    {
      col: 5,
      span: 2,
      label: doc.labels.batch,
      value: doc.batchNumber,
      extras: [doc.statusLabel],
    },
  ];

  for (const column of columns) {
    const last = column.col + column.span - 1;
    writeText(ws, labelRow, column.col, column.label, { size: SIZE_LABEL, color: MUTED });
    mergeAcross(ws, labelRow, column.col, last);

    writeText(ws, valueRow, column.col, column.value, {
      size: SIZE_VALUE,
      bold: true,
      color: accent,
    });
    mergeAcross(ws, valueRow, column.col, last);

    column.extras.forEach((extra, index) => {
      const row = valueRow + 1 + index;
      writeText(ws, row, column.col, extra, { size: SIZE_LABEL, color: MUTED });
      mergeAcross(ws, row, column.col, last);
    });
  }

  ws.getRow(valueRow).height = 18;
  const deepest = Math.max(...columns.map((c) => c.extras.length));
  return valueRow + deepest + 1;
}

function writeTableHeader(
  ws: ExcelJS.Worksheet,
  doc: ExpenseExportDocument,
  accent: string,
  row: number
): void {
  const headers = [
    doc.labels.colDate,
    doc.labels.colJob,
    doc.labels.colItem,
    doc.labels.colStore,
    doc.labels.colNote,
    doc.labels.colCost,
  ];
  const onAccent = contrastTextFor(accent);

  headers.forEach((label, index) => {
    const cell = ws.getCell(row, index + 1);
    cell.value = label;
    cell.font = { name: FONT, size: SIZE_LABEL, bold: true, color: { argb: onAccent } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accent } };
    cell.alignment = {
      vertical: "middle",
      horizontal: index + 1 === COL_COST ? "right" : "left",
    };
  });
  ws.getRow(row).height = 20;
}

function writeLineRow(
  ws: ExcelJS.Worksheet,
  row: ExpenseExportRow,
  doc: ExpenseExportDocument,
  rowIndex: number,
  zebra: boolean
): void {
  const color = row.muted ? FAINT : INK;
  const values: Array<string> = [row.job, row.item, row.store, row.note];

  const dateCell = ws.getCell(rowIndex, 1);
  dateCell.value = row.date;
  dateCell.numFmt = DATE_FORMAT;
  dateCell.font = { name: FONT, size: SIZE_BODY, color: { argb: color } };
  dateCell.alignment = { vertical: "middle", horizontal: "left" };

  values.forEach((value, index) => {
    writeText(ws, rowIndex, index + 2, value, { color });
  });

  const costCell = ws.getCell(rowIndex, COL_COST);
  costCell.value = row.cost;
  costCell.numFmt = currencyNumberFormat(row.currency);
  costCell.font = {
    name: FONT,
    size: SIZE_BODY,
    bold: !row.muted,
    color: { argb: color },
  };
  costCell.alignment = { vertical: "middle", horizontal: "right" };

  for (let col = 1; col <= COL_COUNT; col += 1) {
    const cell = ws.getCell(rowIndex, col);
    cell.border = { bottom: { style: "hair", color: { argb: HAIRLINE } } };
    if (zebra) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
    }
  }
}

type TotalLine = { label: string; value: number | null; emphasis?: boolean };

function totalLines(doc: ExpenseExportDocument): TotalLine[] {
  const lines: TotalLine[] = [];

  if (doc.currencies.length > 1) {
    // Never add across currencies — subtotal each one instead.
    for (const currency of doc.currencies) {
      const subtotal =
        doc.rows
          .filter((r) => r.currency === currency)
          .reduce((cents, r) => cents + Math.round(r.cost * 100), 0) / 100;
      lines.push({ label: `${doc.labels.total} (${currency})`, value: subtotal });
    }
  } else {
    lines.push({
      label: doc.labels.total,
      value: doc.linesTotal,
      emphasis: !doc.companyFunded && doc.excludedTotal === 0,
    });
  }

  if (doc.companyFunded) {
    lines.push({ label: doc.labels.companyFunded, value: null });
  } else if (doc.excludedTotal > 0 && doc.currencies.length <= 1) {
    lines.push({ label: doc.labels.notReimbursed, value: doc.excludedTotal });
    lines.push({ label: doc.labels.payable, value: doc.payableTotal, emphasis: true });
  }

  if (doc.taxTotal != null) {
    lines.push({ label: doc.labels.includesTax, value: doc.taxTotal });
  }

  return lines;
}

function writeTotals(
  ws: ExcelJS.Worksheet,
  doc: ExpenseExportDocument,
  accent: string,
  startRow: number
): number {
  let row = startRow;
  for (const line of totalLines(doc)) {
    const labelCell = writeText(ws, row, 4, line.label, {
      size: line.emphasis ? SIZE_BODY : SIZE_LABEL,
      bold: true,
      color: line.emphasis ? accent : MUTED,
      align: "right",
    });
    ws.mergeCells(row, 4, row, COL_COST - 1);
    labelCell.alignment = { vertical: "middle", horizontal: "right" };

    const valueCell = ws.getCell(row, COL_COST);
    if (line.value != null) {
      valueCell.value = line.value;
      valueCell.numFmt = currencyNumberFormat(doc.currency);
    }
    valueCell.font = {
      name: FONT,
      size: line.emphasis ? SIZE_VALUE : SIZE_BODY,
      bold: true,
      color: { argb: line.emphasis ? accent : INK },
    };
    valueCell.alignment = { vertical: "middle", horizontal: "right" };

    if (line.emphasis) {
      for (let col = 4; col <= COL_COUNT; col += 1) {
        ws.getCell(row, col).border = { top: { style: "thin", color: { argb: accent } } };
      }
      ws.getRow(row).height = 20;
    }
    row += 1;
  }
  return row;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function writeExpenseWorkbook(
  doc: ExpenseExportDocument,
  logo: WorkbookLogo | null
): Promise<Buffer> {
  const accent = toArgb(doc.accentColor);
  const wb = new ExcelJS.Workbook();
  wb.creator = "OPS";
  wb.created = new Date();

  const ws = wb.addWorksheet(doc.labels.title, {
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 1, // Letter
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  COLUMN_WIDTHS.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });

  writeBrandBar(ws, accent);
  const afterMasthead = writeMasthead(ws, wb, doc, accent, logo);
  const afterFacts = writeFactStrip(ws, doc, accent, afterMasthead);

  const headerRow = afterFacts + 1;
  writeTableHeader(ws, doc, accent, headerRow);
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  ws.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];

  doc.rows.forEach((row, index) => {
    writeLineRow(ws, row, doc, headerRow + 1 + index, index % 2 === 1);
  });

  const totalsStart = headerRow + doc.rows.length + 2;
  writeTotals(ws, doc, accent, totalsStart);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
