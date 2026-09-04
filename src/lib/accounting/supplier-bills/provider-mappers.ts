export class ProviderMappingError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProviderMappingError";
  }
}

export interface SupplierPayloadSource {
  displayName: string;
  email?: string | null;
  phone?: string | null;
  taxNumber?: string | null;
}

export interface ProviderProjectAllocation {
  externalProjectId: string | null;
  amount: string;
}

export interface ProviderBillLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  externalAccountId: string | null;
  externalTaxCodeId: string | null;
  projectAllocations: ProviderProjectAllocation[];
}

export interface ProviderBillSource {
  supplier: SupplierPayloadSource;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  lines: ProviderBillLine[];
}

export interface QuickBooksPaymentSource {
  vendorId: string;
  billId: string;
  amount: string;
  paymentDate: string;
  paymentMethod: "check" | "credit_card";
  bankAccountId: string | null;
  reference: string | null;
}

export interface SagePaymentSource {
  vendorId: string;
  billId: string;
  amount: string;
  paymentDate: string;
  bankAccountId: string | null;
  paymentMethodId: string | null;
  reference: string | null;
}

function amount(value: string): number {
  if (!/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) {
    throw new ProviderMappingError(
      "invalid_provider_amount",
      "Provider amount is invalid."
    );
  }
  return Number(value);
}

function cents(value: string): number {
  amount(value);
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

function qboLines(line: ProviderBillLine): Record<string, unknown>[] {
  const accountId = required(
    line.externalAccountId,
    "qbo_account_mapping_required",
    "QuickBooks account mapping is required before this bill can sync."
  );
  const taxCodeId = required(
    line.externalTaxCodeId,
    "qbo_tax_mapping_required",
    "QuickBooks tax mapping is required before this bill can sync."
  );
  if (line.projectAllocations.length === 0) {
    throw new ProviderMappingError(
      "qbo_project_allocation_required",
      "QuickBooks job allocation is required before this bill can sync."
    );
  }
  const subtotalCents = cents(line.subtotal);
  const totalCents = cents(line.total);
  let assignedSubtotal = 0;
  return line.projectAllocations.map((allocation, index) => {
    const projectId = required(
      allocation.externalProjectId,
      "qbo_project_mapping_required",
      "QuickBooks job mapping is required before this bill can sync."
    );
    const splitSubtotal =
      index === line.projectAllocations.length - 1
        ? subtotalCents - assignedSubtotal
        : Math.round((subtotalCents * cents(allocation.amount)) / totalCents);
    assignedSubtotal += splitSubtotal;
    return {
      Amount: splitSubtotal / 100,
      Description: line.description,
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: accountId },
        TaxCodeRef: { value: taxCodeId },
        CustomerRef: { value: projectId },
      },
    };
  });
}

function quantity(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ProviderMappingError(
      "invalid_provider_quantity",
      "Provider quantity is invalid."
    );
  }
  return parsed;
}

function required(value: string | null, code: string, message: string): string {
  if (!value?.trim()) throw new ProviderMappingError(code, message);
  return value.trim();
}

export function buildQuickBooksSupplierPayload(
  supplier: SupplierPayloadSource
): Record<string, unknown> {
  return {
    DisplayName: supplier.displayName,
    CompanyName: supplier.displayName,
    ...(supplier.email
      ? { PrimaryEmailAddr: { Address: supplier.email } }
      : {}),
    ...(supplier.phone
      ? { PrimaryPhone: { FreeFormNumber: supplier.phone } }
      : {}),
    ...(supplier.taxNumber ? { TaxIdentifier: supplier.taxNumber } : {}),
  };
}

export function buildQuickBooksBillPayload(
  bill: ProviderBillSource,
  vendorId: string
): Record<string, unknown> {
  return {
    VendorRef: {
      value: required(
        vendorId,
        "qbo_vendor_required",
        "QuickBooks vendor link is required."
      ),
    },
    DocNumber: bill.invoiceNumber,
    TxnDate: bill.invoiceDate,
    ...(bill.dueDate ? { DueDate: bill.dueDate } : {}),
    CurrencyRef: { value: bill.currency },
    Line: bill.lines.flatMap(qboLines),
  };
}

export function buildQuickBooksBillPaymentPayload(
  payment: QuickBooksPaymentSource
): Record<string, unknown> {
  const bankAccountId = required(
    payment.bankAccountId,
    "qbo_bank_account_required",
    "QuickBooks requires a payment account mapping before this payment can sync."
  );
  const total = amount(payment.amount);
  const payType =
    payment.paymentMethod === "credit_card" ? "CreditCard" : "Check";
  const paymentDetail =
    payType === "CreditCard"
      ? { CreditCardPayment: { CCAccountRef: { value: bankAccountId } } }
      : { CheckPayment: { BankAccountRef: { value: bankAccountId } } };
  return {
    VendorRef: {
      value: required(
        payment.vendorId,
        "qbo_vendor_required",
        "QuickBooks vendor link is required."
      ),
    },
    TxnDate: payment.paymentDate,
    TotalAmt: total,
    PayType: payType,
    ...paymentDetail,
    ...(payment.reference ? { DocNumber: payment.reference } : {}),
    Line: [
      {
        Amount: total,
        LinkedTxn: [
          {
            TxnId: required(
              payment.billId,
              "qbo_bill_required",
              "QuickBooks bill link is required."
            ),
            TxnType: "Bill",
          },
        ],
      },
    ],
  };
}

export function buildSageSupplierPayload(
  supplier: SupplierPayloadSource
): Record<string, unknown> {
  return {
    contact: {
      name: supplier.displayName,
      contact_type_ids: ["VENDOR"],
      ...(supplier.email ? { email: supplier.email } : {}),
      ...(supplier.phone ? { telephone: supplier.phone } : {}),
      ...(supplier.taxNumber ? { tax_number: supplier.taxNumber } : {}),
    },
  };
}

export function buildSagePurchaseInvoicePayload(
  bill: ProviderBillSource,
  vendorId: string
): Record<string, unknown> {
  const dueDate = required(
    bill.dueDate,
    "sage_due_date_required",
    "Sage requires a due date before this bill can sync."
  );
  return {
    purchase_invoice: {
      contact_id: required(
        vendorId,
        "sage_vendor_required",
        "Sage vendor link is required."
      ),
      date: bill.invoiceDate,
      due_date: dueDate,
      vendor_reference: bill.invoiceNumber,
      invoice_lines: bill.lines.map((line) => ({
        description: line.description,
        quantity: quantity(line.quantity),
        unit_price: amount(line.unitPrice),
        ledger_account_id: required(
          line.externalAccountId,
          "sage_account_mapping_required",
          "Sage ledger account mapping is required before this bill can sync."
        ),
        tax_rate_id: required(
          line.externalTaxCodeId,
          "sage_tax_mapping_required",
          "Sage tax mapping is required before this bill can sync."
        ),
      })),
    },
  };
}

export function buildSageContactPaymentPayload(
  payment: SagePaymentSource
): Record<string, unknown> {
  const bankAccountId = required(
    payment.bankAccountId,
    "sage_bank_account_required",
    "Sage requires a bank account mapping before this payment can sync."
  );
  const total = amount(payment.amount);
  return {
    contact_payment: {
      transaction_type_id: "VENDOR_PAYMENT",
      contact_id: required(
        payment.vendorId,
        "sage_vendor_required",
        "Sage vendor link is required."
      ),
      bank_account_id: bankAccountId,
      date: payment.paymentDate,
      total_amount: total,
      ...(payment.paymentMethodId
        ? { payment_method_id: payment.paymentMethodId }
        : {}),
      ...(payment.reference ? { reference: payment.reference } : {}),
      allocated_artefacts: [
        {
          artefact_id: required(
            payment.billId,
            "sage_bill_required",
            "Sage bill link is required."
          ),
          amount: total,
        },
      ],
    },
  };
}
