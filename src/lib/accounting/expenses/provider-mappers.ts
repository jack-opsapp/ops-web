import { z } from "zod";
import { ProviderMappingError } from "@/lib/accounting/supplier-bills/provider-mappers";

const reference = z.string().trim().min(1).max(255);
export const expenseAccountingConfigurationSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    countryCode: z.enum(["US", "CA", "GB", "IE", "AU"]),
    liabilityAccountId: reference.nullable().default(null),
    reimbursementAccountId: reference.nullable().default(null),
    reimbursementPaymentMethod: reference.nullable().default(null),
    companyCardAccountId: reference.nullable().default(null),
    taxComponentAccounts: z
      .record(
        z.object({ accountId: reference, recoverable: z.boolean() }).strict()
      )
      .default({}),
  })
  .strict();
export type ExpenseAccountingConfiguration = z.infer<
  typeof expenseAccountingConfigurationSchema
>;
export type ExpenseEventKind =
  | "accrual"
  | "purchase"
  | "settlement"
  | "reversal"
  | "review";
export interface ExpenseTaxComponent {
  id: string;
  rate: number;
}
const postingLineSchema = z.object({
  accountId: reference,
  cents: z.number().int().positive().safe(),
  side: z.enum(["Debit", "Credit"]),
  role: z.enum(["expense", "tax", "liability", "funding"]),
  employeeId: reference.optional(),
  fundingType: z.enum(["bank", "credit_card"]).optional(),
  includeOnTaxReturn: z.boolean().optional(),
  projectId: reference.optional(),
  analysisCategoryId: reference.optional(),
  nativeTax: z
    .object({ codeId: reference, cents: z.number().int().nonnegative() })
    .optional(),
});
export const expensePostingGraphSchema = z.object({
  version: z.literal(1),
  eventId: reference,
  expenseId: reference,
  provider: z.enum(["quickbooks", "sage"]),
  kind: z.enum(["accrual", "purchase", "settlement", "reversal"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  countryCode: expenseAccountingConfigurationSchema.shape.countryCode,
  grossCents: z.number().int().positive().safe(),
  lines: z.array(postingLineSchema).min(2),
  resource: z.enum(["JournalEntry", "Purchase", "journals", "other_payments"]),
  configuration: expenseAccountingConfigurationSchema,
});
export type ExpensePostingGraph = z.infer<typeof expensePostingGraphSchema>;
type PostingLine = ExpensePostingGraph["lines"][number];
export interface ExpenseMappingInput {
  provider: "quickbooks" | "sage";
  eventId: string;
  expenseId: string;
  kind: ExpenseEventKind;
  currency: string;
  date: string;
  gross: string;
  tax: string | null;
  description: string;
  employeeId?: string | null;
  expenseAccountId?: string | null;
  configuration: ExpenseAccountingConfiguration;
  taxCodeId?: string | null;
  taxComponents?: ExpenseTaxComponent[];
  /** Sage bank account resource resolves to a distinct journal ledger account. */
  reimbursementLedgerAccountId?: string;
  original?: ExpensePostingGraph;
  allocations?: { grossCents: number; externalProjectId: string }[];
}
export interface ExpensePostingPlan {
  resource: ExpensePostingGraph["resource"];
  payload: Record<string, unknown>;
  posting: ExpensePostingGraph;
}
export function expenseMappingError(code: string, message: string): never {
  throw new ProviderMappingError(code, message);
}
export function expenseCents(value: unknown, label = "amount"): number {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)
  ) {
    return expenseMappingError(
      "expense_amount_invalid",
      `Expense ${label} needs review before accounting can sync.`
    );
  }
  const [whole, fractional = ""] = value.split(".");
  return Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
}
function required(value: string | null | undefined, label: string): string {
  return (
    value?.trim() ||
    expenseMappingError(
      "expense_mapping_required",
      `Map the expense ${label} before accounting can sync.`
    )
  );
}
function validDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    return expenseMappingError(
      "expense_date_invalid",
      "Expense accounting date needs review."
    );
  }
  return date;
}
function originalGraph(input: ExpenseMappingInput): ExpensePostingGraph {
  const parsed = expensePostingGraphSchema.safeParse(input.original);
  if (
    !parsed.success ||
    parsed.data.expenseId !== input.expenseId ||
    parsed.data.provider !== input.provider ||
    parsed.data.currency !== input.currency ||
    parsed.data.grossCents !== expenseCents(input.gross)
  ) {
    return expenseMappingError(
      "expense_original_posting_invalid",
      "The original expense posting needs review before this change can sync."
    );
  }
  assertBalanced(parsed.data.lines);
  return parsed.data;
}
function assertBalanced(lines: PostingLine[]) {
  const total = lines.reduce(
    (sum, line) => sum + (line.side === "Debit" ? line.cents : -line.cents),
    0
  );
  if (total !== 0)
    expenseMappingError(
      "expense_posting_unbalanced",
      "Expense accounting entries do not balance."
    );
}
function taxAmounts(
  input: ExpenseMappingInput,
  tax: number,
  net: number
): { component: ExpenseTaxComponent; cents: number }[] {
  if (!input.taxCodeId || !input.taxComponents?.length) {
    return expenseMappingError(
      "expense_tax_mapping_required",
      "Map the receipt tax rate before accounting can sync."
    );
  }
  const components = input.taxComponents;
  if (
    new Set(components.map((item) => item.id)).size !== components.length ||
    components.some(
      (item) =>
        !item.id ||
        !Number.isFinite(item.rate) ||
        item.rate <= 0 ||
        item.rate > 100
    )
  ) {
    return expenseMappingError(
      "expense_tax_rate_invalid",
      "The mapped receipt tax components need review."
    );
  }
  const amounts = components.map((component) => ({
    component,
    cents: Math.round((net * component.rate) / 100),
  }));
  // Do not distribute an unexplained difference into a recoverable tax account.
  if (amounts.reduce((sum, entry) => sum + entry.cents, 0) !== tax) {
    return expenseMappingError(
      "expense_tax_mismatch",
      "Receipt tax does not match the mapped accounting tax rate. Review the receipt and mapping."
    );
  }
  return amounts;
}

/** Amount is the receipt total INCLUDING tax. Tax is never added to this total. */
export function buildExpensePosting(
  input: ExpenseMappingInput
): ExpensePostingPlan {
  const configResult = expenseAccountingConfigurationSchema.safeParse(
    input.configuration
  );
  if (!configResult.success)
    expenseMappingError(
      "expense_settings_required",
      "Complete expense accounting settings before syncing."
    );
  const config = configResult.data;
  if (input.kind === "review")
    expenseMappingError(
      "expense_history_review",
      "Review the existing expense accounting history before syncing this expense."
    );
  if (input.currency !== config.currency)
    expenseMappingError(
      "expense_currency_mismatch",
      "Receipt and accounting currencies must match. Review this expense before syncing."
    );
  if (
    input.provider === "sage" &&
    !["CA", "GB", "IE"].includes(config.countryCode)
  ) {
    expenseMappingError(
      "sage_expense_region_unsupported",
      "This Sage Accounting region does not support the required expense journal API."
    );
  }
  const gross = expenseCents(input.gross);
  if (gross <= 0)
    expenseMappingError(
      "expense_amount_invalid",
      "Expense total must be greater than zero."
    );
  let lines: PostingLine[];
  let countryCode = config.countryCode;
  let resource: ExpensePostingGraph["resource"] =
    input.provider === "quickbooks" ? "JournalEntry" : "journals";
  if (input.kind === "reversal") {
    const original = originalGraph(input);
    countryCode = original.countryCode;
    lines = original.lines.map((line) => ({
      ...line,
      side: line.side === "Debit" ? "Credit" : "Debit",
    }));
  } else if (input.kind === "settlement") {
    const original = originalGraph(input);
    if (original.kind !== "accrual")
      expenseMappingError(
        "expense_original_posting_invalid",
        "Repayment must reference the original owed expense posting."
      );
    const liabilities = original.lines.filter(
      (line) => line.role === "liability" && line.side === "Credit"
    );
    if (liabilities.length !== 1 || liabilities[0].cents !== gross)
      expenseMappingError(
        "expense_original_posting_invalid",
        "The original reimbursement liability needs review."
      );
    countryCode = original.countryCode;
    lines = [
      { ...liabilities[0], side: "Debit" },
      {
        accountId:
          input.provider === "sage"
            ? required(
                input.reimbursementLedgerAccountId,
                "repayment bank ledger account"
              )
            : required(config.reimbursementAccountId, "repayment bank account"),
        cents: gross,
        side: "Credit",
        role: "funding",
        fundingType: "bank",
      },
    ];
    resource = input.provider === "quickbooks" ? "Purchase" : "other_payments";
  } else {
    const tax = expenseCents(input.tax, "tax amount");
    if (tax >= gross)
      expenseMappingError(
        "expense_tax_invalid",
        "Receipt tax must be less than the gross total."
      );
    const expenseAccountId = required(
      input.expenseAccountId,
      "category account"
    );
    const components = tax > 0 ? taxAmounts(input, tax, gross - tax) : [];
    if (input.provider === "quickbooks") {
      if (tax > 0 && config.countryCode === "US")
        expenseMappingError(
          "expense_tax_review_required",
          "US purchase tax treatment needs an explicit accounting review."
        );
      lines = [
        {
          accountId: expenseAccountId,
          cents: gross,
          side: "Debit",
          role: "expense",
          ...(tax > 0
            ? { nativeTax: { codeId: input.taxCodeId!, cents: tax } }
            : {}),
        },
      ];
    } else {
      lines = [
        {
          accountId: expenseAccountId,
          cents: gross - tax,
          side: "Debit",
          role: "expense",
        },
      ];
      for (const { component, cents } of components) {
        const mapping = config.taxComponentAccounts[component.id];
        if (!mapping)
          expenseMappingError(
            "expense_tax_account_required",
            "Map each receipt tax component and its recovery treatment before syncing."
          );
        if (mapping.recoverable && config.countryCode !== "CA")
          expenseMappingError(
            "expense_tax_return_review",
            "This region's journal tax-return treatment needs accounting review."
          );
        if (cents > 0)
          lines.push({
            accountId: mapping.accountId,
            cents,
            side: "Debit",
            role: "tax",
            includeOnTaxReturn: mapping.recoverable,
          });
      }
    }
    if (input.kind === "accrual") {
      lines.push({
        accountId: required(
          config.liabilityAccountId,
          "crew reimbursement liability account"
        ),
        cents: gross,
        side: "Credit",
        role: "liability",
        ...(input.provider === "quickbooks"
          ? { employeeId: required(input.employeeId, "employee in QuickBooks") }
          : {}),
      });
    } else {
      lines.push({
        accountId: required(
          config.companyCardAccountId,
          "company card account"
        ),
        cents: gross,
        side: "Credit",
        role: "funding",
        fundingType: "credit_card",
      });
      if (input.provider === "quickbooks") resource = "Purchase";
    }
  }
  assertBalanced(lines);
  if (
    ["accrual", "purchase"].includes(input.kind) &&
    input.allocations?.length
  ) {
    const allocations = input.allocations;
    if (
      allocations.some(
        (allocation) =>
          !allocation.externalProjectId ||
          !Number.isSafeInteger(allocation.grossCents) ||
          allocation.grossCents <= 0
      ) ||
      allocations.reduce(
        (sum, allocation) => sum + allocation.grossCents,
        0
      ) !== gross
    ) {
      expenseMappingError(
        "expense_allocation_invalid",
        "Expense project allocations must match the receipt total and have accounting project mappings."
      );
    }
    // Largest remainder keeps every account and tax amount exact to the cent.
    const split = (total: number) => {
      const portions = allocations.map((allocation, index) => ({
        index,
        exact: (total * allocation.grossCents) / gross,
        cents: Math.floor((total * allocation.grossCents) / gross),
      }));
      let remainder =
        total - portions.reduce((sum, portion) => sum + portion.cents, 0);
      for (const portion of [...portions].sort(
        (a, b) => b.exact - b.cents - (a.exact - a.cents) || a.index - b.index
      )) {
        if (remainder-- > 0) portion.cents += 1;
      }
      return portions.map((portion) => portion.cents);
    };
    lines = lines.flatMap((line) => {
      if (line.side !== "Debit") return [line];
      const amounts = split(line.cents),
        taxes = split(line.nativeTax?.cents ?? 0);
      return allocations.flatMap((allocation, index) =>
        amounts[index]
          ? [
              {
                ...line,
                cents: amounts[index],
                ...(input.provider === "quickbooks"
                  ? { projectId: allocation.externalProjectId }
                  : { analysisCategoryId: allocation.externalProjectId }),
                ...(line.nativeTax
                  ? { nativeTax: { ...line.nativeTax, cents: taxes[index] } }
                  : {}),
              },
            ]
          : []
      );
    });
    assertBalanced(lines);
  }
  if (
    lines.some((line) => line.nativeTax && line.nativeTax.cents >= line.cents)
  ) {
    expenseMappingError(
      "expense_allocated_tax_invalid",
      "A project tax split leaves no expense base. Review the allocation amounts before syncing."
    );
  }
  const posting: ExpensePostingGraph = {
    version: 1,
    eventId: input.eventId,
    expenseId: input.expenseId,
    provider: input.provider,
    kind: input.kind,
    currency: input.currency,
    countryCode,
    grossCents: gross,
    lines,
    resource,
    configuration: config,
  };
  const date = validDate(input.date);
  const description =
    `OPS event ${input.eventId} expense ${input.expenseId} | ${input.description}`.slice(
      0,
      200
    );
  let payload: Record<string, unknown>;
  if (resource === "JournalEntry") {
    payload = {
      TxnDate: date,
      CurrencyRef: { value: posting.currency },
      PrivateNote: description,
      ...(countryCode === "US" ? {} : { GlobalTaxCalculation: "TaxExcluded" }),
      Line: lines.map((line) => ({
        // API distribution amounts are the base amount. The native purchase
        // tax line supplies the included tax; the employee liability stays gross.
        Amount: (line.cents - (line.nativeTax?.cents ?? 0)) / 100,
        Description: description,
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: {
          PostingType: line.side,
          AccountRef: { value: line.accountId },
          ...(line.employeeId
            ? {
                Entity: {
                  Type: "Employee",
                  EntityRef: { value: line.employeeId },
                },
              }
            : {}),
          ...(line.projectId
            ? {
                Entity: {
                  Type: "Customer",
                  EntityRef: { value: line.projectId },
                },
              }
            : {}),
          ...(line.nativeTax
            ? {
                TaxCodeRef: { value: line.nativeTax.codeId },
                TaxApplicableOn: "Purchase",
                TaxAmount: line.nativeTax.cents / 100,
                TaxInclusiveAmt: line.cents / 100,
              }
            : {}),
        },
      })),
    };
  } else if (resource === "Purchase") {
    const funding = lines.find((line) => line.role === "funding")!;
    const employee = lines.find((line) => line.employeeId)?.employeeId;
    const paymentType =
      input.kind === "purchase"
        ? "CreditCard"
        : required(config.reimbursementPaymentMethod, "repayment method");
    if (
      !["Cash", "Check", "CreditCard"].includes(paymentType) ||
      (input.kind === "settlement" && paymentType === "CreditCard")
    ) {
      expenseMappingError(
        "expense_payment_method_invalid",
        "Map the QuickBooks reimbursement method to Cash or Check."
      );
    }
    payload = {
      TxnDate: date,
      CurrencyRef: { value: posting.currency },
      PrivateNote: description,
      PaymentType: paymentType,
      AccountRef: { value: funding.accountId },
      TotalAmt: gross / 100,
      ...(employee ? { EntityRef: { type: "Employee", value: employee } } : {}),
      ...(countryCode === "US" ? {} : { GlobalTaxCalculation: "TaxExcluded" }),
      Line: lines
        .filter((line) => line.side === "Debit")
        .map((line) => ({
          Amount: (line.cents - (line.nativeTax?.cents ?? 0)) / 100,
          Description: description,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: line.accountId },
            ...(line.projectId
              ? { CustomerRef: { value: line.projectId } }
              : {}),
            ...(line.nativeTax
              ? { TaxCodeRef: { value: line.nativeTax.codeId } }
              : {}),
          },
        })),
    };
  } else if (resource === "journals") {
    payload = {
      date,
      reference: `OPS-${input.eventId}`,
      description,
      journal_lines: lines.map((line) => ({
        ledger_account_id: line.accountId,
        debit: line.side === "Debit" ? line.cents / 100 : 0,
        credit: line.side === "Credit" ? line.cents / 100 : 0,
        details: description,
        include_on_tax_return: line.includeOnTaxReturn === true,
        ...(line.analysisCategoryId
          ? { analysis_type_categories: [line.analysisCategoryId] }
          : {}),
      })),
    };
  } else {
    payload = {
      transaction_type_id: "OTHER_PAYMENT",
      date,
      reference: `OPS-${input.eventId.replaceAll("-", "").slice(0, 21)}`,
      bank_account_id: required(
        config.reimbursementAccountId,
        "repayment bank account"
      ),
      payment_method_id: required(
        config.reimbursementPaymentMethod,
        "repayment method"
      ),
      total_amount: gross / 100,
      net_amount: gross / 100,
      tax_amount: 0,
      payment_lines: [
        {
          ledger_account_id: lines[0].accountId,
          total_amount: gross / 100,
          net_amount: gross / 100,
          tax_amount: 0,
          details: description,
        },
      ],
    };
  }
  return { resource, payload, posting };
}
