/**
 * OPS Web - QuickBooks → OPS normalization helpers (pure, side-effect free)
 *
 * Maps raw QuickBooks Online JSON into the shape of the qbo_staging_* tables,
 * per the verified sandbox mappings (spec §5.4–5.7). No Supabase, no I/O — so
 * every transformation is unit-testable against fixture JSON.
 *
 * READ-ONLY semantics: these only read QB records; nothing here writes to QB.
 */

type QbRecord = Record<string, unknown>;

/** Public alias for a raw QB JSON record (exported for callers that pass records through). */
export type QbRecordLike = QbRecord;

// ─── Small typed views into the QB JSON ─────────────────────────────────────

interface QbBillAddr {
  Line1?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
}

/** A flattened SalesItemLineDetail line in staging shape (parent set by caller). */
export interface StagedLineCore {
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  is_taxable: boolean;
  qb_item_type: string | null;
  qb_line_id: string | null;
  sort_order: number;
}

export interface StagedLine extends StagedLineCore {
  parent_type: "invoice" | "estimate";
  parent_qb_id: string;
}

export interface StagedCustomerRow {
  qb_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
  raw: QbRecord;
}

export interface StagedInvoiceRow {
  qb_id: string;
  doc_number: string | null;
  customer_qb_id: string | null;
  estimate_qb_id: string | null;
  txn_date: string | null;
  due_date: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  tax_rate: number | null;
  total: number | null;
  balance: number | null;
  derived_status: string;
  raw: QbRecord;
}

export interface StagedEstimateRow {
  qb_id: string;
  doc_number: string | null;
  customer_qb_id: string | null;
  txn_date: string | null;
  expiration_date: string | null;
  txn_status: string;
  subtotal: number | null;
  tax_amount: number | null;
  tax_rate: number | null;
  total: number | null;
  raw: QbRecord;
}

export interface NormalizedInvoice {
  staging: StagedInvoiceRow;
  lines: StagedLine[];
  skipped: boolean;
  skipReason: string | null;
}

export interface NormalizedEstimate {
  staging: StagedEstimateRow;
  lines: StagedLine[];
}

export interface PaymentAppliedLine {
  invoice_qb_id: string;
  amount: number;
  reference_number: string | null;
}

export interface SplitPayment {
  qb_id: string;
  customer_qb_id: string | null;
  txn_date: string | null;
  total_amt: number | null;
  unappliedAmt: number | null;
  payment_method: string | null;
  applied: PaymentAppliedLine[];
}

// ─── Field accessors ────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** Round to cents, matching how line_total / QB Amount compare. */
function cents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─── Customer ───────────────────────────────────────────────────────────────

export function joinBillAddr(addr: QbBillAddr | undefined): string | null {
  if (!addr) return null;
  const line = [addr.Line1, addr.City].filter((p): p is string => !!p && p.length > 0);
  const region = [addr.CountrySubDivisionCode, addr.PostalCode]
    .filter((p): p is string => !!p && p.length > 0)
    .join(" ");
  const parts = [...line];
  if (region) parts.push(region);
  const joined = parts.join(", ");
  return joined.length > 0 ? joined : null;
}

export function normalizeCustomer(raw: QbRecord): StagedCustomerRow {
  const email = (raw.PrimaryEmailAddr as { Address?: string } | undefined)?.Address;
  const phone = (raw.PrimaryPhone as { FreeFormNumber?: string } | undefined)?.FreeFormNumber;
  return {
    qb_id: String(raw.Id),
    display_name: str(raw.DisplayName),
    email: str(email),
    phone: str(phone),
    address: joinBillAddr(raw.BillAddr as QbBillAddr | undefined),
    active: raw.Active !== false, // QB defaults active when absent
    raw,
  };
}

// ─── Line items ─────────────────────────────────────────────────────────────

/**
 * Map of QB Item.Id → Item.Type (e.g. "Inventory", "NonInventory", "Service"),
 * built from the QB Item catalog pull. Used to resolve each sales line's
 * ItemRef.value to its source item type so applyImport can classify the OPS
 * line as MATERIAL (Inventory/NonInventory) vs OTHER (everything else).
 */
export type ItemTypeMap = Map<string, string>;

/** Build an Item.Id → Item.Type map from raw QB Item catalog records. */
export function buildItemTypeMap(rawItems: unknown): ItemTypeMap {
  const arr = Array.isArray(rawItems) ? (rawItems as QbRecord[]) : [];
  const map: ItemTypeMap = new Map();
  for (const item of arr) {
    const id = str(item.Id);
    const type = str(item.Type);
    if (id && type) map.set(id, type);
  }
  return map;
}

function mapSalesLine(line: QbRecord, itemTypes?: ItemTypeMap): StagedLineCore {
  const detail = (line.SalesItemLineDetail as QbRecord) ?? {};
  const itemRef = detail.ItemRef as { name?: string; value?: string } | undefined;
  const description = str(line.Description);
  const name = description ?? str(itemRef?.name) ?? "Line item";
  const qty = num(detail.Qty) ?? 1;
  const unitPrice = num(detail.UnitPrice) ?? 0;
  const amount = num(line.Amount) ?? cents(qty * unitPrice);
  const taxCode = (detail.TaxCodeRef as { value?: string } | undefined)?.value;
  // Resolve the line's ItemRef.value → QB Item.Type via the catalog map. Null
  // when no map is supplied or the item is unknown — applyImport maps null and
  // every non-(Inventory|NonInventory) type to OTHER.
  const itemRefValue = str(itemRef?.value);
  const itemType = itemRefValue ? itemTypes?.get(itemRefValue) ?? null : null;
  return {
    name,
    description,
    quantity: qty,
    unit_price: unitPrice,
    amount: cents(amount),
    is_taxable: !!taxCode && taxCode !== "NON",
    qb_item_type: itemType,
    qb_line_id: str(line.Id),
    sort_order: num(line.LineNum) ?? 0,
  };
}

/**
 * Keep only SalesItemLineDetail lines. Skip SubTotal / Discount / DescriptionOnly.
 * Flatten GroupLineDetail.Line[] recursively. `itemTypes` resolves each line's
 * ItemRef.value → QB Item.Type (Inventory/NonInventory → MATERIAL downstream).
 */
export function flattenSalesLines(lines: unknown, itemTypes?: ItemTypeMap): StagedLineCore[] {
  const arr = Array.isArray(lines) ? (lines as QbRecord[]) : [];
  const out: StagedLineCore[] = [];
  for (const line of arr) {
    const detailType = line.DetailType;
    if (detailType === "SalesItemLineDetail") {
      out.push(mapSalesLine(line, itemTypes));
    } else if (detailType === "GroupLineDetail") {
      const nested = (line.GroupLineDetail as { Line?: unknown } | undefined)?.Line;
      out.push(...flattenSalesLines(nested, itemTypes));
    }
    // SubTotalLineDetail / DiscountLineDetail / DescriptionOnly → skip
  }
  return out;
}

function attachParent(
  cores: StagedLineCore[],
  parentType: "invoice" | "estimate",
  parentQbId: string
): StagedLine[] {
  return cores.map((c) => ({ ...c, parent_type: parentType, parent_qb_id: parentQbId }));
}

// ─── Header tax / totals ────────────────────────────────────────────────────

function subtotalFromLines(lines: unknown): number | null {
  const arr = Array.isArray(lines) ? (lines as QbRecord[]) : [];
  const subLine = arr.find((l) => l.DetailType === "SubTotalLineDetail");
  return subLine ? num(subLine.Amount) : null;
}

function taxFromTxnDetail(raw: QbRecord): { taxAmount: number | null; taxRate: number | null } {
  const detail = raw.TxnTaxDetail as
    | { TotalTax?: number; TaxLine?: Array<{ TaxLineDetail?: { TaxPercent?: number } }> }
    | undefined;
  if (!detail) return { taxAmount: null, taxRate: null };
  const taxAmount = num(detail.TotalTax);
  const firstTaxLine = Array.isArray(detail.TaxLine) ? detail.TaxLine[0] : undefined;
  const taxRate = num(firstTaxLine?.TaxLineDetail?.TaxPercent);
  return { taxAmount, taxRate };
}

// ─── Invoice ──────────────────────────────────────────────────────────────────

/** OPS invoices.status ∈ paid/partially_paid/past_due/awaiting_payment (derived subset). */
export function deriveInvoiceStatus(
  balance: number,
  total: number,
  dueDate: string | null,
  now: Date
): "paid" | "partially_paid" | "past_due" | "awaiting_payment" {
  if (balance <= 0) return "paid";
  if (balance < total) return "partially_paid";
  if (dueDate && new Date(`${dueDate}T00:00:00Z`).getTime() < now.getTime()) return "past_due";
  return "awaiting_payment";
}

function linkedEstimateId(raw: QbRecord): string | null {
  const linked = raw.LinkedTxn as Array<{ TxnId?: string; TxnType?: string }> | undefined;
  if (!Array.isArray(linked)) return null;
  const est = linked.find((l) => l.TxnType === "Estimate");
  return est?.TxnId ? String(est.TxnId) : null;
}

export function normalizeInvoice(raw: QbRecord, now: Date, itemTypes?: ItemTypeMap): NormalizedInvoice {
  const total = num(raw.TotalAmt) ?? 0;
  const balance = num(raw.Balance) ?? 0;
  const isVoid = String((raw as { PrivateNote?: string }).PrivateNote ?? "").toLowerCase().includes("voided")
    || raw.Voided === true;
  const skipped = total <= 0 || isVoid;
  const { taxAmount, taxRate } = taxFromTxnDetail(raw);
  const dueDate = str(raw.DueDate);
  const qbId = String(raw.Id);

  const staging: StagedInvoiceRow = {
    qb_id: qbId,
    doc_number: str(raw.DocNumber),
    customer_qb_id: str((raw.CustomerRef as { value?: string } | undefined)?.value),
    estimate_qb_id: linkedEstimateId(raw),
    txn_date: str(raw.TxnDate),
    due_date: dueDate,
    subtotal: subtotalFromLines(raw.Line),
    tax_amount: taxAmount,
    tax_rate: taxRate,
    total,
    balance,
    derived_status: skipped ? "skipped" : deriveInvoiceStatus(balance, total, dueDate, now),
    raw,
  };

  const lines = skipped ? [] : attachParent(flattenSalesLines(raw.Line, itemTypes), "invoice", qbId);
  return {
    staging,
    lines,
    skipped,
    skipReason: skipped ? (isVoid ? "voided" : "zero_total") : null,
  };
}

// ─── Estimate ───────────────────────────────────────────────────────────────

/** OPS estimates.status mapping from QB TxnStatus. */
export function mapEstimateStatus(
  txnStatus: string | null | undefined,
  expirationDate: string | null,
  now: Date
): "sent" | "approved" | "converted" | "declined" | "expired" {
  switch (txnStatus) {
    case "Accepted":
      return "approved";
    case "Closed":
      return "converted";
    case "Rejected":
      return "declined";
    case "Pending":
    default:
      if (expirationDate && new Date(`${expirationDate}T00:00:00Z`).getTime() < now.getTime()) {
        return "expired";
      }
      return "sent";
  }
}

export function normalizeEstimate(raw: QbRecord, now: Date, itemTypes?: ItemTypeMap): NormalizedEstimate {
  const { taxAmount, taxRate } = taxFromTxnDetail(raw);
  const expiration = str(raw.ExpirationDate);
  const qbId = String(raw.Id);
  const staging: StagedEstimateRow = {
    qb_id: qbId,
    doc_number: str(raw.DocNumber),
    customer_qb_id: str((raw.CustomerRef as { value?: string } | undefined)?.value),
    txn_date: str(raw.TxnDate),
    expiration_date: expiration,
    txn_status: mapEstimateStatus(str(raw.TxnStatus), expiration, now),
    subtotal: subtotalFromLines(raw.Line),
    tax_amount: taxAmount,
    tax_rate: taxRate,
    total: num(raw.TotalAmt),
    raw,
  };
  return { staging, lines: attachParent(flattenSalesLines(raw.Line, itemTypes), "estimate", qbId) };
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export function splitPaymentLines(raw: QbRecord): SplitPayment {
  const lineArr = Array.isArray(raw.Line) ? (raw.Line as QbRecord[]) : [];
  const topRef = str((raw as { PaymentRefNum?: string }).PaymentRefNum);
  const applied: PaymentAppliedLine[] = [];
  for (const line of lineArr) {
    const linked = line.LinkedTxn as Array<{ TxnId?: string; TxnType?: string }> | undefined;
    if (!Array.isArray(linked)) continue;
    for (const txn of linked) {
      if (txn.TxnType !== "Invoice" || !txn.TxnId) continue;
      const lineEx = (line.LineEx as { any?: Array<{ name?: string; value?: string }> } | undefined)?.any;
      const lineRef = lineEx?.find((e) => e.name === "txnReferenceNumber")?.value ?? null;
      applied.push({
        invoice_qb_id: String(txn.TxnId),
        amount: cents(num(line.Amount) ?? 0),
        reference_number: lineRef ?? topRef,
      });
    }
  }
  return {
    qb_id: String(raw.Id),
    customer_qb_id: str((raw.CustomerRef as { value?: string } | undefined)?.value),
    txn_date: str(raw.TxnDate),
    total_amt: num(raw.TotalAmt),
    unappliedAmt: num(raw.UnappliedAmt),
    payment_method: str((raw.PaymentMethodRef as { name?: string } | undefined)?.name),
    applied,
  };
}
