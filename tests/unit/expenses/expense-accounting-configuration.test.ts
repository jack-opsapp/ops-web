// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  list: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: { getValidToken: mocks.token },
}));
vi.mock("@/lib/api/services/sage-api-client", () => ({
  createSageReadClient: () => ({ list: mocks.list }),
}));
vi.mock("@/lib/api/services/token-cipher", () => ({
  decryptToken: mocks.decrypt,
}));
import {
  expenseSettingsRequestSchema,
  loadExpenseCatalogue,
  loadExpenseProjectSettings,
  qboExpenseCatalogue,
  sageExpenseCatalogue,
  validateExpenseSettingsSelection,
} from "@/lib/accounting/expenses/configuration-service";

const connectionId = "0db4e6af-3b62-41d5-9a86-d7569c57c1e8";
const config = {
  currency: "CAD",
  countryCode: "CA",
  liabilityAccountId: "1",
  reimbursementAccountId: "2",
  reimbursementPaymentMethod: "Check",
  companyCardAccountId: null,
  taxComponentAccounts: {},
};
const catalogue = qboExpenseCatalogue(
  [
    { Id: "1", Name: "Crew owed", AccountType: "Other Current Liability" },
    {
      Id: "2",
      Name: "Operating",
      AccountType: "Bank",
      CurrencyRef: { value: "CAD" },
    },
    { Id: "3", Name: "Supplies", AccountType: "Expense" },
    { Id: "4", Name: "Inactive", AccountType: "Bank", Active: false },
  ].map((account) => ({ Active: true, ...account })),
  [{ Id: "10", DisplayName: "Crew person", Active: true }],
  [
    {
      Id: "20",
      Name: "GST",
      PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "30" } }] },
    },
  ],
  [{ Id: "30", Name: "GST 5%", RateValue: 5 }]
);
const emptyConfig = {
  ...config,
  liabilityAccountId: null,
  reimbursementAccountId: null,
  reimbursementPaymentMethod: null,
};
const inputFor = (
  configuration = {},
  categoryMappings: unknown[] = [],
  payeeMappings: unknown[] = []
) =>
  expenseSettingsRequestSchema.parse({
    connectionId,
    catalogueBinding: `quickbooks:sandbox:${"a".repeat(64)}`,
    configuration: { ...emptyConfig, ...configuration },
    categoryMappings,
    payeeMappings,
  });
beforeEach(() => vi.clearAllMocks());
describe("expense accounting configuration", () => {
  it("lists only proven active QBO jobs, with parent-qualified names and separate inactive names", () => {
    const result = qboExpenseCatalogue(
      [],
      [],
      [],
      [],
      [
        {
          Id: "1",
          Job: true,
          Active: true,
          DisplayName: "Roof",
          FullyQualifiedName: "Client:Roof",
        },
        {
          Id: "2",
          Job: true,
          Active: false,
          FullyQualifiedName: "Client:Old roof",
        },
        { Id: "3", Job: false, Active: true, DisplayName: "Client" },
        { Id: "4", Job: true, DisplayName: "Unproven" },
      ]
    );
    expect(result.accountingProjects).toEqual([
      { id: "1", name: "Client:Roof" },
    ]);
    expect(result.preservedProjects).toEqual([
      { id: "2", name: "Client:Old roof" },
    ]);
  });
  it("preserves only the exact stored unavailable project mapping and rejects duplicates", () => {
    const mapping = { projectId: connectionId, externalProjectId: "old-job" };
    const input = { ...inputFor(), projectMappings: [mapping] };
    expect(() =>
      validateExpenseSettingsSelection(
        input,
        "quickbooks",
        catalogue,
        [],
        [mapping]
      )
    ).not.toThrow();
    expect(() =>
      validateExpenseSettingsSelection(
        input,
        "quickbooks",
        catalogue,
        [],
        [{ ...mapping, projectId: "other-project" }]
      )
    ).toThrow(/existing accounting project/i);
    expect(() =>
      validateExpenseSettingsSelection(
        { ...input, projectMappings: [mapping, mapping] },
        "quickbooks",
        catalogue,
        [],
        [mapping]
      )
    ).toThrow(/one accounting assignment/i);
  });

  it("lists real named accounts, employees and combined purchase tax rates", () => {
    expect(catalogue.accounts.map((a) => a.id)).toEqual(["1", "2", "3"]);
    expect(catalogue.accounts[0].kind).toBe("liability");
    expect(catalogue.taxRates[0]).toEqual({
      id: "20",
      name: "GST",
      percentage: 5,
      components: [{ id: "30", name: "GST 5%", percentage: 5 }],
    });
  });
  it("permits a crew-only company without inventing a company-card account", () => {
    const input = expenseSettingsRequestSchema.parse({
      connectionId,
      catalogueBinding: `quickbooks:sandbox:${"a".repeat(64)}`,
      configuration: config,
      categoryMappings: [],
      payeeMappings: [],
    });
    expect(() =>
      validateExpenseSettingsSelection(input, "quickbooks", catalogue)
    ).not.toThrow();
  });
  it.each([
    { liabilityAccountId: "2" },
    { reimbursementAccountId: "3" },
    { reimbursementPaymentMethod: "unknown" },
    { currency: "USD" },
    { companyCardAccountId: "4" },
  ])(
    "rejects wrong type, currency, inactive or absent selections %j",
    (patch) => {
      const input = expenseSettingsRequestSchema.parse({
        connectionId,
        catalogueBinding: `quickbooks:sandbox:${"a".repeat(64)}`,
        configuration: { ...config, ...patch },
        categoryMappings: [],
        payeeMappings: [],
      });
      expect(() =>
        validateExpenseSettingsSelection(input, "quickbooks", catalogue)
      ).toThrow();
    }
  );
  it("does not accept a missing provider employee or wrong tax percentage", () => {
    const input = expenseSettingsRequestSchema.parse({
      connectionId,
      catalogueBinding: `quickbooks:sandbox:${"a".repeat(64)}`,
      configuration: config,
      categoryMappings: [],
      payeeMappings: [{ userId: connectionId, externalEmployeeId: "99" }],
    });
    expect(() =>
      validateExpenseSettingsSelection(input, "quickbooks", catalogue)
    ).toThrow("employee");
    input.payeeMappings = [];
    input.taxMappings = [{ taxRate: 7, externalTaxCodeId: "20" }];
    expect(() =>
      validateExpenseSettingsSelection(input, "quickbooks", catalogue)
    ).toThrow("tax code");
  });
  it("offers Sage transaction categories enabled for journals and qualifies duplicate category names", () => {
    const result = sageExpenseCatalogue(
      [],
      [],
      [],
      [],
      "2026-09-14",
      [
        { id: "eligible", name: "West", analysis_type: { id: "projects" } },
        {
          id: "other-eligible",
          name: "West",
          analysis_type: { id: "departments" },
        },
        { id: "group", name: "Wrong level", analysis_type: { id: "groups" } },
        { id: "sales", name: "Sales only", analysis_type: { id: "sales" } },
        {
          id: "orphan",
          name: "Missing parent",
          analysis_type: { id: "missing" },
        },
      ],
      [
        {
          id: "projects",
          name: "Projects",
          active_areas: ["JOURNALS"],
          analysis_type_level: { identifier: "TRANSACTION" },
        },
        {
          id: "departments",
          name: "Departments",
          active_areas: ["JOURNALS", "EXPENSES"],
          analysis_type_level: { identifier: "TRANSACTION" },
        },
        {
          id: "groups",
          name: "Groups",
          active_areas: ["JOURNALS"],
          analysis_type_level: { identifier: "GROUP" },
        },
        {
          id: "sales",
          name: "Sales",
          active_areas: ["SALES"],
          analysis_type_level: { identifier: "TRANSACTION" },
        },
      ]
    );
    expect(result.accountingProjects).toEqual([
      { id: "eligible", name: "Projects: West" },
      { id: "other-eligible", name: "Departments: West" },
    ]);
    expect(result.preservedProjects).toEqual([
      { id: "group", name: "Groups: Wrong level" },
      { id: "sales", name: "Sales: Sales only" },
    ]);
  });
  it("keeps Sage bank resource IDs distinct from journal ledger IDs", () => {
    const result = sageExpenseCatalogue(
      [
        {
          id: "ledger",
          displayed_as: "Crew payable",
          included_in_chart: true,
          visible_in_journals: true,
          ledger_account_type: {
            id: "NATIVE",
            displayed_as: "Native liability",
          },
        },
      ],
      [
        {
          id: "bank",
          displayed_as: "Operating bank",
          is_active: true,
          currency: { id: "CAD" },
          ledger_account: { id: "bank-ledger" },
        },
      ],
      [],
      [],
      "2026-09-12"
    );
    expect(result.accounts).toMatchObject([
      { id: "ledger", kind: "other", visibleInJournals: true },
      { id: "bank", kind: "bank" },
    ]);
    expect(result.accounts.some((a) => a.id === "bank-ledger")).toBe(false);
  });
  it("uses effective Sage component percentages and omits ambiguous tax catalog entries", () => {
    const result = sageExpenseCatalogue(
      [],
      [],
      [],
      [
        {
          id: "combined",
          displayed_as: "GST/PST",
          is_combined_rate: true,
          component_tax_rates: [
            { id: "gst", displayed_as: "GST", percentage: 5 },
            {
              id: "pst",
              displayed_as: "PST",
              percentages: [
                { percentage: 7, from_date: "2020-01-01", to_date: null },
              ],
            },
          ],
        },
        {
          id: "ambiguous",
          displayed_as: "Ambiguous",
          percentages: [{ percentage: 5 }, { percentage: 7 }],
        },
      ],
      "2026-09-12"
    );
    expect(result.taxRates.map((r) => [r.id, r.percentage])).toEqual([
      ["combined", 12],
    ]);
  });
  it("does not call a generic Sage asset a recoverable tax-control account", () => {
    const input = expenseSettingsRequestSchema.parse({
      connectionId,
      catalogueBinding: `quickbooks:sandbox:${"a".repeat(64)}`,
      configuration: {
        ...config,
        liabilityAccountId: null,
        reimbursementAccountId: null,
        reimbursementPaymentMethod: null,
        taxComponentAccounts: {
          gst: { accountId: "asset", recoverable: true },
        },
      },
      categoryMappings: [],
      payeeMappings: [],
    });
    expect(() =>
      validateExpenseSettingsSelection(input, "sage", {
        accounts: [{ id: "asset", name: "Asset", kind: "other" }],
        employees: [],
        paymentMethods: [],
        taxRates: [],
        taxComponents: [{ id: "gst", name: "GST" }],
      })
    ).toThrow("tax-control");
  });
  it("requests the Sage attributes consumed by account and tax validation", async () => {
    mocks.token.mockResolvedValue({
      accessToken: "fake",
      providerEnvironment: "production",
    });
    mocks.decrypt.mockReturnValue("business");
    mocks.list.mockResolvedValue([]);
    await loadExpenseCatalogue({} as SupabaseClient, {
      id: connectionId,
      provider: "sage",
      provider_environment: "production",
      sage_business_id: "encrypted",
    });
    expect(mocks.list).toHaveBeenCalledWith("analysis_type_categories", {
      query: { attributes: "all", analysis_type_level: "TRANSACTION" },
    });
    expect(mocks.list).toHaveBeenCalledWith("analysis_types", {
      query: { attributes: "all", analysis_type_level: "TRANSACTION" },
    });
    const attributes = (resource: string) =>
      String(
        mocks.list.mock.calls.find(([name]) => name === resource)?.[1]?.query
          ?.attributes
      ).split(",");
    expect(attributes("ledger_accounts")).toEqual(
      expect.arrayContaining([
        "ledger_account_type",
        "included_in_chart",
        "visible_in_journals",
        "visible_in_other_payments",
        "is_control_account",
        "control_name",
        "tax_recoverable",
        "recoverable_percentage",
      ])
    );
    expect(attributes("bank_accounts")).toEqual(
      expect.arrayContaining([
        "currency",
        "is_active",
        "deleted_at",
        "ledger_account",
      ])
    );
    expect(attributes("tax_rates")).toEqual(
      expect.arrayContaining([
        "percentage",
        "percentages",
        "is_visible",
        "is_combined_rate",
        "component_tax_rates",
      ])
    );
  });
  it("never offers a QuickBooks account or employee whose active state is unknown", () => {
    const result = qboExpenseCatalogue(
      [{ Id: "unknown", Name: "Unknown", AccountType: "Expense" }],
      [{ Id: "unknown", DisplayName: "Unknown" }],
      [],
      []
    );
    expect(result.accounts).toEqual([]);
    expect(result.employees).toEqual([]);
  });
  it("keeps inactive QuickBooks employee names separate from assignable choices", () => {
    const result = qboExpenseCatalogue(
      [],
      [
        { Id: "active", DisplayName: "Active employee", Active: true },
        { Id: "inactive", DisplayName: "Former employee", Active: false },
      ],
      [],
      []
    );
    expect(result.employees).toEqual([
      { id: "active", name: "Active employee" },
    ]);
    expect(result.preservedEmployees).toEqual([
      { id: "inactive", name: "Former employee" },
    ]);
    expect(() =>
      validateExpenseSettingsSelection(
        inputFor(
          {},
          [],
          [{ userId: connectionId, externalEmployeeId: "inactive" }]
        ),
        "quickbooks",
        result
      )
    ).toThrow("employee");
  });
  it("rejects compound, unknown and repeated QuickBooks tax components", () => {
    const codes = [
      {
        Id: "compound",
        PurchaseTaxRateList: {
          TaxRateDetail: [
            { TaxRateRef: { value: "tax" }, TaxTypeApplicable: "TaxOnTax" },
          ],
        },
      },
      {
        Id: "duplicate",
        PurchaseTaxRateList: {
          TaxRateDetail: [
            { TaxRateRef: { value: "tax" } },
            { TaxRateRef: { value: "tax" } },
          ],
        },
      },
      {
        Id: "null",
        PurchaseTaxRateList: {
          TaxRateDetail: [{ TaxRateRef: { value: "missing" } }],
        },
      },
    ];
    expect(
      qboExpenseCatalogue([], [], codes, [
        { Id: "tax", RateValue: 5 },
        { Id: "missing", RateValue: null },
      ]).taxRates
    ).toEqual([]);
  });
  it("omits hidden, incomplete combined and nested Sage tax choices", () => {
    expect(
      sageExpenseCatalogue(
        [],
        [],
        [],
        [
          { id: "hidden", is_visible: false, percentage: 5 },
          { id: "missing", is_combined_rate: true, percentage: 12 },
          {
            id: "nested",
            is_combined_rate: true,
            component_tax_rates: [
              { id: "child", is_combined_rate: true, percentage: 5 },
            ],
          },
          { id: "null", percentages: [{ percentage: null }] },
        ],
        "2026-09-12"
      ).taxRates
    ).toEqual([]);
  });
  it.each([
    { visible_in_journals: false },
    { visible_in_other_payments: false },
    { is_control_account: true, control_name: "CUSTOMER" },
  ])(
    "rejects Sage reimbursement ledgers the worker cannot settle %j",
    (patch) => {
      const result = sageExpenseCatalogue(
        [
          {
            id: "ledger",
            displayed_as: "Crew owed",
            included_in_chart: true,
            visible_in_journals: true,
            visible_in_other_payments: true,
            ...patch,
          },
        ],
        [],
        [],
        [],
        "2026-09-12"
      );
      expect(() =>
        validateExpenseSettingsSelection(
          inputFor({ liabilityAccountId: "ledger" }),
          "sage",
          result
        )
      ).toThrow();
    }
  );
  it("rejects partial Sage tax recovery and journal-hidden category accounts", () => {
    for (const patch of [
      { tax_recoverable: true, recoverable_percentage: 50 },
      { visible_in_journals: false },
    ]) {
      const result = sageExpenseCatalogue(
        [
          {
            id: "expense",
            displayed_as: "Supplies",
            visible_in_journals: true,
            ...patch,
          },
        ],
        [],
        [],
        [],
        "2026-09-12"
      );
      expect(() =>
        validateExpenseSettingsSelection(
          inputFor({}, [
            { categoryId: connectionId, externalAccountId: "expense" },
          ]),
          "sage",
          result
        )
      ).toThrow();
    }
  });
  it("requires the Sage repayment bank currency and usable linked journal ledger", () => {
    for (const patch of [
      { currency: undefined },
      { ledger_account: undefined },
    ]) {
      const result = sageExpenseCatalogue(
        [
          {
            id: "ledger",
            displayed_as: "Bank ledger",
            visible_in_journals: true,
          },
        ],
        [
          {
            id: "bank",
            displayed_as: "Bank",
            is_active: true,
            currency: { id: "CAD" },
            ledger_account: { id: "ledger" },
            ...patch,
          },
        ],
        [],
        [],
        "2026-09-12"
      );
      expect(() =>
        validateExpenseSettingsSelection(
          inputFor({ reimbursementAccountId: "bank" }),
          "sage",
          result
        )
      ).toThrow();
    }
  });
  it("accepts usable Sage journal, repayment and native Canadian input-tax accounts", () => {
    const result = sageExpenseCatalogue(
      [
        {
          id: "owed",
          displayed_as: "Crew owed",
          visible_in_journals: true,
          visible_in_other_payments: true,
        },
        {
          id: "bank-ledger",
          displayed_as: "Bank ledger",
          visible_in_journals: true,
        },
        {
          id: "expense",
          displayed_as: "Supplies",
          visible_in_journals: true,
          tax_recoverable: true,
          recoverable_percentage: 100,
        },
        {
          id: "tax",
          displayed_as: "GST input tax",
          visible_in_journals: true,
          is_control_account: true,
          control_name: "native-input-control",
        },
      ],
      [
        {
          id: "bank",
          displayed_as: "Bank",
          is_active: true,
          currency: { id: "CAD" },
          ledger_account: { id: "bank-ledger" },
        },
      ],
      [{ id: "BANK_TRANSFER", displayed_as: "Bank transfer" }],
      [{ id: "gst", displayed_as: "GST", percentage: 5 }],
      "2026-09-12"
    );
    const input = inputFor(
      {
        liabilityAccountId: "owed",
        reimbursementAccountId: "bank",
        reimbursementPaymentMethod: "BANK_TRANSFER",
        taxComponentAccounts: { gst: { accountId: "tax", recoverable: true } },
      },
      [{ categoryId: connectionId, externalAccountId: "expense" }]
    );
    expect(() =>
      validateExpenseSettingsSelection(input, "sage", result)
    ).not.toThrow();
    input.configuration.countryCode = "GB";
    expect(() =>
      validateExpenseSettingsSelection(input, "sage", result)
    ).toThrow("Canadian");
  });
  it("accepts QBO asset distribution accounts but rejects other unrelated account types", () => {
    const result = qboExpenseCatalogue(
      [
        {
          Id: "asset",
          Name: "Equipment",
          AccountType: "Fixed Asset",
          Active: true,
        },
        { Id: "equity", Name: "Equity", AccountType: "Equity", Active: true },
      ],
      [],
      [],
      []
    );
    expect(() =>
      validateExpenseSettingsSelection(
        inputFor({}, [
          { categoryId: connectionId, externalAccountId: "asset" },
        ]),
        "quickbooks",
        result
      )
    ).not.toThrow();
    expect(() =>
      validateExpenseSettingsSelection(
        inputFor({}, [
          { categoryId: connectionId, externalAccountId: "equity" },
        ]),
        "quickbooks",
        result
      )
    ).toThrow("expense or asset");
  });
  it("preserves only the exact stored inactive employee assignment", () => {
    const preserved = [
      { userId: connectionId, externalEmployeeId: "inactive" },
    ];
    expect(() =>
      validateExpenseSettingsSelection(
        inputFor({}, [], preserved),
        "quickbooks",
        catalogue,
        preserved
      )
    ).not.toThrow();
    expect(() =>
      validateExpenseSettingsSelection(
        inputFor(
          {},
          [],
          [{ userId: connectionId, externalEmployeeId: "another" }]
        ),
        "quickbooks",
        catalogue,
        preserved
      )
    ).toThrow("employee");
    expect(() =>
      validateExpenseSettingsSelection(
        inputFor(
          {},
          [],
          [
            {
              userId: "17300a4e-45d0-4770-9f75-fbb0ca62bb54",
              externalEmployeeId: "inactive",
            },
          ]
        ),
        "quickbooks",
        catalogue,
        preserved
      )
    ).toThrow("employee");
    expect(() =>
      validateExpenseSettingsSelection(
        inputFor({}, [], preserved),
        "sage",
        catalogue,
        preserved
      )
    ).toThrow("employee");
  });
  it("rejects duplicate receipt tax rates before the guarded write", () => {
    const input = inputFor();
    input.taxMappings = [
      { taxRate: 5, externalTaxCodeId: "20" },
      { taxRate: 5, externalTaxCodeId: "20" },
    ];
    expect(() =>
      validateExpenseSettingsSelection(input, "quickbooks", catalogue)
    ).toThrow("tax rate");
  });
});

describe("expense project catalogue scoping", () => {
  it("pages company allocations, includes stored archived projects, and excludes foreign projects", async () => {
    const own = "00000000-0000-4000-8000-000000000001";
    const archived = "00000000-0000-4000-8000-000000000002";
    const foreign = "00000000-0000-4000-8000-000000000003";
    const reads: {
      table: string;
      filters: Record<string, unknown>;
      range?: number[];
    }[] = [];
    const db = {
      from(table: string) {
        const read = {
          table,
          filters: {} as Record<string, unknown>,
          range: undefined as number[] | undefined,
        };
        reads.push(read);
        const query = {
          select: () => query,
          order: () => query,
          eq: (key: string, value: unknown) => {
            read.filters[key] = value;
            return query;
          },
          in: (key: string, value: unknown) => {
            read.filters[key] = value;
            return query;
          },
          range: (start: number, end: number) => {
            read.range = [start, end];
            return query;
          },
          then: (resolve: (v: unknown) => unknown) => {
            const data =
              table === "expense_accounting_project_mappings"
                ? [{ project_id: archived, external_project_id: "old-job" }]
                : table === "expense_project_allocations"
                  ? read.range?.[0] === 0
                    ? Array.from({ length: 1000 }, () => ({ project_id: own }))
                    : [
                        { project_id: foreign },
                        { project_id: "legacy-invalid-id" },
                      ]
                  : [
                      { id: own, title: "Completed", deleted_at: null },
                      {
                        id: archived,
                        title: "Former",
                        deleted_at: "2026-09-12",
                      },
                    ];
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return query;
      },
    };
    const result = await loadExpenseProjectSettings(
      db as unknown as SupabaseClient,
      "company",
      connectionId
    );
    expect(result).toEqual({
      projects: [
        { id: own, name: "Completed", archived: false },
        { id: archived, name: "Former", archived: true },
      ],
      projectMappings: [{ projectId: archived, externalProjectId: "old-job" }],
    });
    expect(
      reads
        .filter((r) => r.table === "expense_project_allocations")
        .map((r) => r.range)
    ).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(
      reads.every(
        (r) =>
          r.filters[
            r.table === "expense_project_allocations"
              ? "expenses.company_id"
              : "company_id"
          ] === "company"
      )
    ).toBe(true);
    expect(reads[0].filters.connection_id).toBe(connectionId);
    expect(reads.find((r) => r.table === "projects")?.filters.id).not.toContain(
      "legacy-invalid-id"
    );
  });
});
