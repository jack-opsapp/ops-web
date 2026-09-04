import "server-only";

import type { AccountingSyncQueueEntityType } from "./accounting-sync-queue-types";

type DbRow = Record<string, unknown>;

export interface SageCanonicalLine {
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  ledgerAccountId: string | null;
  taxRateId: string | null;
  taxRate: number | null;
}

export interface NormalizedSageRecord {
  externalId: string;
  updatedAt: string;
  deletedAt: string | null;
  payload: Record<string, unknown>;
}

export class SageNormalizeError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SageNormalizeError";
  }
}

function row(value: unknown): DbRow | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DbRow)
    : null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function requiredText(value: unknown, code: string, label: string): string {
  const normalized = text(value);
  if (!normalized) throw new SageNormalizeError(code, `${label} is missing.`);
  return normalized;
}

function nestedId(value: unknown): string | null {
  return text(row(value)?.id) ?? text(value);
}

function date(value: unknown, code: string, label: string): string {
  const normalized = requiredText(value, code, label);
  const match = normalized.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match || !Number.isFinite(Date.parse(`${match[0]}T00:00:00Z`))) {
    throw new SageNormalizeError(code, `${label} is invalid.`);
  }
  return match[0];
}

function timestamp(value: unknown, code: string, label: string): string {
  const normalized = requiredText(value, code, label);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new SageNormalizeError(code, `${label} is invalid.`);
  }
  return new Date(parsed).toISOString();
}

function optionalTimestamp(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new SageNormalizeError(
      "sage_deleted_at_invalid",
      "Sage deletion timestamp is invalid."
    );
  }
  return new Date(parsed).toISOString();
}

function number(
  value: unknown,
  code: string,
  label: string,
  fallback?: number
): number {
  if (
    (value === null || value === undefined || value === "") &&
    fallback !== undefined
  ) {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(parsed)) {
    throw new SageNormalizeError(code, `${label} is invalid.`);
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const nested = row(value)?.$items;
  return Array.isArray(nested) ? nested : [];
}

function statusText(value: unknown): string {
  const status = row(value);
  return (
    text(status?.id) ??
    text(status?.displayed_as) ??
    text(value) ??
    ""
  ).toLowerCase();
}

function normalizedLine(raw: unknown): SageCanonicalLine {
  const source = row(raw);
  if (!source) {
    throw new SageNormalizeError(
      "sage_line_invalid",
      "Sage document line is invalid."
    );
  }
  const quantity = number(
    source.quantity,
    "sage_line_quantity_invalid",
    "Sage line quantity"
  );
  const unitPrice = number(
    source.unit_price,
    "sage_line_unit_price_invalid",
    "Sage line unit price"
  );
  const calculatedSubtotal =
    Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
  const subtotal = number(
    source.net_amount ?? source.subtotal,
    "sage_line_subtotal_invalid",
    "Sage line subtotal",
    calculatedSubtotal
  );
  const taxAmount = number(
    source.tax_amount,
    "sage_line_tax_invalid",
    "Sage line tax",
    0
  );
  const total = number(
    source.total_amount ?? source.total,
    "sage_line_total_invalid",
    "Sage line total",
    subtotal + taxAmount
  );
  const tax = row(source.tax_rate);
  return {
    description: requiredText(
      source.description ?? source.displayed_as,
      "sage_line_description_missing",
      "Sage line description"
    ),
    quantity,
    unitPrice,
    subtotal,
    taxAmount,
    total,
    ledgerAccountId:
      nestedId(source.ledger_account) ?? text(source.ledger_account_id),
    taxRateId: nestedId(source.tax_rate) ?? text(source.tax_rate_id),
    taxRate:
      tax?.percentage === null || tax?.percentage === undefined
        ? null
        : number(
            tax.percentage,
            "sage_line_tax_rate_invalid",
            "Sage line tax rate"
          ),
  };
}

function requiredLines(value: unknown): SageCanonicalLine[] {
  const lines = items(value).map(normalizedLine);
  if (lines.length === 0) {
    throw new SageNormalizeError(
      "sage_lines_missing",
      "Sage financial document has no lines."
    );
  }
  return lines;
}

function base(raw: DbRow): Omit<NormalizedSageRecord, "payload"> {
  return {
    externalId: requiredText(raw.id, "sage_id_missing", "Sage identity"),
    updatedAt: timestamp(
      raw.updated_at,
      "sage_updated_at_invalid",
      "Sage update timestamp"
    ),
    deletedAt: optionalTimestamp(raw.deleted_at),
  };
}

function invoiceStatus(raw: DbRow, total: number, outstanding: number): string {
  const status = statusText(raw.status);
  if (raw.deleted_at || status.includes("void") || status.includes("delete")) {
    return "void";
  }
  if (outstanding <= 0) return "paid";
  if (outstanding < total) return "partially_paid";
  return "awaiting_payment";
}

function estimateStatus(raw: DbRow): string {
  const status = statusText(raw.status);
  if (status.includes("accept")) return "approved";
  if (status.includes("convert")) return "converted";
  if (status.includes("declin") || status.includes("expir")) return "declined";
  if (status.includes("draft")) return "draft";
  return "sent";
}

function normalizeContact(raw: DbRow): NormalizedSageRecord {
  const normalized = base(raw);
  const inactive = raw.active === false || Boolean(normalized.deletedAt);
  return {
    ...normalized,
    deletedAt: normalized.deletedAt ?? (inactive ? normalized.updatedAt : null),
    payload: {
      name: requiredText(
        raw.name ?? raw.displayed_as,
        "sage_contact_name_missing",
        "Sage contact name"
      ),
      email: text(raw.email),
      phone: text(raw.telephone ?? raw.phone),
      taxNumber: text(raw.tax_number),
    },
  };
}

function normalizeSalesDocument(
  raw: DbRow,
  resource: "sales_invoices" | "sales_quotes" | "sales_estimates"
): NormalizedSageRecord {
  const normalized = base(raw);
  const lineKey =
    resource === "sales_invoices"
      ? "invoice_lines"
      : resource === "sales_quotes"
        ? "quote_lines"
        : "estimate_lines";
  const lines = normalized.deletedAt ? [] : requiredLines(raw[lineKey]);
  const subtotal = number(
    raw.net_amount ?? raw.subtotal,
    "sage_document_subtotal_invalid",
    "Sage document subtotal",
    lines.reduce((sum, line) => sum + line.subtotal, 0)
  );
  const taxAmount = number(
    raw.tax_amount,
    "sage_document_tax_invalid",
    "Sage document tax",
    lines.reduce((sum, line) => sum + line.taxAmount, 0)
  );
  const total = number(
    raw.total_amount ?? raw.total,
    "sage_document_total_invalid",
    "Sage document total",
    subtotal + taxAmount
  );
  const outstanding = number(
    raw.outstanding_amount,
    "sage_outstanding_invalid",
    "Sage outstanding amount",
    total
  );
  return {
    ...normalized,
    payload: {
      contactId: requiredText(
        nestedId(raw.contact) ?? raw.contact_id,
        "sage_contact_link_missing",
        "Sage contact link"
      ),
      issueDate: date(
        raw.date,
        "sage_document_date_invalid",
        "Sage document date"
      ),
      boundaryDate: date(
        resource === "sales_invoices" ? raw.due_date : raw.expiry_date,
        "sage_document_boundary_date_invalid",
        resource === "sales_invoices" ? "Sage due date" : "Sage expiry date"
      ),
      reference: requiredText(
        raw.reference ?? raw.displayed_as,
        "sage_document_reference_missing",
        "Sage document reference"
      ),
      status:
        resource === "sales_invoices"
          ? invoiceStatus(raw, total, outstanding)
          : estimateStatus(raw),
      subtotal,
      taxAmount,
      total,
      outstanding,
      lines,
      sageDocumentKind:
        resource === "sales_quotes" ? "sales_quote" : "sales_estimate",
    },
  };
}

function normalizePayment(raw: DbRow): NormalizedSageRecord {
  const normalized = base(raw);
  const allocations = items(raw.allocated_artefacts).map((value) => {
    const allocation = row(value);
    if (!allocation) {
      throw new SageNormalizeError(
        "sage_payment_allocation_invalid",
        "Sage payment allocation is invalid."
      );
    }
    return {
      artefactId: requiredText(
        nestedId(allocation.artefact) ?? allocation.artefact_id,
        "sage_payment_artefact_missing",
        "Sage payment document link"
      ),
      amount: number(
        allocation.amount,
        "sage_payment_allocation_amount_invalid",
        "Sage payment allocation amount"
      ),
    };
  });
  if (!normalized.deletedAt && allocations.length !== 1) {
    throw new SageNormalizeError(
      "sage_payment_allocation_ambiguous",
      "Sage payment must have exactly one OPS document allocation."
    );
  }
  return {
    ...normalized,
    payload: {
      contactId: requiredText(
        nestedId(raw.contact) ?? raw.contact_id,
        "sage_payment_contact_missing",
        "Sage payment contact link"
      ),
      date: date(raw.date, "sage_payment_date_invalid", "Sage payment date"),
      amount: number(
        raw.total_amount ?? raw.amount,
        "sage_payment_amount_invalid",
        "Sage payment amount"
      ),
      reference: text(raw.reference),
      bankAccountId: nestedId(raw.bank_account) ?? text(raw.bank_account_id),
      paymentMethodId:
        nestedId(raw.payment_method) ?? text(raw.payment_method_id),
      allocations,
    },
  };
}

function normalizePurchaseInvoice(raw: DbRow): NormalizedSageRecord {
  const normalized = base(raw);
  const lines = normalized.deletedAt ? [] : requiredLines(raw.invoice_lines);
  const subtotal = number(
    raw.net_amount ?? raw.subtotal,
    "sage_purchase_subtotal_invalid",
    "Sage purchase subtotal",
    lines.reduce((sum, line) => sum + line.subtotal, 0)
  );
  const taxTotal = number(
    raw.tax_amount ?? raw.tax_total,
    "sage_purchase_tax_invalid",
    "Sage purchase tax",
    lines.reduce((sum, line) => sum + line.taxAmount, 0)
  );
  const total = number(
    raw.total_amount ?? raw.total,
    "sage_purchase_total_invalid",
    "Sage purchase total",
    subtotal + taxTotal
  );
  const balance = number(
    raw.outstanding_amount ?? raw.balance,
    "sage_purchase_balance_invalid",
    "Sage purchase balance",
    total
  );
  const status = statusText(raw.status);
  return {
    ...normalized,
    payload: {
      contactId: requiredText(
        nestedId(raw.contact) ?? raw.contact_id,
        "sage_purchase_supplier_missing",
        "Sage purchase supplier link"
      ),
      invoiceDate: date(
        raw.date,
        "sage_purchase_date_invalid",
        "Sage purchase date"
      ),
      dueDate: date(
        raw.due_date,
        "sage_purchase_due_date_invalid",
        "Sage purchase due date"
      ),
      reference: requiredText(
        raw.vendor_reference ?? raw.reference ?? raw.displayed_as,
        "sage_purchase_reference_missing",
        "Sage purchase reference"
      ),
      currency: text(row(raw.currency)?.id ?? raw.currency_id) ?? "CAD",
      status:
        normalized.deletedAt || status.includes("void")
          ? "void"
          : balance <= 0
            ? "paid"
            : balance < total
              ? "partial"
              : "open",
      subtotal,
      taxTotal,
      total,
      balance,
      lines,
    },
  };
}

export function normalizeSageRecord(
  entityType: AccountingSyncQueueEntityType,
  resource: string,
  raw: Record<string, unknown>
): NormalizedSageRecord {
  switch (entityType) {
    case "customer":
    case "supplier":
      if (resource !== "contacts") break;
      return normalizeContact(raw);
    case "invoice":
      if (resource !== "sales_invoices") break;
      return normalizeSalesDocument(raw, resource);
    case "estimate":
      if (resource !== "sales_quotes" && resource !== "sales_estimates") break;
      return normalizeSalesDocument(raw, resource);
    case "payment":
    case "supplier_bill_payment":
      if (resource !== "contact_payments") break;
      return normalizePayment(raw);
    case "supplier_bill":
      if (resource !== "purchase_invoices") break;
      return normalizePurchaseInvoice(raw);
  }
  throw new SageNormalizeError(
    "sage_resource_mismatch",
    `Sage resource ${resource} does not match ${entityType}.`
  );
}
