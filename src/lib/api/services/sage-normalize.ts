import "server-only";

export type SageDocumentKind =
  | "sales_estimate"
  | "sales_quote"
  | "sales_invoice"
  | "purchase_invoice";

export class SageNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SageNormalizationError";
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function id(value: unknown, label: string): string {
  const nested = object(value);
  const result = string(nested?.id) ?? string(value);
  if (!result) throw new SageNormalizationError(`Sage ${label} is missing.`);
  return result;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function status(value: unknown): string {
  const nested = object(value);
  return (string(nested?.id) ?? string(value) ?? "unknown").toLowerCase();
}

function tombstone(record: Record<string, unknown>, normalizedStatus: string) {
  return (
    record.deleted === true ||
    record.is_deleted === true ||
    ["void", "voided", "deleted", "cancelled", "canceled"].includes(
      normalizedStatus
    )
  );
}

function updatedAt(record: Record<string, unknown>): string {
  const result =
    string(record.updated_at) ??
    string(record.updated_or_created_at) ??
    string(record.created_at);
  if (!result || !Number.isFinite(Date.parse(result))) {
    throw new SageNormalizationError("Sage provider timestamp is missing.");
  }
  return new Date(result).toISOString();
}

export function normalizeSageContact(raw: unknown) {
  const record = object(raw);
  if (!record) throw new SageNormalizationError("Sage contact is invalid.");
  const types = Array.isArray(record.contact_type_ids)
    ? record.contact_type_ids.map((value) => string(value)?.toUpperCase())
    : [];
  const normalizedStatus = status(record.status);
  return {
    id: id(record.id, "contact id"),
    name: string(record.name) ?? "",
    kind: types.includes("VENDOR")
      ? ("supplier" as const)
      : ("customer" as const),
    email: string(record.email),
    phone: string(record.telephone),
    status: normalizedStatus,
    tombstone: tombstone(record, normalizedStatus),
    providerUpdatedAt: updatedAt(record),
  };
}

function documentLines(
  record: Record<string, unknown>,
  kind: SageDocumentKind
) {
  const key =
    kind === "sales_quote"
      ? "quote_lines"
      : kind === "sales_estimate"
        ? "estimate_lines"
        : "invoice_lines";
  const rawLines = record[key];
  if (!Array.isArray(rawLines)) {
    throw new SageNormalizationError(`Sage ${key} are missing.`);
  }
  return rawLines.map((value, index) => {
    const line = object(value);
    if (!line)
      throw new SageNormalizationError(`Sage line ${index} is invalid.`);
    return {
      id: id(line.id, `line ${index} id`),
      description: string(line.description) ?? "",
      quantity: number(line.quantity),
      unitPrice: number(line.unit_price),
      totalAmount: number(line.total_amount),
      ledgerAccountId: line.ledger_account
        ? id(line.ledger_account, `line ${index} ledger account`)
        : string(line.ledger_account_id),
      taxRateId: line.tax_rate
        ? id(line.tax_rate, `line ${index} tax rate`)
        : string(line.tax_rate_id),
      taxRatePercent:
        number(object(line.tax_rate)?.percentage) ??
        number(line.tax_rate_percentage),
    };
  });
}

export function normalizeSageDocument(kind: SageDocumentKind, raw: unknown) {
  const record = object(raw);
  if (!record) throw new SageNormalizationError("Sage document is invalid.");
  const normalizedStatus = status(record.status);
  return {
    id: id(record.id, "document id"),
    kind,
    contactId: id(record.contact ?? record.contact_id, "document contact"),
    date: string(record.date),
    dueOrExpiryDate: string(record.due_date) ?? string(record.expiry_date),
    reference:
      string(record.reference) ??
      string(record.vendor_reference) ??
      string(record.displayed_as),
    status: normalizedStatus,
    totalAmount: number(record.total_amount),
    outstandingAmount: number(record.outstanding_amount),
    lines: documentLines(record, kind),
    tombstone: tombstone(record, normalizedStatus),
    providerUpdatedAt: updatedAt(record),
  };
}

export function normalizeSagePayment(raw: unknown) {
  const record = object(raw);
  if (!record) throw new SageNormalizationError("Sage payment is invalid.");
  const rawAllocations = record.allocated_artefacts;
  if (!Array.isArray(rawAllocations)) {
    throw new SageNormalizationError("Sage payment allocations are missing.");
  }
  const normalizedStatus = status(record.status);
  return {
    id: id(record.id, "payment id"),
    contactId: id(record.contact ?? record.contact_id, "payment contact"),
    transactionType: id(
      record.transaction_type ?? record.transaction_type_id,
      "payment transaction type"
    ),
    totalAmount: number(record.total_amount),
    date: string(record.date),
    status: normalizedStatus,
    allocations: rawAllocations.map((value, index) => {
      const allocation = object(value);
      if (!allocation) {
        throw new SageNormalizationError(
          `Sage allocation ${index} is invalid.`
        );
      }
      return {
        artefactId: id(
          allocation.artefact ?? allocation.artefact_id,
          `allocation ${index} artefact`
        ),
        amount: number(allocation.amount),
      };
    }),
    tombstone: tombstone(record, normalizedStatus),
    providerUpdatedAt: updatedAt(record),
  };
}
