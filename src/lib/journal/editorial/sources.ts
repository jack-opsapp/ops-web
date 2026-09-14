import "server-only";

import { createHash } from "node:crypto";

import { JSDOM } from "jsdom";

import {
  PublicMediaError,
  fetchPublicResource,
  type PublicMediaDependencies,
  type PublicResource,
} from "@/lib/social/public-media";

/**
 * OPS-owned source snapshots for the weekly journal.
 *
 * The writer only proposes URLs. OPS fetches every page itself through the
 * guarded public fetch, keeps the raw bytes' hash, and reduces the body to
 * normalised readable text. Quoted facts are later verified verbatim against
 * `text`, so extraction must be deterministic: the same bytes always yield the
 * same snapshot, on any machine, in any timezone.
 */

const SOURCE_ACCEPT =
  "text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8";
const SOURCE_MAX_BYTES = 8 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 15_000;
const SOURCE_MIN_TEXT_CHARS = 200;
const SOURCE_MAX_TEXT_CHARS = 150_000;
const SOURCE_MAX_TITLE_CHARS = 300;
const SOURCE_MAX_SITE_NAME_CHARS = 120;
const SOURCE_MAX_PDF_PAGES = 60;

export type JournalSourceContentType =
  | "text/html"
  | "text/plain"
  | "application/pdf";

const SOURCE_CONTENT_TYPES: ReadonlyMap<string, JournalSourceContentType> =
  new Map<string, JournalSourceContentType>([
    ["text/html", "text/html"],
    ["application/xhtml+xml", "text/html"],
    ["text/plain", "text/plain"],
    ["application/pdf", "application/pdf"],
  ]);

export interface JournalSourceSnapshot {
  /** The requested URL, normalised by `new URL().toString()`. */
  url: string;
  /** The URL that produced the body, after redirects. */
  final_url: string;
  http_status: number;
  content_type: JournalSourceContentType;
  bytes: number;
  /** Hex SHA-256 of the raw response body. */
  sha256: string;
  /** At most 300 characters. */
  title: string | null;
  /** At most 120 characters. */
  site_name: string | null;
  /** ISO-8601 instant, or null when no valid date was declared. */
  published_hint: string | null;
  /** ISO-8601 instant, or null when no valid date was declared. */
  modified_hint: string | null;
  /** Normalised readable text, at most 150,000 characters. */
  text: string;
  /** True when text was cut at 150,000 characters or PDF pages were skipped. */
  truncated: boolean;
}

export type JournalSourceErrorCode =
  | "SOURCE_URL_INVALID"
  | "SOURCE_PRIVATE_ADDRESS"
  | "SOURCE_DNS_FAILED"
  | "SOURCE_FETCH_FAILED"
  | "SOURCE_TIMEOUT"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_UNSUPPORTED_TYPE"
  | "SOURCE_UNREADABLE"
  | "SOURCE_EMPTY";

export class JournalSourceError extends Error {
  /** HTTP status of the refused response, when one was received. */
  declare readonly status?: number;

  constructor(
    public readonly code: JournalSourceErrorCode,
    message: string,
    options: { status?: number; cause?: unknown } = {}
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "JournalSourceError";
    if (options.status !== undefined) this.status = options.status;
  }
}

export interface HtmlSourceExtraction {
  title: string | null;
  site_name: string | null;
  published_hint: string | null;
  modified_hint: string | null;
  text: string;
}

export interface PdfSourceExtraction {
  title: string | null;
  text: string;
  /** True when the document has more pages than were read. */
  truncated: boolean;
}

// ─── Text normalisation ─────────────────────────────────────────────────────

/**
 * The single normal form every snapshot is stored and verified in: NFC, the
 * three no-break spaces as plain spaces, space and tab runs collapsed, every
 * line trimmed, at most one blank line in a row, trimmed.
 */
export function normaliseSourceText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return value.slice(0, end);
}

/** One-line, normalised, clipped metadata value; empty becomes null. */
function inlineValue(value: string | null | undefined, max: number) {
  if (!value) return null;
  const cleaned = normaliseSourceText(value).replace(/\s*\n\s*/g, " ");
  return cleaned ? clip(cleaned, max).trimEnd() : null;
}

function firstInlineValue(
  candidates: readonly (string | null | undefined)[],
  max: number
): string | null {
  for (const candidate of candidates) {
    const value = inlineValue(candidate, max);
    if (value) return value;
  }
  return null;
}

function hostnameLabel(rawUrl: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    return null;
  }
  return inlineValue(
    hostname.replace(/^\[|\]$/g, "").replace(/^www\./i, ""),
    SOURCE_MAX_SITE_NAME_CHARS
  );
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;
const RFC_DATE_TIME =
  /^(?:[a-z]{3},?\s+)?(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*(gmt|utc|ut|z|[+-]\d{4})$/i;
const MONTH_DAY_YEAR =
  /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i;
const DAY_MONTH_YEAR =
  /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i;

function offsetMinutes(zone: string | undefined): number | null {
  if (!zone || /^(?:z|gmt|utc|ut)$/i.test(zone)) return 0;
  const match = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  if (hours > 23 || minutes > 59) return null;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

function utcInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
  offset = 0
): string | null {
  if (
    year < 1000 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const instant =
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
    offset * 60_000;
  const iso = new Date(instant).toISOString();
  return /^\d{4}-/.test(iso) ? iso : null;
}

/**
 * Parses a declared publication date into an ISO-8601 instant. Accepts ISO
 * 8601 calendar dates and date-times, RFC 2822 date-times with an explicit
 * zone, and written dates ("March 5, 2026", "5 March 2026"). A value without a
 * zone is read as UTC — never as server-local time, which would make the same
 * page snapshot differently on different machines.
 */
function parseDateHint(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 64) return null;

  const iso = ISO_DATE_TIME.exec(value);
  if (iso) {
    const offset = offsetMinutes(iso[8]);
    if (offset === null) return null;
    return utcInstant(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      Number(iso[4] ?? "0"),
      Number(iso[5] ?? "0"),
      Number(iso[6] ?? "0"),
      Number((iso[7] ?? "0").slice(0, 3).padEnd(3, "0")),
      offset
    );
  }

  const rfc = RFC_DATE_TIME.exec(value);
  if (rfc) {
    const month = MONTHS[rfc[2].toLowerCase()];
    const offset = offsetMinutes(rfc[7]);
    if (!month || offset === null) return null;
    return utcInstant(
      Number(rfc[3]),
      month,
      Number(rfc[1]),
      Number(rfc[4]),
      Number(rfc[5]),
      Number(rfc[6] ?? "0"),
      0,
      offset
    );
  }

  const monthFirst = MONTH_DAY_YEAR.exec(value);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    return month
      ? utcInstant(Number(monthFirst[3]), month, Number(monthFirst[2]))
      : null;
  }

  const dayFirst = DAY_MONTH_YEAR.exec(value);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    return month
      ? utcInstant(Number(dayFirst[3]), month, Number(dayFirst[1]))
      : null;
  }

  return null;
}

function firstValidDate(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    const parsed = parseDateHint(candidate);
    if (parsed) return parsed;
  }
  return null;
}

// ─── HTML ───────────────────────────────────────────────────────────────────

const NON_CONTENT_SELECTOR =
  "script, style, noscript, svg, template, iframe, nav, header, footer, aside, form, button, select";

/** Elements whose boundaries are line boundaries in the readable text. */
const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "blockquote",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hgroup",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const PREFORMATTED_ELEMENTS = new Set(["pre", "listing", "plaintext", "xmp"]);
const OPEN_GRAPH_ATTRIBUTES = ["property", "name"] as const;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function metaValues(
  document: Document,
  attributes: readonly string[],
  key: string
): string[] {
  const values: string[] = [];
  for (const attribute of attributes) {
    for (const meta of Array.from(
      document.querySelectorAll(`meta[${attribute}]`)
    )) {
      if (meta.getAttribute(attribute)?.trim().toLowerCase() !== key) continue;
      const content = meta.getAttribute("content")?.trim();
      if (content) values.push(content);
    }
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectJsonLdNodes(
  value: unknown,
  into: Record<string, unknown>[],
  depth = 0
): void {
  if (depth > 4) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdNodes(item, into, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  into.push(value);
  if ("@graph" in value) collectJsonLdNodes(value["@graph"], into, depth + 1);
}

function jsonLdStrings(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  const strings: string[] = [];
  for (const item of items) {
    if (typeof item === "string") strings.push(item);
    else if (isRecord(item) && typeof item["@value"] === "string") {
      strings.push(item["@value"]);
    }
  }
  return strings;
}

/** Article-like schema.org types, whose dates describe the page's content. */
function isArticleNode(node: Record<string, unknown>): boolean {
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return types.some(
    (type) =>
      typeof type === "string" &&
      /(?:Article|Posting|Report)$/.test(type.replace(/^.*[/#:]/, ""))
  );
}

/**
 * JSON-LD publication dates, article nodes first. Arrays and `@graph` are
 * followed; malformed blocks are skipped.
 */
function readJsonLdDates(document: Document): {
  published: string[];
  modified: string[];
} {
  const nodes: Record<string, unknown>[] = [];
  for (const script of Array.from(document.querySelectorAll("script"))) {
    const type = (script.getAttribute("type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (type !== "application/ld+json") continue;
    try {
      collectJsonLdNodes(JSON.parse(script.textContent ?? ""), nodes);
    } catch {
      continue;
    }
  }
  const ordered = [
    ...nodes.filter(isArticleNode),
    ...nodes.filter((node) => !isArticleNode(node)),
  ];
  return {
    published: ordered.flatMap((node) => jsonLdStrings(node.datePublished)),
    modified: ordered.flatMap((node) => jsonLdStrings(node.dateModified)),
  };
}

/** `time[datetime]` values, preferring the article, then the main region. */
function timeElementDates(document: Document): string[] {
  const seen = new Set<Element>();
  const values: string[] = [];
  for (const selector of [
    "article time[datetime]",
    "main time[datetime]",
    "time[datetime]",
  ]) {
    for (const element of Array.from(document.querySelectorAll(selector))) {
      if (seen.has(element)) continue;
      seen.add(element);
      values.push(element.getAttribute("datetime") ?? "");
    }
  }
  return values;
}

function removeNonContent(document: Document): void {
  for (const element of Array.from(
    document.querySelectorAll(NON_CONTENT_SELECTOR)
  )) {
    element.remove();
  }
  for (const element of Array.from(
    document.querySelectorAll("[hidden], [aria-hidden]")
  )) {
    if (
      element.hasAttribute("hidden") ||
      element.getAttribute("aria-hidden")?.trim().toLowerCase() === "true"
    ) {
      element.remove();
    }
  }
}

/**
 * Accumulates rendered text. Whitespace collapses the way a browser renders
 * it, and block boundaries become exactly one line break, so adjacent blocks
 * never run together and never open an accidental blank line.
 */
class ReadableTextSink {
  private readonly parts: string[] = [];
  private atLineStart = true;
  private pendingSpace = false;

  text(value: string, preformatted: boolean): void {
    if (!value) return;
    if (preformatted) {
      if (this.pendingSpace && !this.atLineStart) this.parts.push(" ");
      const text = value.replace(/\r\n?/g, "\n");
      this.parts.push(text);
      this.atLineStart = text.endsWith("\n");
      this.pendingSpace = false;
      return;
    }
    const collapsed = value.replace(/[\t\n\f\r ]+/g, " ");
    const leading = collapsed.startsWith(" ");
    const trailing = collapsed.endsWith(" ");
    const core = collapsed.slice(
      leading ? 1 : 0,
      trailing ? collapsed.length - 1 : collapsed.length
    );
    if (!core) {
      if (!this.atLineStart) this.pendingSpace = true;
      return;
    }
    if ((leading || this.pendingSpace) && !this.atLineStart) {
      this.parts.push(" ");
    }
    this.parts.push(core);
    this.atLineStart = false;
    this.pendingSpace = trailing;
  }

  blockBoundary(): void {
    if (!this.atLineStart) {
      this.parts.push("\n");
      this.atLineStart = true;
    }
    this.pendingSpace = false;
  }

  lineBreak(): void {
    this.parts.push("\n");
    this.atLineStart = true;
    this.pendingSpace = false;
  }

  toString(): string {
    return this.parts.join("");
  }
}

type WalkFrame =
  | { readonly node: Node; readonly preformatted: boolean }
  | { readonly exitBlock: boolean };

/** Walks the tree iteratively, so hostile nesting depth cannot overflow. */
function readableText(root: Element | null): string {
  if (!root) return "";
  const sink = new ReadableTextSink();
  const stack: WalkFrame[] = [{ node: root, preformatted: false }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if ("exitBlock" in frame) {
      if (frame.exitBlock) sink.blockBoundary();
      continue;
    }
    const { node, preformatted } = frame;
    if (node.nodeType === TEXT_NODE) {
      sink.text((node as Text).data, preformatted);
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;
    const tag = (node as Element).localName;
    if (tag === "br") {
      sink.lineBreak();
      continue;
    }
    const block = BLOCK_ELEMENTS.has(tag);
    if (block) sink.blockBoundary();
    stack.push({ exitBlock: block });
    const childPreformatted = preformatted || PREFORMATTED_ELEMENTS.has(tag);
    const children = node.childNodes;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], preformatted: childPreformatted });
    }
  }
  return sink.toString();
}

/**
 * Reads an HTML document without running scripts or loading resources.
 * Metadata is read first (JSON-LD lives in scripts, headlines in headers),
 * then chrome and hidden content are removed and the body is read as text.
 */
export function extractHtmlSource(
  html: string,
  finalUrl: string
): HtmlSourceExtraction {
  const dom = new JSDOM(html, { contentType: "text/html" });
  try {
    const { document } = dom.window;
    const structured = readJsonLdDates(document);

    const title = firstInlineValue(
      [
        ...metaValues(document, OPEN_GRAPH_ATTRIBUTES, "og:title"),
        document.title,
        document.querySelector("h1")?.textContent,
      ],
      SOURCE_MAX_TITLE_CHARS
    );
    const siteName =
      firstInlineValue(
        metaValues(document, OPEN_GRAPH_ATTRIBUTES, "og:site_name"),
        SOURCE_MAX_SITE_NAME_CHARS
      ) ?? hostnameLabel(finalUrl);
    const published = firstValidDate([
      ...metaValues(document, OPEN_GRAPH_ATTRIBUTES, "article:published_time"),
      ...metaValues(document, ["name"], "date"),
      ...metaValues(document, ["name"], "dc.date"),
      ...metaValues(document, ["itemprop"], "datepublished"),
      ...structured.published,
      ...timeElementDates(document),
    ]);
    const modified = firstValidDate([
      ...metaValues(document, OPEN_GRAPH_ATTRIBUTES, "article:modified_time"),
      ...structured.modified,
    ]);

    removeNonContent(document);

    return {
      title,
      site_name: siteName,
      published_hint: published,
      modified_hint: modified,
      text: normaliseSourceText(readableText(document.body)),
    };
  } finally {
    dom.window.close();
  }
}

// ─── Character encoding ─────────────────────────────────────────────────────

function byteOrderMarkEncoding(buffer: Buffer): string | null {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "utf-8";
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return "utf-16be";
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return "utf-16le";
  return null;
}

/** The HTML prescan: a charset declared in the first 1024 bytes. */
function declaredDocumentEncoding(buffer: Buffer): string | null {
  const head = buffer.subarray(0, 1024).toString("latin1");
  const declared =
    /<meta\b[^>]*?charset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(head)?.[1] ??
    /^\s*<\?xml\b[^>]*?encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1] ??
    null;
  if (!declared) return null;
  // A document cannot declare UTF-16 about itself in ASCII-compatible bytes.
  return /^utf-16/i.test(declared) ? "utf-8" : declared.toLowerCase();
}

/** Byte order mark, then the header charset, then the document's own claim. */
function decodeSourceText(
  buffer: Buffer,
  headerCharset: string | null,
  html: boolean
): string {
  const candidates = [
    byteOrderMarkEncoding(buffer),
    headerCharset,
    html ? declaredDocumentEncoding(buffer) : null,
  ];
  for (const label of candidates) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(buffer);
    } catch {
      continue;
    }
  }
  return new TextDecoder("utf-8").decode(buffer);
}

// ─── PDF ────────────────────────────────────────────────────────────────────

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsModule: Promise<PdfjsModule> | null = null;

/**
 * pdf.js parses on this thread in Node. Left alone it would import
 * "./pdf.worker.mjs" relative to its own file at runtime, a path that does not
 * exist once Next bundles a route. Registering the worker module up front
 * gives pdf.js its handler directly and lets the bundler trace both imports.
 */
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsModule ??= (async () => {
    // @ts-expect-error pdfjs-dist ships no type declarations for its worker entry.
    const worker: unknown = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const scope = globalThis as typeof globalThis & { pdfjsWorker?: unknown };
    scope.pdfjsWorker ??= worker;
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })().catch((error: unknown) => {
    pdfjsModule = null;
    throw error;
  });
  return pdfjsModule;
}

/**
 * Reads the text layer of up to 60 pages. Items are joined as pdf.js emits
 * them (it inserts its own word spaces), lines break at each end-of-line, and
 * pages are separated by a blank line.
 */
export async function extractPdfSource(
  buffer: Buffer
): Promise<PdfSourceExtraction> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    // A copy: pdf.js may take ownership of the bytes it is given.
    data: new Uint8Array(buffer),
    disableFontFace: true,
    enableXfa: false,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
  });

  try {
    const document = await loadingTask.promise;
    const pageCount = Math.min(document.numPages, SOURCE_MAX_PDF_PAGES);
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let pageText = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          pageText += item.str;
          if (item.hasEOL) pageText += "\n";
        }
        pages.push(pageText);
      } finally {
        page.cleanup();
      }
    }

    let title: string | null = null;
    try {
      const { info } = await document.getMetadata();
      const declared = (info as Record<string, unknown>).Title;
      title =
        typeof declared === "string"
          ? inlineValue(declared, SOURCE_MAX_TITLE_CHARS)
          : null;
    } catch {
      title = null;
    }

    return {
      title,
      text: normaliseSourceText(pages.join("\n\n")),
      truncated: document.numPages > pageCount,
    };
  } catch (error) {
    throw new JournalSourceError(
      "SOURCE_UNREADABLE",
      "Source PDF could not be read",
      { cause: error }
    );
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

// ─── Fetch ──────────────────────────────────────────────────────────────────

function journalErrorFromFetch(error: unknown): JournalSourceError {
  if (!(error instanceof PublicMediaError)) {
    return new JournalSourceError(
      "SOURCE_FETCH_FAILED",
      "Source could not be downloaded",
      { cause: error }
    );
  }
  const options = { status: error.status, cause: error };
  switch (error.code) {
    case "INVALID_URL":
      return new JournalSourceError(
        "SOURCE_URL_INVALID",
        "Source URL must be a public HTTPS address",
        options
      );
    case "PRIVATE_ADDRESS":
      return new JournalSourceError(
        "SOURCE_PRIVATE_ADDRESS",
        "Source URL targets a private address",
        options
      );
    case "DNS_FAILED":
      return new JournalSourceError(
        "SOURCE_DNS_FAILED",
        "Source host could not be resolved",
        options
      );
    case "FETCH_TIMEOUT":
      return new JournalSourceError(
        "SOURCE_TIMEOUT",
        "Source download timed out",
        options
      );
    case "FETCH_FAILED":
    case "TOO_MANY_REDIRECTS":
      // The guarded fetch already phrases these for a generic source.
      return new JournalSourceError(
        "SOURCE_FETCH_FAILED",
        error.message,
        options
      );
    case "INVALID_CONTENT_TYPE":
      return new JournalSourceError(
        "SOURCE_UNSUPPORTED_TYPE",
        "Source is not HTML, plain text, or PDF",
        options
      );
    case "RESOURCE_TOO_LARGE":
    case "IMAGE_TOO_LARGE":
      return new JournalSourceError(
        "SOURCE_TOO_LARGE",
        "Source exceeds the 8 MB limit",
        options
      );
    case "INVALID_IMAGE":
      return new JournalSourceError(
        "SOURCE_UNREADABLE",
        "Source could not be read",
        options
      );
    default: {
      const unreachable: never = error.code;
      return new JournalSourceError(
        "SOURCE_FETCH_FAILED",
        `Source could not be downloaded (${String(unreachable)})`,
        { cause: error }
      );
    }
  }
}

/**
 * Fetches one cited source through the guarded public fetch and returns its
 * snapshot. Every failure is a `JournalSourceError`, except a PDF reader that
 * cannot load at all — an infrastructure fault, left loud on purpose.
 */
export async function fetchJournalSource(
  url: string,
  deps: Partial<PublicMediaDependencies> = {}
): Promise<JournalSourceSnapshot> {
  let requestedUrl: string;
  try {
    requestedUrl = new URL(url).toString();
  } catch (error) {
    throw new JournalSourceError(
      "SOURCE_URL_INVALID",
      "Source URL must be a public HTTPS address",
      { cause: error }
    );
  }

  let resource: PublicResource;
  try {
    resource = await fetchPublicResource(
      requestedUrl,
      {
        accept: SOURCE_ACCEPT,
        maxBytes: SOURCE_MAX_BYTES,
        timeoutMs: SOURCE_TIMEOUT_MS,
        allowedContentTypes: (contentType) =>
          SOURCE_CONTENT_TYPES.has(contentType),
      },
      deps
    );
  } catch (error) {
    throw journalErrorFromFetch(error);
  }

  const contentType = SOURCE_CONTENT_TYPES.get(resource.contentType);
  if (!contentType) {
    throw new JournalSourceError(
      "SOURCE_UNSUPPORTED_TYPE",
      "Source is not HTML, plain text, or PDF"
    );
  }

  let extracted: HtmlSourceExtraction & { truncated: boolean };
  if (contentType === "application/pdf") {
    const pdf = await extractPdfSource(resource.buffer);
    extracted = {
      title: pdf.title,
      site_name: hostnameLabel(resource.finalUrl),
      published_hint: null,
      modified_hint: null,
      text: pdf.text,
      truncated: pdf.truncated,
    };
  } else if (contentType === "text/html") {
    const html = decodeSourceText(resource.buffer, resource.charset, true);
    try {
      extracted = {
        ...extractHtmlSource(html, resource.finalUrl),
        truncated: false,
      };
    } catch (error) {
      throw new JournalSourceError(
        "SOURCE_UNREADABLE",
        "Source HTML could not be read",
        { cause: error }
      );
    }
  } else {
    extracted = {
      title: null,
      site_name: hostnameLabel(resource.finalUrl),
      published_hint: null,
      modified_hint: null,
      text: normaliseSourceText(
        decodeSourceText(resource.buffer, resource.charset, false)
      ),
      truncated: false,
    };
  }

  if (extracted.text.length < SOURCE_MIN_TEXT_CHARS) {
    throw new JournalSourceError(
      "SOURCE_EMPTY",
      "Source has too little readable text to cite"
    );
  }
  const overLimit = extracted.text.length > SOURCE_MAX_TEXT_CHARS;

  return {
    url: requestedUrl,
    final_url: resource.finalUrl,
    http_status: resource.status,
    content_type: contentType,
    bytes: resource.buffer.byteLength,
    sha256: createHash("sha256").update(resource.buffer).digest("hex"),
    title: extracted.title,
    site_name: extracted.site_name,
    published_hint: extracted.published_hint,
    modified_hint: extracted.modified_hint,
    text: overLimit
      ? clip(extracted.text, SOURCE_MAX_TEXT_CHARS)
      : extracted.text,
    truncated: extracted.truncated || overLimit,
  };
}
