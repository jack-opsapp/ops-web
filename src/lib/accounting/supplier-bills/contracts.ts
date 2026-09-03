const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_RE = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/;
const QUANTITY_RE = /^(0|[1-9]\d{0,9})(?:\.\d{1,4})?$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export type SupplierBillRoute = "supplier_bill" | "expense";
export type SupplierBillStatus = "open" | "paid";

export interface SupplierIdentityInput {
  displayName: string;
  email?: string | null;
  phone?: string | null;
  taxNumber?: string | null;
}

export interface SupplierBillAllocationInput {
  projectId: string;
  amount: string;
}

export interface SupplierBillLineInput {
  position: number;
  sku?: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  categoryId?: string | null;
  allocations: readonly SupplierBillAllocationInput[];
}

export interface SupplierBillSourceDocumentInput {
  bucket: string;
  objectKey: string;
  publicUrl: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface PaidPurchaseInput {
  expenseId: string;
  paymentMethod: "cash" | "personal_card" | "company_card";
  paidDate: string;
}

export interface SupplierBillCaptureInput {
  requestId: string;
  idempotencyKey: string;
  companyId: string;
  actorUserId: string;
  supplier: SupplierIdentityInput;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  currency: string;
  categoryId: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  balance: string;
  notes?: string | null;
  lineItems: readonly SupplierBillLineInput[];
  sourceDocument: SupplierBillSourceDocumentInput;
  paidPurchase?: PaidPurchaseInput | null;
}

export interface CanonicalSupplierIdentity {
  displayName: string;
  normalizedName: string;
  email: string | null;
  phone: string | null;
  taxNumber: string | null;
}

export interface CanonicalSupplierBillCapture {
  requestId: string;
  idempotencyKey: string;
  companyId: string;
  actorUserId: string;
  route: SupplierBillRoute;
  status: SupplierBillStatus;
  supplier: CanonicalSupplierIdentity;
  invoiceNumber: string;
  normalizedInvoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  categoryId: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  balance: string;
  notes: string | null;
  lineItems: Array<
    Omit<SupplierBillLineInput, "allocations" | "categoryId"> & {
      categoryId: string;
      allocations: SupplierBillAllocationInput[];
    }
  >;
  sourceDocument: SupplierBillSourceDocumentInput;
  paidPurchase: PaidPurchaseInput | null;
  projectIds: string[];
  confirmationText: string;
}

export class SupplierBillContractError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SupplierBillContractError";
  }
}

function fail(code: string, message: string): never {
  throw new SupplierBillContractError(code, message);
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
  max: number
): string | null {
  if (value === null || value === undefined) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (compact.length > max)
    fail("invalid_text", "Optional bill text is too long.");
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

function moneyCents(value: string, label: string): bigint {
  const match = MONEY_RE.exec(value);
  if (!match) fail("invalid_amount", `${label} is invalid.`);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function moneyString(cents: bigint): string {
  const whole = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function displayMoney(cents: bigint): string {
  const [whole, fraction] = moneyString(cents).split(".");
  return `${Number(whole).toLocaleString("en-CA")}.${fraction}`;
}

function normalizeInvoiceNumber(value: string): string {
  return compactText(value, 100, "Invoice number").toUpperCase();
}

function normalizeSupplierName(value: string): string {
  return compactText(value, 200, "Supplier name").toLocaleLowerCase("en-CA");
}

export function canonicalizeSupplierBillCapture(
  input: SupplierBillCaptureInput
): CanonicalSupplierBillCapture {
  const requestId = requireUuid(input.requestId, "Request ID");
  const companyId = requireUuid(input.companyId, "Company ID");
  const actorUserId = requireUuid(input.actorUserId, "Actor ID");
  const categoryId = requireUuid(input.categoryId, "Expense category ID");
  const idempotencyKey = compactText(
    input.idempotencyKey,
    200,
    "Idempotency key"
  );
  const displayName = compactText(
    input.supplier.displayName,
    200,
    "Supplier name"
  );
  const invoiceNumber = compactText(input.invoiceNumber, 100, "Invoice number");
  const normalizedInvoiceNumber = normalizeInvoiceNumber(input.invoiceNumber);
  const invoiceDate = requireDate(input.invoiceDate, "Invoice date");
  const dueDate = input.dueDate ? requireDate(input.dueDate, "Due date") : null;
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
  const balanceCents = moneyCents(input.balance, "Balance");
  if (totalCents <= 0n || subtotalCents + taxCents !== totalCents) {
    fail("amount_mismatch", "Bill subtotal plus tax must equal total.");
  }
  if (balanceCents < 0n || balanceCents > totalCents) {
    fail("invalid_balance", "Bill balance must be between zero and total.");
  }
  if (balanceCents !== 0n && balanceCents !== totalCents) {
    fail(
      "opening_balance_unsupported",
      "Partially settled documents require payment history before capture."
    );
  }

  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
    fail("line_items_required", "At least one bill line is required.");
  }
  if (input.lineItems.length > 500) {
    fail("too_many_line_items", "A bill cannot contain more than 500 lines.");
  }

  let lineSubtotalCents = 0n;
  let lineTaxCents = 0n;
  let lineTotalCents = 0n;
  const positions = new Set<number>();
  const projectIds = new Set<string>();
  const lineItems = input.lineItems.map((line) => {
    if (!Number.isInteger(line.position) || line.position < 1) {
      fail(
        "invalid_position",
        "Bill line positions must be positive integers."
      );
    }
    if (positions.has(line.position)) {
      fail("duplicate_position", "Bill line positions must be unique.");
    }
    positions.add(line.position);
    if (!QUANTITY_RE.test(line.quantity) || Number(line.quantity) <= 0) {
      fail("invalid_quantity", "Bill line quantity is invalid.");
    }

    const unitPriceCents = moneyCents(line.unitPrice, "Unit price");
    const lineSubtotal = moneyCents(line.subtotal, "Line subtotal");
    const lineTax = moneyCents(line.taxAmount, "Line tax");
    const lineTotal = moneyCents(line.total, "Line total");
    if (lineSubtotal + lineTax !== lineTotal) {
      fail(
        "line_amount_mismatch",
        "Each line subtotal plus tax must equal line total."
      );
    }
    if (lineTotal <= 0n || unitPriceCents < 0n) {
      fail("invalid_amount", "Bill line amounts must be positive.");
    }

    if (!Array.isArray(line.allocations) || line.allocations.length === 0) {
      fail(
        "allocations_required",
        "Every bill line requires a project allocation."
      );
    }
    let allocatedCents = 0n;
    const seenProjects = new Set<string>();
    const allocations = line.allocations.map((allocation) => {
      const projectId = requireUuid(allocation.projectId, "Project ID");
      if (seenProjects.has(projectId)) {
        fail(
          "duplicate_allocation",
          "A line cannot allocate the same project twice."
        );
      }
      seenProjects.add(projectId);
      projectIds.add(projectId);
      const amountCents = moneyCents(allocation.amount, "Allocation amount");
      if (amountCents <= 0n) {
        fail("invalid_amount", "Allocation amounts must be positive.");
      }
      allocatedCents += amountCents;
      return { projectId, amount: moneyString(amountCents) };
    });
    if (allocatedCents !== lineTotal) {
      fail(
        "allocation_mismatch",
        "Every line allocation must equal that line's total."
      );
    }

    lineSubtotalCents += lineSubtotal;
    lineTaxCents += lineTax;
    lineTotalCents += lineTotal;
    return {
      position: line.position,
      sku: optionalText(line.sku, 100),
      description: compactText(line.description, 1_000, "Line description"),
      quantity: line.quantity,
      unitPrice: moneyString(unitPriceCents),
      subtotal: moneyString(lineSubtotal),
      taxAmount: moneyString(lineTax),
      total: moneyString(lineTotal),
      categoryId: line.categoryId
        ? requireUuid(line.categoryId, "Line expense category ID")
        : categoryId,
      allocations,
    };
  });

  if (
    lineSubtotalCents !== subtotalCents ||
    lineTaxCents !== taxCents ||
    lineTotalCents !== totalCents
  ) {
    fail("line_sum_mismatch", "Bill lines must equal the bill totals.");
  }

  const sourceDocument = {
    bucket: compactText(input.sourceDocument.bucket, 100, "Document bucket"),
    objectKey: compactText(
      input.sourceDocument.objectKey,
      1_024,
      "Document key"
    ),
    publicUrl: compactText(
      input.sourceDocument.publicUrl,
      2_048,
      "Document URL"
    ),
    originalFilename: compactText(
      input.sourceDocument.originalFilename,
      255,
      "Document filename"
    ),
    mimeType: compactText(input.sourceDocument.mimeType, 100, "Document type"),
    sizeBytes: input.sourceDocument.sizeBytes,
    sha256: input.sourceDocument.sha256.toLowerCase(),
  };
  if (
    sourceDocument.mimeType !== "application/pdf" ||
    !sourceDocument.publicUrl.startsWith("https://") ||
    !Number.isSafeInteger(sourceDocument.sizeBytes) ||
    sourceDocument.sizeBytes < 5 ||
    sourceDocument.sizeBytes > 20 * 1024 * 1024 ||
    !SHA256_RE.test(sourceDocument.sha256) ||
    !sourceDocument.objectKey.split("/").includes(companyId)
  ) {
    fail("invalid_document", "Source document custody is invalid.");
  }

  const paidPurchase = input.paidPurchase
    ? {
        expenseId: requireUuid(input.paidPurchase.expenseId, "Expense ID"),
        paymentMethod: input.paidPurchase.paymentMethod,
        paidDate: requireDate(input.paidPurchase.paidDate, "Paid date"),
      }
    : null;
  if (balanceCents === 0n && !paidPurchase) {
    fail(
      "paid_purchase_required",
      "Paid documents require expense settlement details."
    );
  }
  if (balanceCents > 0n && paidPurchase) {
    fail(
      "unexpected_paid_purchase",
      "Unpaid bills cannot include paid purchase details."
    );
  }

  const route: SupplierBillRoute =
    balanceCents === 0n ? "expense" : "supplier_bill";
  const status: SupplierBillStatus = route === "expense" ? "paid" : "open";
  const action = route === "expense" ? "RECORD PAID PURCHASE" : "RECORD BILL";

  return {
    requestId,
    idempotencyKey,
    companyId,
    actorUserId,
    route,
    status,
    supplier: {
      displayName,
      normalizedName: normalizeSupplierName(displayName),
      email: optionalText(input.supplier.email, 320),
      phone: optionalText(input.supplier.phone, 100),
      taxNumber: optionalText(input.supplier.taxNumber, 100),
    },
    invoiceNumber,
    normalizedInvoiceNumber,
    invoiceDate,
    dueDate,
    currency,
    categoryId,
    subtotal: moneyString(subtotalCents),
    taxTotal: moneyString(taxCents),
    total: moneyString(totalCents),
    balance: moneyString(balanceCents),
    notes: optionalText(input.notes, 2_000),
    lineItems,
    sourceDocument,
    paidPurchase,
    projectIds: [...projectIds].sort(),
    confirmationText: `${action} ${normalizedInvoiceNumber} FOR ${currency} ${displayMoney(totalCents)}`,
  };
}
