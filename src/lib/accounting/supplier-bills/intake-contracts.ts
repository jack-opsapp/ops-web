const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_RE = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/;
const QUANTITY_RE = /^(0|[1-9]\d{0,9})(?:\.\d{1,4})?$/;
const CENTS_PER_UNIT = BigInt(100);

export type SupplierDocumentKind = "material" | "subcontractor" | "employee";
export type SupplierBillIntakeStage =
  | "review"
  | "to_pay"
  | "paid"
  | "held"
  | "payroll";
export type SupplierBillCheckKey =
  | "rate_compliance"
  | "duplicate_billing"
  | "quantity_scope"
  | "order_specification"
  | "receipt";
export type SupplierBillCheckOutcome = "pending" | "clear" | "exception";
export type SupplierBillCheckDisposition = "unresolved" | "accepted" | "held";

export interface SupplierBillCheckState {
  key: SupplierBillCheckKey;
  outcome: SupplierBillCheckOutcome;
  disposition: SupplierBillCheckDisposition;
  note: string | null;
}

export interface SupplierBillIntakeStageInput {
  documentKind: SupplierDocumentKind;
  checks: readonly SupplierBillCheckState[];
  approvedAt: string | null;
  paidAt: string | null;
  holdReason: string | null;
  nextAction: string | null;
  paymentOwnerId: string | null;
  plannedPaymentDate: string | null;
}

export interface SupplierBillIntakeLineDraft {
  position: number;
  sku?: string | null;
  description: string;
  orderedQuantity?: string | null;
  invoicedQuantity: string;
  unitOfMeasure?: string | null;
  unitPrice: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  jobHint?: string | null;
}

export interface SupplierBillIntakeDraft {
  documentKind: SupplierDocumentKind;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  plannedPaymentDate?: string | null;
  purchaseOrder?: string | null;
  shippingReference?: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  lines: readonly SupplierBillIntakeLineDraft[];
}

export interface CanonicalSupplierBillIntakeDraft {
  documentKind: SupplierDocumentKind;
  supplierName: string;
  normalizedSupplierName: string;
  invoiceNumber: string;
  normalizedInvoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  plannedPaymentDate: string | null;
  purchaseOrder: string | null;
  shippingReference: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  lines: Array<{
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
  }>;
}

export interface ProjectMoneyAllocation {
  projectId: string;
  amount: string;
}

export class SupplierBillIntakeContractError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SupplierBillIntakeContractError";
  }
}

function fail(code: string, message: string): never {
  throw new SupplierBillIntakeContractError(code, message);
}

function compactText(value: string, max: number, label: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact || compact.length > max) {
    fail("invalid_text", `${label} is invalid.`);
  }
  return compact;
}

function optionalText(
  value: string | null | undefined,
  max: number,
  label: string
): string | null {
  if (value === null || value === undefined) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (compact.length > max) fail("invalid_text", `${label} is invalid.`);
  return compact;
}

function requireUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) fail("invalid_id", `${label} is invalid.`);
  return value.toLowerCase();
}

function requireDate(value: string, label: string): string {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail("invalid_date", `${label} is invalid.`);
  }
  return value;
}

function optionalDate(
  value: string | null | undefined,
  label: string
): string | null {
  return value ? requireDate(value, label) : null;
}

function moneyCents(value: string, label: string): bigint {
  if (!MONEY_RE.test(value)) fail("invalid_amount", `${label} is invalid.`);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * CENTS_PER_UNIT + BigInt((fraction + "00").slice(0, 2));
}

function moneyString(cents: bigint): string {
  const whole = cents / CENTS_PER_UNIT;
  const fraction = String(cents % CENTS_PER_UNIT).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function quantity(
  value: string | null | undefined,
  label: string
): string | null {
  if (value === null || value === undefined) return null;
  if (!QUANTITY_RE.test(value))
    fail("invalid_quantity", `${label} is invalid.`);
  return value;
}

export function requiredChecksForDocument(
  kind: SupplierDocumentKind
): readonly SupplierBillCheckKey[] {
  if (kind === "material") {
    return [
      "rate_compliance",
      "duplicate_billing",
      "quantity_scope",
      "order_specification",
      "receipt",
    ];
  }
  if (kind === "subcontractor") {
    return ["rate_compliance", "duplicate_billing", "quantity_scope"];
  }
  return ["duplicate_billing"];
}

function isResolved(check: SupplierBillCheckState): boolean {
  if (check.outcome === "pending") return false;
  if (check.outcome === "exception") return check.disposition === "accepted";
  return check.disposition === "accepted";
}

export function deriveSupplierBillIntakeStage(
  input: SupplierBillIntakeStageInput
): SupplierBillIntakeStage {
  if (input.documentKind === "employee") return "payroll";

  const checkHeld = input.checks.some((check) => check.disposition === "held");
  const holdRequested =
    checkHeld || Boolean(input.holdReason || input.nextAction);
  if (holdRequested) {
    if (!input.holdReason?.trim() || !input.nextAction?.trim()) {
      fail("incomplete_hold", "A held bill needs a reason and next action.");
    }
    return "held";
  }

  if (!input.approvedAt) {
    if (input.paidAt) {
      fail("invalid_payment_state", "A bill cannot be paid before approval.");
    }
    return "review";
  }

  const checksByKey = new Map(input.checks.map((check) => [check.key, check]));
  const everyCheckResolved = requiredChecksForDocument(
    input.documentKind
  ).every((key) => {
    const check = checksByKey.get(key);
    return Boolean(check && isResolved(check));
  });
  if (!everyCheckResolved) {
    fail(
      "unresolved_checks",
      "Every required clearance check needs a disposition before approval."
    );
  }

  if (!input.paymentOwnerId || !input.plannedPaymentDate) {
    fail(
      "payment_plan_required",
      "Payment owner and target date are required before approval."
    );
  }
  requireUuid(input.paymentOwnerId, "Payment owner");
  requireDate(input.plannedPaymentDate, "Planned payment date");
  return input.paidAt ? "paid" : "to_pay";
}

export function canonicalizeSupplierBillIntakeDraft(
  input: SupplierBillIntakeDraft
): CanonicalSupplierBillIntakeDraft {
  const supplierName = compactText(input.supplierName, 200, "Supplier name");
  const invoiceNumber = compactText(input.invoiceNumber, 100, "Invoice number");
  const invoiceDate = requireDate(input.invoiceDate, "Invoice date");
  const dueDate = optionalDate(input.dueDate, "Due date");
  const plannedPaymentDate = optionalDate(
    input.plannedPaymentDate,
    "Planned payment date"
  );
  if (dueDate && dueDate < invoiceDate) {
    fail("invalid_due_date", "Due date cannot be before the invoice date.");
  }

  const currency = compactText(input.currency, 3, "Currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    fail("invalid_currency", "Currency must be a three-letter ISO code.");
  }

  const subtotalCents = moneyCents(input.subtotal, "Subtotal");
  const taxCents = moneyCents(input.taxTotal, "Tax total");
  const totalCents = moneyCents(input.total, "Total");
  if (totalCents <= BigInt(0) || subtotalCents + taxCents !== totalCents) {
    fail("amount_mismatch", "Bill subtotal plus tax must equal total.");
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    fail("line_items_required", "At least one bill line is required.");
  }

  const positions = new Set<number>();
  let lineSubtotalCents = BigInt(0);
  let lineTaxCents = BigInt(0);
  let lineTotalCents = BigInt(0);
  const lines = input.lines.map((line) => {
    if (!Number.isInteger(line.position) || line.position < 1) {
      fail("invalid_position", "Line positions must be positive integers.");
    }
    if (positions.has(line.position)) {
      fail("duplicate_position", "Line positions must be unique.");
    }
    positions.add(line.position);

    const lineSubtotal = moneyCents(line.subtotal, "Line subtotal");
    const lineTax = moneyCents(line.taxAmount, "Line tax");
    const lineTotal = moneyCents(line.total, "Line total");
    if (lineSubtotal + lineTax !== lineTotal) {
      fail(
        "line_amount_mismatch",
        "Each line subtotal plus tax must equal line total."
      );
    }
    lineSubtotalCents += lineSubtotal;
    lineTaxCents += lineTax;
    lineTotalCents += lineTotal;

    const invoicedQuantity = quantity(
      line.invoicedQuantity,
      "Invoiced quantity"
    );
    if (!invoicedQuantity || Number(invoicedQuantity) <= 0) {
      fail("invalid_quantity", "Invoiced quantity is invalid.");
    }

    return {
      position: line.position,
      sku: optionalText(line.sku, 100, "SKU"),
      description: compactText(line.description, 500, "Line description"),
      orderedQuantity: quantity(line.orderedQuantity, "Ordered quantity"),
      invoicedQuantity,
      unitOfMeasure:
        optionalText(
          line.unitOfMeasure,
          40,
          "Unit of measure"
        )?.toUpperCase() ?? null,
      unitPrice: moneyString(moneyCents(line.unitPrice, "Unit price")),
      subtotal: moneyString(lineSubtotal),
      taxAmount: moneyString(lineTax),
      total: moneyString(lineTotal),
      jobHint: optionalText(line.jobHint, 500, "Job hint"),
    };
  });

  if (
    lineSubtotalCents !== subtotalCents ||
    lineTaxCents !== taxCents ||
    lineTotalCents !== totalCents
  ) {
    fail("line_totals_mismatch", "Bill lines must equal the document totals.");
  }

  return {
    documentKind: input.documentKind,
    supplierName,
    normalizedSupplierName: supplierName.toLocaleLowerCase("en-CA"),
    invoiceNumber,
    normalizedInvoiceNumber: invoiceNumber.toUpperCase(),
    invoiceDate,
    dueDate,
    plannedPaymentDate,
    purchaseOrder: optionalText(input.purchaseOrder, 100, "Purchase order"),
    shippingReference: optionalText(
      input.shippingReference,
      300,
      "Shipping reference"
    ),
    currency,
    subtotal: moneyString(subtotalCents),
    taxTotal: moneyString(taxCents),
    total: moneyString(totalCents),
    lines,
  };
}

export function proportionalSharedChargeAllocations(
  total: string,
  weights: readonly { projectId: string; materialSubtotal: string }[]
): ProjectMoneyAllocation[] {
  const totalCents = moneyCents(total, "Shared charge");
  if (totalCents <= BigInt(0) || weights.length === 0) {
    fail(
      "invalid_allocation",
      "Shared charge allocations require positive values."
    );
  }

  const canonical = weights.map((weight) => ({
    projectId: requireUuid(weight.projectId, "Project ID"),
    weight: moneyCents(weight.materialSubtotal, "Material subtotal"),
  }));
  if (
    new Set(canonical.map(({ projectId }) => projectId)).size !==
    canonical.length
  ) {
    fail("duplicate_allocation", "A project can appear only once.");
  }
  if (canonical.some(({ weight }) => weight <= BigInt(0))) {
    fail("invalid_allocation", "Material subtotals must be positive.");
  }

  const weightTotal = canonical.reduce(
    (sum, item) => sum + item.weight,
    BigInt(0)
  );
  const computed = canonical.map((item, index) => {
    const numerator = totalCents * item.weight;
    return {
      ...item,
      index,
      cents: numerator / weightTotal,
      remainder: numerator % weightTotal,
    };
  });
  let remainderCents =
    totalCents - computed.reduce((sum, item) => sum + item.cents, BigInt(0));
  const priority = [...computed].sort((left, right) => {
    if (left.remainder === right.remainder) {
      return left.projectId.localeCompare(right.projectId);
    }
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (const item of priority) {
    if (remainderCents === BigInt(0)) break;
    computed[item.index].cents += BigInt(1);
    remainderCents -= BigInt(1);
  }

  return computed.map(({ projectId, cents }) => ({
    projectId,
    amount: moneyString(cents),
  }));
}

export function canonicalizeAllocationOverride(
  total: string,
  allocations: readonly ProjectMoneyAllocation[]
): ProjectMoneyAllocation[] {
  const totalCents = moneyCents(total, "Line total");
  if (allocations.length === 0) {
    fail(
      "allocations_required",
      "At least one project allocation is required."
    );
  }
  const seen = new Set<string>();
  let allocated = BigInt(0);
  const canonical = allocations.map((allocation) => {
    const projectId = requireUuid(allocation.projectId, "Project ID");
    if (seen.has(projectId)) {
      fail("duplicate_allocation", "A project can appear only once.");
    }
    seen.add(projectId);
    const cents = moneyCents(allocation.amount, "Allocation amount");
    if (cents <= BigInt(0)) {
      fail("invalid_allocation", "Allocation amounts must be positive.");
    }
    allocated += cents;
    return { projectId, amount: moneyString(cents) };
  });
  if (allocated !== totalCents) {
    fail(
      "allocation_mismatch",
      "Project allocations must equal the line total."
    );
  }
  return canonical;
}

export function resolveJobMatch(input: {
  projectId: string;
  basis: "address" | "purchase_order";
  sourceValue: string;
  confirmedByUser: boolean;
}) {
  return {
    projectId: requireUuid(input.projectId, "Project ID"),
    basis: input.basis,
    sourceValue: compactText(input.sourceValue, 500, "Job match source"),
    status: input.confirmedByUser
      ? ("confirmed" as const)
      : ("suggested" as const),
  };
}
