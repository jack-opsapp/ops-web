import { describe, expect, it } from "vitest";
import {
  buildExpensePosting,
  expenseAccountingConfigurationSchema,
  type ExpenseMappingInput,
} from "@/lib/accounting/expenses/provider-mappers";

const config = expenseAccountingConfigurationSchema.parse({
  currency: "CAD",
  countryCode: "CA",
  liabilityAccountId: "40",
  reimbursementAccountId: "90",
  reimbursementPaymentMethod: "Cash",
  companyCardAccountId: "91",
  taxComponentAccounts: {},
});
function source(
  overrides: Partial<ExpenseMappingInput> = {}
): ExpenseMappingInput {
  return {
    provider: "quickbooks",
    eventId: "11111111-1111-4111-8111-111111111111",
    expenseId: "22222222-2222-4222-8222-222222222222",
    kind: "accrual",
    currency: "CAD",
    date: "2026-09-10",
    gross: "105.00",
    tax: "0.00",
    description: "Fuel",
    employeeId: "7",
    expenseAccountId: "60",
    configuration: config,
    ...overrides,
  };
}
describe("expense provider accounting", () => {
  it("keeps an approved crew claim owed and identifies an existing employee", () => {
    const plan = buildExpensePosting(source());
    expect(plan.resource).toBe("JournalEntry");
    expect(plan.payload.Line).toEqual([
      expect.objectContaining({
        Amount: 105,
        JournalEntryLineDetail: {
          PostingType: "Debit",
          AccountRef: { value: "60" },
        },
      }),
      expect.objectContaining({
        Amount: 105,
        JournalEntryLineDetail: {
          PostingType: "Credit",
          AccountRef: { value: "40" },
          Entity: { Type: "Employee", EntityRef: { value: "7" } },
        },
      }),
    ]);
  });
  it("uses the original employee and liability when repaying after settings changed", () => {
    const accrued = buildExpensePosting(source());
    const paid = buildExpensePosting(
      source({
        kind: "settlement",
        original: accrued.posting,
        employeeId: "8",
        configuration: { ...config, liabilityAccountId: "41" },
      })
    );
    expect(paid.resource).toBe("Purchase");
    expect(paid.payload).toMatchObject({
      EntityRef: { type: "Employee", value: "7" },
      AccountRef: { value: "90" },
      PaymentType: "Cash",
      TotalAmt: 105,
    });
    expect(paid.payload.Line).toEqual([
      expect.objectContaining({
        Amount: 105,
        AccountBasedExpenseLineDetail: { AccountRef: { value: "40" } },
      }),
    ]);
  });
  it("separates included receipt tax from the QBO base amount without increasing the employee debt", () => {
    const plan = buildExpensePosting(
      source({
        tax: "5.00",
        taxCodeId: "GST",
        taxComponents: [{ id: "GST5", rate: 5 }],
      })
    );
    expect(plan.payload).toMatchObject({
      GlobalTaxCalculation: "TaxExcluded",
      Line: [
        {
          Amount: 100,
          JournalEntryLineDetail: {
            TaxInclusiveAmt: 105,
            TaxAmount: 5,
            TaxCodeRef: { value: "GST" },
            TaxApplicableOn: "Purchase",
          },
        },
        { Amount: 105 },
      ],
    });
  });
  it("reverses frozen posting accounts and employee rather than current mappings", () => {
    const original = buildExpensePosting(source());
    const reversed = buildExpensePosting(
      source({
        kind: "reversal",
        original: original.posting,
        configuration: { ...config, liabilityAccountId: "41" },
        expenseAccountId: "61",
        employeeId: "8",
      })
    );
    expect(reversed.payload.Line).toMatchObject([
      {
        Amount: 105,
        JournalEntryLineDetail: {
          PostingType: "Credit",
          AccountRef: { value: "60" },
        },
      },
      {
        Amount: 105,
        JournalEntryLineDetail: {
          PostingType: "Debit",
          AccountRef: { value: "40" },
          Entity: { EntityRef: { value: "7" } },
        },
      },
    ]);
  });
  it("sends the net card expense so native purchase tax restores the captured gross total", () => {
    const plan = buildExpensePosting(
      source({
        kind: "purchase",
        tax: "5.00",
        taxCodeId: "GST",
        taxComponents: [{ id: "GST5", rate: 5 }],
      })
    );
    expect(plan.payload).toMatchObject({
      GlobalTaxCalculation: "TaxExcluded",
      TotalAmt: 105,
      Line: [
        {
          Amount: 100,
          AccountBasedExpenseLineDetail: { TaxCodeRef: { value: "GST" } },
        },
      ],
    });
  });
  it("reverses taxable entries using the same net base and purchase tax amount", () => {
    const original = buildExpensePosting(
      source({
        tax: "5.00",
        taxCodeId: "GST",
        taxComponents: [{ id: "GST5", rate: 5 }],
      })
    );
    const reversed = buildExpensePosting(
      source({ kind: "reversal", original: original.posting })
    );
    expect(reversed.payload.Line).toMatchObject([
      {
        Amount: 100,
        JournalEntryLineDetail: {
          PostingType: "Credit",
          TaxAmount: 5,
          TaxCodeRef: { value: "GST" },
        },
      },
      { Amount: 105, JournalEntryLineDetail: { PostingType: "Debit" } },
    ]);
  });
  it("posts a configured Sage Canadian input tax component to the tax return once", () => {
    const plan = buildExpensePosting(
      source({
        provider: "sage",
        employeeId: null,
        tax: "5.00",
        taxCodeId: "GST",
        taxComponents: [{ id: "GST5", rate: 5 }],
        configuration: {
          ...config,
          taxComponentAccounts: {
            GST5: { accountId: "GST_INPUT", recoverable: true },
          },
        },
      })
    );
    expect(plan.payload.journal_lines).toEqual([
      expect.objectContaining({
        ledger_account_id: "60",
        debit: 100,
        credit: 0,
        include_on_tax_return: false,
      }),
      expect.objectContaining({
        ledger_account_id: "GST_INPUT",
        debit: 5,
        credit: 0,
        include_on_tax_return: true,
      }),
      expect.objectContaining({
        ledger_account_id: "40",
        debit: 0,
        credit: 105,
        include_on_tax_return: false,
      }),
    ]);
  });
  it.each([null, "5.00"])(
    "keeps unknown or unmapped tax %s in review",
    (tax) => {
      expect(() => buildExpensePosting(source({ tax }))).toThrow(/tax/i);
    }
  );
  it("rejects a tax amount inconsistent with the mapped provider rate", () => {
    expect(() =>
      buildExpensePosting(
        source({
          tax: "6.00",
          taxCodeId: "GST",
          taxComponents: [{ id: "GST5", rate: 5 }],
        })
      )
    ).toThrow(/tax/i);
  });
  it("refuses an employee claim without an explicit existing employee mapping", () => {
    expect(() => buildExpensePosting(source({ employeeId: null }))).toThrow(
      /employee/i
    );
  });
  it("rejects a reversal against another expense or currency", () => {
    const original = buildExpensePosting(source()).posting;
    expect(() =>
      buildExpensePosting(
        source({
          kind: "reversal",
          original: { ...original, expenseId: "other" },
        })
      )
    ).toThrow(/original/i);
  });
  it("company-card purchases never create an employee reimbursement liability", () => {
    const plan = buildExpensePosting(
      source({ kind: "purchase", employeeId: null })
    );
    expect(plan.payload).toMatchObject({
      PaymentType: "CreditCard",
      AccountRef: { value: "91" },
      TotalAmt: 105,
    });
    expect(plan.posting.lines.map((line) => line.accountId)).toEqual([
      "60",
      "91",
    ]);
  });
  it("keeps project splits and their penny totals when reversing an expense", () => {
    const original = buildExpensePosting(
      source({
        gross: "10.01",
        allocations: [
          { grossCents: 501, externalProjectId: "job1" },
          { grossCents: 500, externalProjectId: "job2" },
        ],
      })
    );
    expect(original.payload.Line).toMatchObject([
      {
        Amount: 5.01,
        JournalEntryLineDetail: {
          Entity: { Type: "Customer", EntityRef: { value: "job1" } },
        },
      },
      {
        Amount: 5,
        JournalEntryLineDetail: {
          Entity: { Type: "Customer", EntityRef: { value: "job2" } },
        },
      },
      { Amount: 10.01 },
    ]);
    const reversal = buildExpensePosting(
      source({ gross: "10.01", kind: "reversal", original: original.posting })
    );
    expect(reversal.posting.lines.slice(0, 2)).toMatchObject([
      { projectId: "job1", cents: 501, side: "Credit" },
      { projectId: "job2", cents: 500, side: "Credit" },
    ]);
  });
  it("refuses project allocations that omit part of the receipt", () => {
    expect(() =>
      buildExpensePosting(
        source({
          allocations: [{ grossCents: 100, externalProjectId: "job1" }],
        })
      )
    ).toThrow(/allocations/i);
  });
  it("allows approval before a repayment bank or company card is configured", () => {
    const plan = buildExpensePosting(
      source({
        configuration: {
          ...config,
          reimbursementAccountId: null,
          reimbursementPaymentMethod: null,
          companyCardAccountId: null,
        },
      })
    );
    expect(plan.resource).toBe("JournalEntry");
  });
  it("allows card purchases without inventing employee reimbursement accounts", () => {
    const plan = buildExpensePosting(
      source({
        kind: "purchase",
        configuration: {
          ...config,
          reimbursementAccountId: null,
          reimbursementPaymentMethod: null,
          liabilityAccountId: null,
        },
      })
    );
    expect(plan.resource).toBe("Purchase");
  });
});
