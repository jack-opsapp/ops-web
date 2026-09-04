export interface ExtractedPdfText {
  pages: string[];
  text: string;
}

export interface ExtractedSupplierInvoiceLine {
  position: number;
  sku: string | null;
  description: string;
  orderedQuantity: string | null;
  invoicedQuantity: string;
  unitOfMeasure: string | null;
  unitPrice: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  jobHint: string | null;
}

export interface DeksMartInvoiceExtraction {
  supplierName: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  purchaseOrder: string | null;
  shippingReference: string | null;
  currency: string;
  subtotal: string | null;
  taxTotal: string | null;
  total: string | null;
  lines: ExtractedSupplierInvoiceLine[];
  confidence: "review_required";
  provenance: Record<string, string>;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export async function extractPdfText(
  bytes: Uint8Array
): Promise<ExtractedPdfText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let current = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        current = compact(`${current} ${item.str}`);
        if (item.hasEOL) {
          if (current) lines.push(current);
          current = "";
        }
      }
      if (current) lines.push(current);
      pages.push(lines.join("\n"));
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return { pages, text: pages.join("\n\n") };
}

function sourceLines(text: string): string[] {
  return text.split(/\r?\n/).map(compact).filter(Boolean);
}

function valueAfterLabel(
  lines: readonly string[],
  pattern: RegExp
): { value: string; source: string } | null {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.[1]) return { value: compact(match[1]), source: line };
  }
  return null;
}

function isoDate(value: string): string | null {
  const match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(value);
  if (!match) return null;
  const [, month, day, year] = match;
  const candidate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${candidate}T00:00:00Z`)) ? null : candidate;
}

function money(value: string): string {
  return value.replace(/[$,]/g, "");
}

function looksLikeJobAddress(line: string): boolean {
  return /^\d{1,6}\s+.+\b(?:BC|AB|ON)\b(?:\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d)?$/i.test(
    line
  );
}

const LINE_PATTERN =
  /^([A-Z0-9][A-Z0-9-]{1,39})\s+(.+?)\s+(\d+(?:\.\d{1,4})?)\s+(\d+(?:\.\d{1,4})?)\s+([A-Z][A-Z0-9]{0,9})\s+\$?([\d,]+(?:\.\d{2})?)\s+\$?([\d,]+(?:\.\d{2})?)$/i;
const ACTUAL_LINE_PATTERN =
  /^([A-Z][A-Z0-9-]{1,39})\s+(.+?)\s+([\d,]+(?:\.\d{1,4})?)\s+([A-Z]{1,10})\s+\$?([\d,]+(?:\.\d{2})?)\s+\$?([\d,]+(?:\.\d{2})?)\s+([\d,]+(?:\.\d{1,4})?)$/i;
const ACTUAL_LINE_WITHOUT_UNIT_PATTERN =
  /^([A-Z][A-Z0-9-]{1,39})\s+(.+?)\s+([\d,]+(?:\.\d{1,4})?)\s+\$?([\d,]+(?:\.\d{2})?)\s+\$?([\d,]+(?:\.\d{2})?)\s+([\d,]+(?:\.\d{1,4})?)$/i;

function cleanLineDescription(value: string): {
  description: string;
  jobHint: string | null;
} {
  const quotedJob = /\s*-?\s*"([^"]+)"\s*$/.exec(value);
  if (!quotedJob || !/^\d{1,6}\s+[A-Za-z]/.test(quotedJob[1])) {
    return { description: compact(value), jobHint: null };
  }
  return {
    description: compact(
      value.slice(0, quotedJob.index).replace(/\s*-\s*$/, "")
    ),
    jobHint: compact(quotedJob[1]),
  };
}

export function parseDeksMartInvoiceText(
  text: string
): DeksMartInvoiceExtraction {
  const lines = sourceLines(text);
  const provenance: Record<string, string> = {};
  const header = /^(\d{4}-\d{2}-\d{2})\s+([A-Z0-9-]+)$/.exec(lines[0] ?? "");
  const labelledInvoice = valueAfterLabel(
    lines,
    /^Invoice\s*(?:No\.?|Number|#)?\s*[:.]?\s*([A-Z0-9-]+)$/i
  );
  const labelledInvoiceDate = valueAfterLabel(
    lines,
    /^Invoice\s*Date\s*[:.]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})$/i
  );
  const dueDate = valueAfterLabel(
    lines,
    /^Due\s*Date\s*[:.]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})$/i
  );
  const purchaseOrder = valueAfterLabel(
    lines,
    /^(?:PO|P\.O\.)\s*(?:(?:Number|No\.?|#)\s*[:.]?\s+|[:.]\s*)(.+)$/i
  );
  const labelledShipVia = valueAfterLabel(
    lines,
    /^Ship\s*Via\s*[:.]?\s+(.+)$/i
  );
  const rawLabelledTracking = valueAfterLabel(
    lines,
    /^Tracking(?:\s*(?:No\.?|Number|#))?\s*[:.]?\s+(.+)$/i
  );
  const subtotal = valueAfterLabel(
    lines,
    /^Subtotal\s+\$?([\d,]+(?:\.\d{2})?)$/i
  );
  const tax = valueAfterLabel(
    lines,
    /^(?:Total\s+Tax|(?:GST|HST|Tax)(?:@|\s+)?\d*(?:\.\d+)?%?)\s+\$?([\d,]+(?:\.\d{2})?)$/i
  );
  const labelledTotal = valueAfterLabel(
    lines,
    /^Total(?:\s+(CAD|USD))?\s+\$?([\d,]+(?:\.\d{2})?)$/i
  );

  const invoice =
    labelledInvoice ?? (header ? { value: header[2], source: lines[0] } : null);
  const invoiceDate =
    labelledInvoiceDate ??
    (header ? { value: header[1], source: lines[0] } : null);
  const trackingMarker = lines.findIndex((line) =>
    /^Tracking Number$/i.test(line)
  );
  const markerTracking = trackingMarker >= 0 ? lines[trackingMarker + 1] : null;
  const markerShipVia = trackingMarker > 0 ? lines[trackingMarker - 1] : null;
  const labelledTracking =
    rawLabelledTracking && !/^Number$/i.test(rawLabelledTracking.value)
      ? rawLabelledTracking
      : null;
  const labelledShipViaValue =
    labelledShipVia && !/^Invoice\s*#$/i.test(labelledShipVia.value)
      ? labelledShipVia.value
      : null;
  const shipViaValue = labelledShipViaValue ?? markerShipVia;
  const trackingValue = labelledTracking?.value ?? markerTracking;
  const trailingAmounts = lines
    .filter((line) => /^\$[\d,]+(?:\.\d{2})$/.test(line))
    .map((line) => money(line));
  const labelledTotalLine = labelledTotal?.source.match(
    /^Total(?:\s+(CAD|USD))?\s+\$?([\d,]+(?:\.\d{2})?)$/i
  );

  if (invoice) provenance.invoiceNumber = invoice.source;
  if (invoiceDate) provenance.invoiceDate = invoiceDate.source;
  if (dueDate) provenance.dueDate = dueDate.source;
  if (purchaseOrder) provenance.purchaseOrder = purchaseOrder.source;
  if (shipViaValue)
    provenance.shipVia = labelledShipVia?.source ?? shipViaValue;
  if (trackingValue)
    provenance.tracking = labelledTracking?.source ?? trackingValue;
  if (subtotal) provenance.subtotal = subtotal.source;
  if (tax) provenance.taxTotal = tax.source;
  if (labelledTotal) provenance.total = labelledTotal.source;
  else if (trailingAmounts[0]) provenance.total = `$${trailingAmounts[0]}`;

  let currentJobHint: string | null = null;
  const extractedLines: ExtractedSupplierInvoiceLine[] = [];
  for (const line of lines) {
    if (looksLikeJobAddress(line)) {
      currentJobHint = line;
      continue;
    }
    const match = LINE_PATTERN.exec(line);
    if (match) {
      extractedLines.push({
        position: extractedLines.length + 1,
        sku: match[1].toUpperCase(),
        description: compact(match[2]),
        orderedQuantity: match[3],
        invoicedQuantity: match[4],
        unitOfMeasure: match[5].toUpperCase(),
        unitPrice: money(match[6]),
        subtotal: money(match[7]),
        taxAmount: "0.00",
        total: money(match[7]),
        jobHint: currentJobHint,
      });
      continue;
    }

    const actual = ACTUAL_LINE_PATTERN.exec(line);
    const withoutUnit = actual
      ? null
      : ACTUAL_LINE_WITHOUT_UNIT_PATTERN.exec(line);
    if (!actual && !withoutUnit) continue;
    const parts = actual ?? withoutUnit!;
    const description = cleanLineDescription(parts[2]);
    const invoiced = money(parts[3]);
    const unit = actual ? parts[4].toUpperCase() : null;
    const unitPrice = money(actual ? parts[5] : parts[4]);
    const amount = money(actual ? parts[6] : parts[5]);
    const ordered = money(actual ? parts[7] : parts[6]);
    extractedLines.push({
      position: extractedLines.length + 1,
      sku: parts[1].toUpperCase(),
      description: description.description,
      orderedQuantity: ordered,
      invoicedQuantity: invoiced,
      unitOfMeasure: unit,
      unitPrice,
      subtotal: amount,
      taxAmount: "0.00",
      total: amount,
      jobHint: description.jobHint ?? currentJobHint,
    });
  }

  const shippingParts = [shipViaValue, trackingValue].filter(
    (value): value is string => Boolean(value)
  );

  return {
    supplierName:
      lines.find((line) => /deksmart\s+vinyl\s+products/i.test(line)) ??
      "DeksMart Vinyl Products",
    invoiceNumber: invoice?.value ?? null,
    invoiceDate: invoiceDate
      ? /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate.value)
        ? invoiceDate.value
        : isoDate(invoiceDate.value)
      : null,
    dueDate: dueDate ? isoDate(dueDate.value) : null,
    purchaseOrder: purchaseOrder?.value ?? null,
    shippingReference:
      shippingParts.length > 0 ? shippingParts.join(" · ") : null,
    currency: labelledTotalLine?.[1]?.toUpperCase() ?? "CAD",
    subtotal: subtotal
      ? money(subtotal.value)
      : (trailingAmounts.at(-1) ?? null),
    taxTotal: tax ? money(tax.value) : null,
    total: labelledTotalLine?.[2]
      ? money(labelledTotalLine[2])
      : (trailingAmounts[0] ?? null),
    lines: extractedLines,
    confidence: "review_required",
    provenance,
  };
}
