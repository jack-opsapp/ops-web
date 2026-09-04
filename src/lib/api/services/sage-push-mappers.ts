import "server-only";

export class SageMappingError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SageMappingError";
  }
}

export interface SageLineSource {
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  subtotal: string | number;
  ledgerAccountId: string | null;
  taxRateId: string | null;
}

export interface SageDocumentSource {
  contactId: string;
  date: string;
  dueOrExpiryDate: string;
  reference: string;
  lines: SageLineSource[];
}

export type SageSalesResource =
  | "sales_estimates"
  | "sales_quotes"
  | "sales_invoices";

function required(
  value: string | null | undefined,
  code: string,
  label: string
): string {
  const result = value?.trim();
  if (!result) throw new SageMappingError(code, `${label} is required.`);
  return result;
}

function decimal(value: string | number, label: string) {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw)) {
    throw new SageMappingError(
      `invalid_${label.replace(/\s+/g, "_")}`,
      `Sage ${label} is invalid.`
    );
  }
  const [whole, fraction = ""] = raw.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: BigInt(10) ** BigInt(fraction.length),
    number: Number(raw),
  };
}

function cents(value: string | number, label: string): bigint {
  const parsed = decimal(value, label);
  const scaled = parsed.coefficient * BigInt(100);
  return (scaled + parsed.scale / BigInt(2)) / parsed.scale;
}

function validDate(value: string, label: string): string {
  const normalized = required(value, `sage_${label}_required`, `Sage ${label}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new SageMappingError(
      `invalid_sage_${label}`,
      `Sage ${label} is invalid.`
    );
  }
  const timestamp = Date.parse(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) {
    throw new SageMappingError(
      `invalid_sage_${label}`,
      `Sage ${label} is invalid.`
    );
  }
  return normalized;
}

function line(source: SageLineSource): Record<string, unknown> {
  const quantity = decimal(source.quantity, "quantity");
  if (quantity.coefficient <= BigInt(0)) {
    throw new SageMappingError(
      "invalid_sage_quantity",
      "Sage quantity must be greater than zero."
    );
  }
  const unitPrice = decimal(source.unitPrice, "unit price");
  const denominator = quantity.scale * unitPrice.scale;
  const numerator = quantity.coefficient * unitPrice.coefficient * BigInt(100);
  const calculatedCents = (numerator + denominator / BigInt(2)) / denominator;
  if (calculatedCents !== cents(source.subtotal, "subtotal")) {
    throw new SageMappingError(
      "sage_subtotal_mismatch",
      "Sage line subtotal does not match quantity multiplied by unit price."
    );
  }
  return {
    description: required(
      source.description,
      "sage_line_description_required",
      "Sage line description"
    ),
    quantity: quantity.number,
    unit_price: unitPrice.number,
    ledger_account_id: required(
      source.ledgerAccountId,
      "sage_account_mapping_required",
      "Sage ledger account mapping"
    ),
    tax_rate_id: required(
      source.taxRateId,
      "sage_tax_mapping_required",
      "Sage tax mapping"
    ),
  };
}

function mappedLines(lines: SageLineSource[]): Record<string, unknown>[] {
  if (lines.length === 0) {
    throw new SageMappingError(
      "sage_lines_required",
      "At least one Sage document line is required."
    );
  }
  return lines.map(line);
}

export function buildSageContact(input: {
  name: string;
  kind: "customer" | "supplier";
  email?: string | null;
  phone?: string | null;
  taxNumber?: string | null;
}): Record<string, unknown> {
  return {
    name: required(
      input.name,
      "sage_contact_name_required",
      "Sage contact name"
    ),
    contact_type_ids: [input.kind === "customer" ? "CUSTOMER" : "VENDOR"],
    ...(input.email?.trim() ? { email: input.email.trim() } : {}),
    ...(input.phone?.trim() ? { telephone: input.phone.trim() } : {}),
    ...(input.taxNumber?.trim() ? { tax_number: input.taxNumber.trim() } : {}),
  };
}

export function buildSageSalesDocument(
  resource: SageSalesResource,
  input: SageDocumentSource
): Record<string, unknown> {
  const date = validDate(input.date, "document date");
  const boundaryDate = validDate(
    input.dueOrExpiryDate,
    resource === "sales_invoices" ? "due date" : "expiry date"
  );
  const lineKey =
    resource === "sales_invoices"
      ? "invoice_lines"
      : resource === "sales_quotes"
        ? "quote_lines"
        : "estimate_lines";
  return {
    contact_id: required(
      input.contactId,
      "sage_contact_required",
      "Sage contact link"
    ),
    date,
    [resource === "sales_invoices" ? "due_date" : "expiry_date"]: boundaryDate,
    reference: required(
      input.reference,
      "sage_reference_required",
      "Sage document reference"
    ),
    [lineKey]: mappedLines(input.lines),
  };
}

export function buildSagePurchaseInvoice(input: {
  contactId: string;
  date: string;
  dueDate: string;
  reference: string;
  lines: SageLineSource[];
}): Record<string, unknown> {
  return {
    contact_id: required(
      input.contactId,
      "sage_vendor_required",
      "Sage vendor link"
    ),
    date: validDate(input.date, "document date"),
    due_date: validDate(input.dueDate, "due date"),
    vendor_reference: required(
      input.reference,
      "sage_reference_required",
      "Sage vendor reference"
    ),
    invoice_lines: mappedLines(input.lines),
  };
}

export function buildSageContactPayment(input: {
  transactionType: "CUSTOMER_RECEIPT" | "VENDOR_PAYMENT";
  contactId: string;
  bankAccountId: string | null;
  paymentMethodId: string | null;
  date: string;
  amount: string | number;
  allocations: Array<{ artefactId: string; amount: string | number }>;
  reference: string | null;
}): Record<string, unknown> {
  const contactId = required(
    input.contactId,
    "sage_contact_required",
    "Sage payment contact link"
  );
  const bankAccountId = required(
    input.bankAccountId,
    "sage_bank_account_required",
    "Sage bank account mapping"
  );
  const paymentDate = validDate(input.date, "payment date");
  const totalCents = cents(input.amount, "payment amount");
  if (totalCents <= BigInt(0)) {
    throw new SageMappingError(
      "invalid_sage_payment_amount",
      "Sage payment amount must be greater than zero."
    );
  }
  if (input.allocations.length === 0) {
    throw new SageMappingError(
      "sage_payment_allocation_required",
      "Sage payment allocation is required."
    );
  }
  let allocatedCents = BigInt(0);
  const allocations = input.allocations.map((allocation) => {
    const allocationCents = cents(allocation.amount, "allocation amount");
    if (allocationCents <= BigInt(0)) {
      throw new SageMappingError(
        "invalid_sage_allocation_amount",
        "Sage allocation amount must be greater than zero."
      );
    }
    allocatedCents += allocationCents;
    return {
      artefact_id: required(
        allocation.artefactId,
        "sage_document_required",
        "Sage payment document link"
      ),
      amount: Number(allocationCents) / 100,
    };
  });
  if (allocatedCents > totalCents) {
    throw new SageMappingError(
      "sage_payment_overallocated",
      "Sage payment allocations cannot exceed the payment total."
    );
  }
  return {
    transaction_type_id: input.transactionType,
    contact_id: contactId,
    bank_account_id: bankAccountId,
    date: paymentDate,
    total_amount: Number(totalCents) / 100,
    ...(input.paymentMethodId?.trim()
      ? { payment_method_id: input.paymentMethodId.trim() }
      : {}),
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
    allocated_artefacts: allocations,
  };
}
