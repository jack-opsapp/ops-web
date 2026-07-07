import { createHash } from "node:crypto";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { getSpecAnalyticsPayload } from "./spec-analytics-queries";

export type SpecExportMode = "default" | "sensitive";

type CsvValue = unknown;
type CsvRow = Record<string, CsvValue>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UTF8_FLAG = 0x0800;
const ZIP_STORED = 0;
const ZIP_VERSION = 20;
const DOS_TIME_MIDNIGHT = 0;
const DOS_DATE_1980_01_01 = 0x0021;
const UINT32_MAX = 0xffffffff;
const textEncoder = new TextEncoder();

const SENSITIVE_KEY_RE =
  /(email|phone|name|address|postal|stripe|token|session|customer_id|payment_intent|charge_id|receipt|ip|user_agent)/i;

export function redactEmail(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function redactPhone(value: string): string {
  return createHash("sha256").update(value.replace(/\D/g, "")).digest("hex");
}

function normalizeDate(value: string | null, fallback: string): string {
  return value && DATE_RE.test(value) ? value : fallback;
}

function defaultDateRange(args: { from: string | null; to: string | null }) {
  const now = new Date();
  const to = normalizeDate(args.to, now.toISOString().slice(0, 10));
  const fromDate = new Date(`${to}T00:00:00.000Z`);
  fromDate.setDate(fromDate.getDate() - 13);
  const from = normalizeDate(args.from, fromDate.toISOString().slice(0, 10));
  return { from, to };
}

function csvCell(value: CsvValue): string {
  if (value == null) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function toCsv(rows: CsvRow[]): string {
  const headers = Array.from(
    rows.reduce((set, row) => {
      for (const key of Object.keys(row)) set.add(key);
      return set;
    }, new Set<string>()),
  );
  if (headers.length === 0) return "";
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const crc32Table = makeCrc32Table();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function assertZip32Size(label: string, value: number) {
  if (value > UINT32_MAX) {
    throw new Error(`${label} exceeds ZIP32 export limit`);
  }
}

function concatBytes(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  assertZip32Size("ZIP archive", totalBytes);
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function buildLocalHeader(entry: {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
}): Uint8Array {
  const header = new Uint8Array(30 + entry.nameBytes.length);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, ZIP_VERSION);
  writeUint16(view, 6, UTF8_FLAG);
  writeUint16(view, 8, ZIP_STORED);
  writeUint16(view, 10, DOS_TIME_MIDNIGHT);
  writeUint16(view, 12, DOS_DATE_1980_01_01);
  writeUint32(view, 14, entry.crc);
  writeUint32(view, 18, entry.size);
  writeUint32(view, 22, entry.size);
  writeUint16(view, 26, entry.nameBytes.length);
  writeUint16(view, 28, 0);
  header.set(entry.nameBytes, 30);
  return header;
}

function buildCentralDirectoryHeader(entry: {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}): Uint8Array {
  const header = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, ZIP_VERSION);
  writeUint16(view, 6, ZIP_VERSION);
  writeUint16(view, 8, UTF8_FLAG);
  writeUint16(view, 10, ZIP_STORED);
  writeUint16(view, 12, DOS_TIME_MIDNIGHT);
  writeUint16(view, 14, DOS_DATE_1980_01_01);
  writeUint32(view, 16, entry.crc);
  writeUint32(view, 20, entry.size);
  writeUint32(view, 24, entry.size);
  writeUint16(view, 28, entry.nameBytes.length);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, entry.offset);
  header.set(entry.nameBytes, 46);
  return header;
}

function buildEndOfCentralDirectory(args: {
  fileCount: number;
  centralDirectoryBytes: number;
  centralDirectoryOffset: number;
}): Uint8Array {
  const footer = new Uint8Array(22);
  const view = new DataView(footer.buffer);
  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, args.fileCount);
  writeUint16(view, 10, args.fileCount);
  writeUint32(view, 12, args.centralDirectoryBytes);
  writeUint32(view, 16, args.centralDirectoryOffset);
  writeUint16(view, 20, 0);
  return footer;
}

export function buildZipArchive(files: Record<string, string>): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;
  let centralBytes = 0;

  for (const [name, body] of Object.entries(files)) {
    if (!name || name.startsWith("/") || name.includes("..")) {
      throw new Error(`Invalid ZIP export path: ${name}`);
    }
    const nameBytes = textEncoder.encode(name);
    const data = textEncoder.encode(body);
    assertZip32Size(`${name} filename`, nameBytes.length);
    assertZip32Size(`${name} payload`, data.length);
    assertZip32Size(`${name} local header offset`, localOffset);

    const entry = {
      nameBytes,
      crc: crc32(data),
      size: data.length,
      offset: localOffset,
    };
    const localHeader = buildLocalHeader(entry);
    localChunks.push(localHeader, data);
    localOffset += localHeader.length + data.length;

    const centralHeader = buildCentralDirectoryHeader(entry);
    centralChunks.push(centralHeader);
    centralBytes += centralHeader.length;
  }

  if (centralChunks.length > 0xffff) {
    throw new Error("ZIP export exceeds file count limit");
  }
  assertZip32Size("central directory", centralBytes);
  assertZip32Size("central directory offset", localOffset);

  const footer = buildEndOfCentralDirectory({
    fileCount: centralChunks.length,
    centralDirectoryBytes: centralBytes,
    centralDirectoryOffset: localOffset,
  });

  return concatBytes([...localChunks, ...centralChunks, footer], localOffset + centralBytes + footer.length);
}

export function buildExportManifest(args: {
  mode: SpecExportMode;
  from: string;
  to: string;
  rowCounts: Record<string, number>;
}) {
  return {
    generated_at: new Date().toISOString(),
    date_range: { from: args.from, to: args.to },
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    timezone: "America/Vancouver",
    campaign_budget_cap_cents: 150_000,
    currency: "CAD",
    sensitive: args.mode === "sensitive",
    row_counts: args.rowCounts,
    known_latency: {
      google_ads: "current day may be partial",
      ga4: "24-48 hours",
    },
    configured: {
      google_ads: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
      ga4: Boolean(process.env.GA4_PROPERTY_ID),
      conversion_dispatch: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    },
  };
}

async function loadRows(table: string, from: string, to: string): Promise<CsvRow[]> {
  const db = getAdminSupabase();
  const isDailyTable = table === "ads_daily_search_term" || table.startsWith("ads_daily_");
  const orderColumn = isDailyTable ? "date" : "created_at";
  const fromValue = isDailyTable ? from : `${from}T00:00:00.000Z`;
  const toValue = isDailyTable ? to : `${to}T23:59:59.999Z`;

  const { data, error } = await db
    .from(table)
    .select("*")
    .gte(orderColumn, fromValue)
    .lte(orderColumn, toValue)
    .order(orderColumn, { ascending: false })
    .limit(10000);

  if (error) throw new Error(`${table} export failed: ${error.message}`);
  return (data ?? []) as CsvRow[];
}

function redactValue(key: string, value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/email/i.test(key)) return redactEmail(value);
    if (/phone/i.test(key)) return redactPhone(value);
    if (SENSITIVE_KEY_RE.test(key)) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactDeep(key, item));
  if (typeof value === "object") return redactDeep(key, value);
  return value;
}

function redactDeep(parentKey: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return redactValue(parentKey, value);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactValue(key, child);
  }
  return out;
}

function redactRow(row: CsvRow, mode: SpecExportMode): CsvRow {
  if (mode === "sensitive") return row;
  const out: CsvRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

export async function buildSpecAnalyticsExport(args: {
  mode: SpecExportMode;
  from: string | null;
  to: string | null;
}) {
  const range = defaultDateRange({ from: args.from, to: args.to });
  const [payload, specProjects, conversionEvents, analyticsEvents, searchTerms, campaigns] =
    await Promise.all([
      getSpecAnalyticsPayload(range.from, range.to),
      loadRows("spec_projects", range.from, range.to),
      loadRows("conversion_event_outbox", range.from, range.to),
      loadRows("analytics_events", range.from, range.to),
      loadRows("ads_daily_search_term", range.from, range.to),
      loadRows("ads_daily_campaign", range.from, range.to),
    ]);

  const rowCounts = {
    spec_projects: specProjects.length,
    conversion_event_outbox: conversionEvents.length,
    analytics_events: analyticsEvents.length,
    ads_daily_search_term: searchTerms.length,
    ads_daily_campaign: campaigns.length,
  };

  const manifest = buildExportManifest({
    mode: args.mode,
    from: range.from,
    to: range.to,
    rowCounts,
  });

  const bytes = buildZipArchive({
    "manifest.json": JSON.stringify(manifest, null, 2),
    "summary.json": JSON.stringify(payload, null, 2),
    "spec_projects.csv": toCsv(specProjects.map((row) => redactRow(row, args.mode))),
    "conversion_event_outbox.csv": toCsv(conversionEvents.map((row) => redactRow(row, args.mode))),
    "analytics_events.csv": toCsv(analyticsEvents.map((row) => redactRow(row, args.mode))),
    "ads_daily_search_term.csv": toCsv(searchTerms),
    "ads_daily_campaign.csv": toCsv(campaigns),
  });

  return {
    filename: `spec-analytics-${args.mode}-${range.from}-to-${range.to}.zip`,
    bytes,
  };
}
