import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ExpenseAccountingProviderService,
  type ExpenseProviderSession,
  type ExpenseQueueRow,
} from "@/lib/api/services/expense-accounting-provider-service";

const company = "11111111-1111-4111-8111-111111111111",
  expense = "22222222-2222-4222-8222-222222222222";
const event = "33333333-3333-4333-8333-333333333333",
  connection = "44444444-4444-4444-8444-444444444444";
const workerQueue = "55555555-5555-4555-8555-555555555555",
  user = "66666666-6666-4666-8666-666666666666",
  category = "77777777-7777-4777-8777-777777777777";
const config = {
  currency: "CAD",
  countryCode: "CA",
  liabilityAccountId: "40",
  reimbursementAccountId: "90",
  reimbursementPaymentMethod: "Cash",
  companyCardAccountId: "91",
  taxComponentAccounts: {},
};
type RecordRow = Record<string, unknown>;
function fixture() {
  const tables: Record<string, RecordRow[]> = {
    expense_accounting_events: [
      {
        id: event,
        company_id: company,
        expense_id: expense,
        kind: "accrual",
        original_event_id: null,
        source_snapshot: {
          id: expense,
          company_id: company,
          submitted_by: user,
          amount: "105.00",
          tax_amount: "0.00",
          currency: "CAD",
          expense_date: "2026-09-10",
          payment_method: "cash",
          category_id: category,
          description: "Fuel",
          merchant_name: "Station",
          recorded_at: "2026-09-12T10:00:00.000Z",
          allocations: [],
        },
      },
    ],
    expense_accounting_postings: [],
    expense_accounting_settings: [
      { company_id: company, connection_id: connection, configuration: config },
    ],
    expense_accounting_category_mappings: [
      {
        company_id: company,
        connection_id: connection,
        category_id: category,
        external_account_id: "60",
      },
    ],
    expense_accounting_payee_mappings: [
      {
        company_id: company,
        connection_id: connection,
        user_id: user,
        external_employee_id: "7",
      },
    ],
    expense_accounting_tax_mappings: [],
    supplier_bill_tax_mappings: [],
    supplier_bill_project_mappings: [],
    expense_accounting_project_mappings: [],
    projects: [],
  };
  const queries: { table: string; filters: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      queries.push({ table, filters });
      const rows = () =>
        (tables[table] ?? []).filter((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value)
        );
      const query = {
        select: (_columns: string) => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return query;
    },
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      const preparedEventId = (args.p_posting as RecordRow).eventId;
      const found = tables.expense_accounting_postings.find(
        (saved) => saved.event_id === preparedEventId
      );
      if (found) return { data: found, error: null };
      const frozen = {
        event_id: preparedEventId,
        company_id: company,
        expense_id: expense,
        connection_id: connection,
        queue_id: args.p_queue_id,
        provider: row.provider,
        payload: args.p_payload,
        posting: args.p_posting,
        created_at: "2026-09-12T10:00:00Z",
        external_id: null,
      };
      tables.expense_accounting_postings.push(frozen);
      return { data: frozen, error: null };
    }),
  };
  const row: ExpenseQueueRow = {
    id: workerQueue,
    companyId: company,
    connectionId: connection,
    entityId: expense,
    provider: "quickbooks",
    entityType: "expense",
    externalId: null,
    operation: "create",
    sourceTable: "expense_accounting_events",
    sourceAction: "insert",
    sourceUpdatedAt: null,
    idempotencyKey: `expense-event:${event}:${connection}`,
    status: "claimed",
    attempts: 1,
    maxAttempts: 5,
    runAfter: "2026-09-12T10:00:00Z",
    lockedAt: "2026-09-12T10:00:00Z",
    lockedBy: "worker",
    providerRequestId: null,
    providerAcceptedAt: null,
    idempotencyExpiresAt: null,
    lastError: null,
    createdAt: "2026-09-12T10:00:00Z",
    updatedAt: "2026-09-12T10:00:00Z",
    payloadSnapshot: {
      eventId: event,
      providerEnvironment: "sandbox",
      configurationSnapshot: config,
      categoryAccountSnapshot: "60",
      employeeIdSnapshot: "7",
    },
  };
  const fetchReference = vi.fn(
    async (entity: string, id?: string): Promise<RecordRow> => {
      if (entity === "Account")
        return {
          Id: id,
          Active: true,
          AccountType:
            id === "40"
              ? "Other Current Liability"
              : id === "91"
                ? "Credit Card"
                : id === "90"
                  ? "Bank"
                  : "Expense",
          CurrencyRef: { value: "CAD" },
        };
      if (entity === "Employee") return { Id: id, Active: true };
      if (entity === "CompanyInfo") return { Country: "CA" };
      if (entity === "Preferences")
        return {
          CurrencyPrefs: { HomeCurrency: { value: "CAD" } },
          TaxPrefs: { UsingSalesTax: true },
        };
      if (entity === "TaxCode")
        return {
          Active: true,
          PurchaseTaxRateList: {
            TaxRateDetail: [
              { TaxRateRef: { value: "5" }, TaxTypeApplicable: "TaxOnAmount" },
            ],
          },
        };
      if (entity === "TaxRate") return { Active: true, RateValue: 5 };
      if (entity === "Customer") return { Id: id, Active: true, Job: true };
      throw new Error(`Unexpected reference ${entity}`);
    }
  );
  const session: ExpenseProviderSession = {
    providerTargetId: "123",
    environment: "sandbox",
    quickbooks: { fetchReference, create: vi.fn() },
  };
  const service = new ExpenseAccountingProviderService(
    db as unknown as SupabaseClient,
    row,
    "worker"
  );
  return { service, tables, row, db, queries, session, fetchReference };
}
describe("frozen expense provider preparation", () => {
  it("scopes every mapping to company and connection and freezes a complete provider request", async () => {
    const { service, session, db, queries } = fixture();
    const result = await service.prepare(session);
    expect(result.payload).toMatchObject({
      resource: "JournalEntry",
      providerTargetId: "123",
      providerEnvironment: "sandbox",
      idempotencyId: workerQueue,
    });
    expect(db.rpc).toHaveBeenCalledWith(
      "prepare_expense_accounting_write",
      expect.objectContaining({
        p_queue_id: workerQueue,
        p_worker_id: "worker",
      })
    );
    expect(queries.every((query) => query.filters.company_id === company)).toBe(
      true
    );
  });
  it("replays the exact saved request after account and employee settings change", async () => {
    const { service, session, row, fetchReference } = fixture();
    const first = await service.prepare(session);
    row.payloadSnapshot.configurationSnapshot = {
      ...config,
      liabilityAccountId: "41",
    };
    row.payloadSnapshot.employeeIdSnapshot = "8";
    fetchReference.mockClear();
    expect(await service.prepare(session)).toEqual(first);
    expect(fetchReference).not.toHaveBeenCalled();
  });
  it("does not replay a saved request against a different provider company", async () => {
    const { service, session } = fixture();
    await service.prepare(session);
    await expect(
      service.prepare({ ...session, providerTargetId: "124" })
    ).rejects.toThrow(/saved expense posting/i);
  });
  it("rejects accounts payable for an employee reimbursement", async () => {
    const { service, session, fetchReference, db } = fixture();
    const original = fetchReference.getMockImplementation()!;
    fetchReference.mockImplementation(async (entity, id) =>
      entity === "Account" && id === "40"
        ? { Id: id, Active: true, AccountType: "Accounts Payable" }
        : original(entity, id)
    );
    await expect(service.prepare(session)).rejects.toThrow(/account type/i);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("does not silently use another tenant's category account", async () => {
    const { service, session, row, tables, db } = fixture();
    row.payloadSnapshot.categoryAccountSnapshot = null;
    tables.expense_accounting_category_mappings[0].company_id =
      "different-company";
    await expect(service.prepare(session)).rejects.toThrow(/category/i);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("does not drop an allocated project that lacks a provider mapping", async () => {
    const { service, session, tables } = fixture();
    const project = "88888888-8888-4888-8888-888888888888";
    (
      tables.expense_accounting_events[0].source_snapshot as RecordRow
    ).allocations = [{ project_id: project, amount: "105", percentage: "100" }];
    tables.projects.push({ id: project, company_id: company });
    tables.supplier_bill_project_mappings.push({
      company_id: company,
      connection_id: connection,
      provider: "quickbooks",
      project_id: project,
      external_project_id: "ap-job",
    });
    tables.expense_accounting_project_mappings.push({
      company_id: company,
      connection_id: connection,
      project_id: project,
      external_project_id: "later-job",
    });
    await expect(service.prepare(session)).rejects.toThrow(
      /allocated project/i
    );
  });
  it("posts the captured project despite changed expense and AP setup, then replays the frozen graph", async () => {
    const { service, session, tables, row, queries, fetchReference } =
      fixture();
    const project = "88888888-8888-4888-8888-888888888888";
    (
      tables.expense_accounting_events[0].source_snapshot as RecordRow
    ).allocations = [{ project_id: project, amount: "105", percentage: "100" }];
    tables.projects.push({ id: project, company_id: company });
    tables.expense_accounting_project_mappings.push({
      company_id: company,
      connection_id: connection,
      project_id: project,
      external_project_id: "changed",
    });
    tables.supplier_bill_project_mappings.push({
      company_id: company,
      connection_id: connection,
      provider: "quickbooks",
      project_id: project,
      external_project_id: "unrelated-ap",
    });
    row.payloadSnapshot.projectMappingsSnapshot = { [project]: "captured" };
    const prepared = await service.prepare(session);
    expect(fetchReference).toHaveBeenCalledWith("Customer", "captured");
    expect(
      prepared.posting.lines.some((line) => line.projectId === "captured")
    ).toBe(true);
    expect(
      queries.some((query) => query.table.endsWith("project_mappings"))
    ).toBe(false);
    row.payloadSnapshot.projectMappingsSnapshot = { [project]: "later-retry" };
    expect(await service.prepare(session)).toEqual(prepared);
  });
  it.each([false, null])(
    "rejects a mapped QBO reference that is not a proven active job (%s)",
    async (job) => {
      const { service, session, tables, row, fetchReference, db } = fixture();
      const project = "88888888-8888-4888-8888-888888888888";
      (
        tables.expense_accounting_events[0].source_snapshot as RecordRow
      ).allocations = [
        { project_id: project, amount: "105", percentage: "100" },
      ];
      tables.projects.push({ id: project, company_id: company });
      row.payloadSnapshot.projectMappingsSnapshot = { [project]: "captured" };
      const previous = fetchReference.getMockImplementation()!;
      fetchReference.mockImplementation(async (entity, id) =>
        entity === "Customer"
          ? { Id: id, Active: true, Job: job }
          : previous(entity, id)
      );
      await expect(service.prepare(session)).rejects.toThrow(
        /active customer job/i
      );
      expect(db.rpc).not.toHaveBeenCalled();
    }
  );
  it.each([
    { level: "TRANSACTION", areas: ["JOURNALS"], succeeds: true },
    { level: "GROUP", areas: ["JOURNALS"], succeeds: false },
    { level: "TRANSACTION", areas: ["EXPENSES"], succeeds: false },
    { level: null, areas: ["JOURNALS"], succeeds: false },
  ])(
    "validates native Sage project eligibility before freezing $level / $areas",
    async ({ level, areas, succeeds }) => {
      const { service, tables, row, db } = fixture();
      const project = "88888888-8888-4888-8888-888888888888";
      row.provider = "sage";
      row.payloadSnapshot.configurationSnapshot = {
        ...config,
        reimbursementPaymentMethod: "BANK_TRANSFER",
      };
      (
        tables.expense_accounting_events[0].source_snapshot as RecordRow
      ).allocations = [
        { project_id: project, amount: "105", percentage: "100" },
      ];
      tables.projects.push({ id: project, company_id: company });
      row.payloadSnapshot.projectMappingsSnapshot = {
        [project]: "sage-category",
      };
      const get = vi.fn(async (resource: string, id: string) => {
        if (resource === "analysis_type_categories")
          return { id, analysis_type: { id: "sage-type" } };
        if (resource === "analysis_types")
          return {
            id,
            active_areas: areas,
            analysis_type_level: { identifier: level },
          };
        if (resource === "ledger_accounts")
          return {
            id,
            visible_in_journals: true,
            visible_in_other_payments: true,
            is_control_account: false,
          };
        throw new Error(`Unexpected Sage reference ${resource}`);
      });
      const session = {
        providerTargetId: "sage-business",
        environment: "sandbox",
        sage: { get },
      } as unknown as ExpenseProviderSession;
      if (succeeds) {
        const prepared = await service.prepare(session);
        expect(
          prepared.posting.lines.some(
            (line) => line.analysisCategoryId === "sage-category"
          )
        ).toBe(true);
        expect(prepared.payload.resource).toBe("journals");
      } else {
        await expect(service.prepare(session)).rejects.toThrow(
          /transaction analysis category enabled for journals/i
        );
        expect(db.rpc).not.toHaveBeenCalled();
      }
      expect(get).toHaveBeenCalledWith("analysis_types", "sage-type", {
        attributes: "all",
      });
      expect(get).toHaveBeenCalledWith(
        "analysis_type_categories",
        "sage-category",
        { attributes: "all" }
      );
    }
  );
  it("requests complete native Sage tax, ledger, bank and payment details through accrual and settlement", async () => {
    const { service, tables, row } = fixture();
    row.provider = "sage";
    row.payloadSnapshot.configurationSnapshot = {
      ...config,
      reimbursementPaymentMethod: "BANK_TRANSFER",
      taxComponentAccounts: {
        gst: { accountId: "tax-ledger", recoverable: true },
      },
    };
    (
      tables.expense_accounting_events[0].source_snapshot as RecordRow
    ).tax_amount = "5.00";
    tables.expense_accounting_tax_mappings.push({
      company_id: company,
      connection_id: connection,
      provider: "sage",
      tax_rate: 5,
      external_tax_code_id: "gst",
    });
    const get = vi.fn(
      async (
        resource: string,
        id: string,
        options?: { attributes?: string }
      ) => {
        // The provider's default sparse shape is deliberately insufficient for validation.
        if (options?.attributes !== "all") return { id };
        if (resource === "tax_rates")
          return { id, percentage: 5, is_visible: true };
        if (resource === "ledger_accounts")
          return {
            id,
            visible_in_journals: true,
            visible_in_other_payments: true,
            is_control_account: id === "tax-ledger",
            control_name: id === "tax-ledger" ? "GST_INPUT" : null,
          };
        if (resource === "bank_accounts")
          return {
            id,
            is_active: true,
            currency: { id: "CAD" },
            ledger_account: { id: "bank-ledger" },
          };
        if (resource === "payment_methods") return { id };
        throw new Error(`Unexpected Sage reference ${resource}`);
      }
    );
    const session = {
      providerTargetId: "sage-business",
      environment: "sandbox",
      sage: { get },
    } as unknown as ExpenseProviderSession;
    const accrued = await service.prepare(session);
    expect(accrued.posting.lines.some((line) => line.includeOnTaxReturn)).toBe(
      true
    );
    tables.expense_accounting_postings[0].external_id = "posted-accrual";
    const settlementId = "99999999-9999-4999-8999-999999999999";
    tables.expense_accounting_events.push({
      ...tables.expense_accounting_events[0],
      id: settlementId,
      kind: "settlement",
      original_event_id: event,
    });
    row.payloadSnapshot.eventId = settlementId;
    row.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const settled = await service.prepare(session);
    expect(settled.payload.resource).toBe("other_payments");
    expect(new Set(get.mock.calls.map(([resource]) => resource))).toEqual(
      new Set([
        "tax_rates",
        "ledger_accounts",
        "bank_accounts",
        "payment_methods",
      ])
    );
    expect(
      get.mock.calls.every(([, , options]) => options?.attributes === "all")
    ).toBe(true);
  });
  it("uses expense tax mappings independently from supplier bills", async () => {
    const { service, session, tables, queries } = fixture();
    (
      tables.expense_accounting_events[0].source_snapshot as RecordRow
    ).tax_amount = "5.00";
    tables.expense_accounting_tax_mappings.push({
      company_id: company,
      connection_id: connection,
      provider: "quickbooks",
      tax_rate: 5,
      external_tax_code_id: "19",
    });
    tables.supplier_bill_tax_mappings.push({
      company_id: company,
      connection_id: connection,
      provider: "quickbooks",
      tax_rate: 5,
      external_tax_code_id: "20",
    });
    const result = await service.prepare(session);
    expect(result.posting.lines[0].nativeTax).toEqual({
      codeId: "19",
      cents: 500,
    });
    expect(
      queries.some((query) => query.table === "supplier_bill_tax_mappings")
    ).toBe(false);
  });
  it("cannot reuse an AP tax ID after expense setup is cleared on relink", async () => {
    const { service, session, tables, queries, db } = fixture();
    (
      tables.expense_accounting_events[0].source_snapshot as RecordRow
    ).tax_amount = "5.00";
    tables.supplier_bill_tax_mappings.push({
      company_id: company,
      connection_id: connection,
      provider: "quickbooks",
      tax_rate: 5,
      external_tax_code_id: "old-books-tax-id",
    });
    await expect(service.prepare(session)).rejects.toThrow(/tax mapping/i);
    expect(
      queries.some((query) => query.table === "supplier_bill_tax_mappings")
    ).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
