// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  db: { rpc: vi.fn(), from: vi.fn() },
  saved: vi.fn(),
  eq: vi.fn(),
  connection: vi.fn(),
  catalogue: vi.fn(),
  validate: vi.fn(),
  projectSettings: vi.fn(),
}));
vi.mock("@/lib/accounting/supplier-bills/route-auth", () => ({
  resolveSupplierBillActor: mocks.actor,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => mocks.db,
}));
vi.mock(
  "@/lib/accounting/expenses/configuration-service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/accounting/expenses/configuration-service")
    >()),
    expenseAccountingConnection: mocks.connection,
    loadExpenseCatalogue: mocks.catalogue,
    loadExpenseProjectSettings: mocks.projectSettings,
    validateExpenseSettingsSelection: mocks.validate,
  })
);
import {
  GET,
  POST,
} from "@/app/api/integrations/accounting/expense-settings/route";
const connectionId = "0db4e6af-3b62-41d5-9a86-d7569c57c1e8";
const payload = {
  connectionId,
  catalogueBinding: `quickbooks:sandbox:${"a".repeat(64)}`,
  configuration: {
    currency: "CAD",
    countryCode: "CA",
    liabilityAccountId: null,
    reimbursementAccountId: null,
    reimbursementPaymentMethod: null,
    companyCardAccountId: null,
    taxComponentAccounts: {},
  },
  categoryMappings: [],
  payeeMappings: [],
};
const request = (body: unknown = payload) =>
  new NextRequest(
    "https://example.test/api/integrations/accounting/expense-settings",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { authorization: "Bearer original-jwt" },
    }
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({
    actorUserId: "verified-actor",
    companyId: "verified-company",
  });
  mocks.connection.mockResolvedValue({
    id: connectionId,
    provider: "quickbooks",
    provider_environment: "sandbox",
    realm_id_lookup: "a".repeat(64),
  });
  mocks.catalogue.mockResolvedValue({ accounts: [] });
  mocks.projectSettings.mockResolvedValue({
    projects: [],
    projectMappings: [],
  });
  mocks.validate.mockReturnValue(undefined);
  mocks.db.rpc.mockResolvedValue({ error: null });
  mocks.saved.mockResolvedValue({ data: [], error: null });
  const query = {
    select: vi.fn(() => query),
    eq: mocks.eq,
    then: (resolve: (value: unknown) => unknown) => mocks.saved().then(resolve),
  };
  mocks.eq.mockReturnValue(query);
  mocks.db.from.mockReturnValue(query);
});
describe("expense settings API authority", () => {
  it("passes optional expense project replacement only through the identity-bound transaction", async () => {
    const projectMappings = [
      { projectId: connectionId, externalProjectId: "job-1" },
    ];
    expect((await POST(request({ ...payload, projectMappings }))).status).toBe(
      200
    );
    expect(mocks.db.rpc).toHaveBeenLastCalledWith(
      "save_expense_accounting_settings",
      expect.objectContaining({
        p_project_mappings: projectMappings,
        p_expected_identity: "a".repeat(64),
      })
    );
    expect(
      (await POST(request({ ...payload, projectMappings: [] }))).status
    ).toBe(200);
    expect(mocks.db.rpc).toHaveBeenLastCalledWith(
      "save_expense_accounting_settings",
      expect.objectContaining({ p_project_mappings: [] })
    );
  });

  it("rejects a settings screen loaded for the previous provider company", async () => {
    mocks.connection.mockResolvedValue({
      id: connectionId,
      provider: "quickbooks",
      provider_environment: "sandbox",
      realm_id_lookup: "b".repeat(64),
    });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.catalogue).not.toHaveBeenCalled();
    expect(mocks.db.rpc).not.toHaveBeenCalled();
  });
  it("returns named archived crew and only mapped inactive provider names", async () => {
    const tables: Record<string, unknown> = {
      expense_accounting_settings: { configuration: payload.configuration },
      expense_categories: [],
      users: [
        {
          id: "active",
          first_name: "Active",
          last_name: "Crew",
          email: null,
          is_active: true,
          deleted_at: null,
        },
        {
          id: "archived",
          first_name: "Former",
          last_name: "Crew",
          email: null,
          is_active: false,
          deleted_at: "2026-09-12",
        },
        {
          id: "unmapped-archived",
          first_name: "Unmapped",
          last_name: "Person",
          is_active: false,
          deleted_at: "2026-09-12",
        },
      ],
      expense_accounting_category_mappings: [],
      expense_accounting_tax_mappings: [],
      expense_accounting_payee_mappings: [
        { user_id: "archived", external_employee_id: "inactive" },
      ],
    };
    const reads: { table: string; filters: Record<string, unknown> }[] = [];
    mocks.db.from.mockImplementation((table: string) => {
      const read = { table, filters: {} as Record<string, unknown> };
      reads.push(read);
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          read.filters[key] = value;
          return query;
        },
        order: () => query,
        maybeSingle: () => query,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: tables[table], error: null }).then(resolve),
      };
      return query;
    });
    mocks.catalogue.mockResolvedValue({
      accounts: [],
      employees: [{ id: "new", name: "Active employee" }],
      preservedEmployees: [
        { id: "inactive", name: "Former employee" },
        { id: "unmapped", name: "Unrelated inactive employee" },
      ],
    });
    mocks.projectSettings.mockResolvedValue({
      projects: [{ id: connectionId, name: "Completed roof", archived: false }],
      projectMappings: [
        { projectId: connectionId, externalProjectId: "old-job" },
      ],
    });
    mocks.catalogue.mockResolvedValue({
      ...(await mocks.catalogue()),
      accountingProjects: [{ id: "new-job", name: "Customer:New job" }],
      preservedProjects: [
        { id: "old-job", name: "Customer:Former job" },
        { id: "unmapped", name: "Other job" },
      ],
    });
    const result = await GET(
      new NextRequest(
        `https://example.test/api/integrations/accounting/expense-settings?connectionId=${connectionId}`
      )
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.catalogueBinding).toBe(payload.catalogueBinding);
    expect(mocks.projectSettings).toHaveBeenCalledWith(
      mocks.db,
      "verified-company",
      connectionId
    );
    expect(body.projects).toEqual([
      { id: connectionId, name: "Completed roof", archived: false },
    ]);
    expect(body.projectMappings).toEqual([
      { projectId: connectionId, externalProjectId: "old-job" },
    ]);
    expect(body.preservedProjects).toEqual([
      { id: "old-job", name: "Customer:Former job" },
    ]);
    expect(body.crew).toEqual([
      { id: "active", name: "Active Crew", archived: false },
      { id: "archived", name: "Former Crew", archived: true },
    ]);
    expect(body.employees).toEqual([{ id: "new", name: "Active employee" }]);
    expect(body.preservedEmployees).toEqual([
      { id: "inactive", name: "Former employee" },
    ]);
    expect(
      reads.every((read) => read.filters.company_id === "verified-company")
    ).toBe(true);
    expect(
      reads
        .filter((read) => read.table.startsWith("expense_accounting_"))
        .every((read) => read.filters.connection_id === connectionId)
    ).toBe(true);
  });
  it("derives actor/company from authentication and commits only through the guarded RPC", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.actor).toHaveBeenCalledWith(expect.anything(), [
      "accounting.manage_connections",
      "expenses.approve",
    ]);
    expect(mocks.connection).toHaveBeenCalledWith(
      mocks.db,
      "verified-company",
      connectionId
    );
    expect(mocks.db.rpc).toHaveBeenCalledWith(
      "save_expense_accounting_settings",
      {
        p_actor_user_id: "verified-actor",
        p_connection_id: connectionId,
        p_configuration: payload.configuration,
        p_category_mappings: [],
        p_payee_mappings: [],
        p_tax_mappings: null,
        p_project_mappings: null,
        p_expected_provider: "quickbooks",
        p_expected_environment: "sandbox",
        p_expected_identity: "a".repeat(64),
      }
    );
  });
  it("cannot supply another actor or company in the body", async () => {
    expect(
      (await POST(request({ ...payload, actorUserId: "other" }))).status
    ).toBe(400);
    expect(mocks.db.rpc).not.toHaveBeenCalled();
  });
  it("rejects denied authority before any account or provider reads", async () => {
    mocks.actor.mockResolvedValue(
      NextResponse.json({ error: "Denied" }, { status: 403 })
    );
    expect((await POST(request())).status).toBe(403);
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.catalogue).not.toHaveBeenCalled();
  });
  it("does not save if named provider account validation fails", async () => {
    mocks.validate.mockImplementation(() => {
      throw new Error("Choose a valid account.");
    });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.db.rpc).not.toHaveBeenCalled();
  });
  it("propagates atomic authority failure without reporting success", async () => {
    mocks.db.rpc.mockResolvedValue({
      error: { code: "42501", message: "private detail" },
    });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private detail");
  });
  it("keeps provider lookup failure separate from a saved setting", async () => {
    mocks.catalogue.mockRejectedValue(new Error("OAuth secret"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("OAuth secret");
    expect(mocks.db.rpc).not.toHaveBeenCalled();
  });
  it("loads preserved payees only from the authenticated company and exact connection", async () => {
    mocks.saved.mockResolvedValue({
      data: [
        { user_id: "saved-user", external_employee_id: "inactive-employee" },
      ],
      error: null,
    });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.db.from).toHaveBeenCalledWith(
      "expense_accounting_payee_mappings"
    );
    expect(mocks.eq).toHaveBeenCalledWith("company_id", "verified-company");
    expect(mocks.eq).toHaveBeenCalledWith("connection_id", connectionId);
    expect(mocks.validate).toHaveBeenCalledWith(
      expect.anything(),
      "quickbooks",
      expect.anything(),
      [{ userId: "saved-user", externalEmployeeId: "inactive-employee" }],
      expect.any(Array)
    );
  });
  it("does not save when the preserved mapping lookup fails", async () => {
    mocks.saved.mockResolvedValue({
      data: null,
      error: { message: "private database details" },
    });
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private database details");
    expect(mocks.db.rpc).not.toHaveBeenCalled();
  });
  it("does not accept a caller-supplied preservation allowlist", async () => {
    expect(
      (
        await POST(
          request({
            ...payload,
            preservedPayees: [
              { userId: connectionId, externalEmployeeId: "inactive" },
            ],
          })
        )
      ).status
    ).toBe(400);
    expect(mocks.db.rpc).not.toHaveBeenCalled();
    expect(mocks.db.from).not.toHaveBeenCalled();
  });
  it("allows an unchanged unavailable provider employee but rejects reassignment", async () => {
    const { validateExpenseSettingsSelection } = await vi.importActual<
      typeof import("@/lib/accounting/expenses/configuration-service")
    >("@/lib/accounting/expenses/configuration-service");
    mocks.validate.mockImplementation(validateExpenseSettingsSelection);
    mocks.catalogue.mockResolvedValue({
      accounts: [],
      employees: [],
      paymentMethods: [],
      taxRates: [],
      taxComponents: [],
    });
    mocks.saved.mockResolvedValue({
      data: [{ user_id: connectionId, external_employee_id: "inactive" }],
      error: null,
    });
    expect(
      (
        await POST(
          request({
            ...payload,
            payeeMappings: [
              { userId: connectionId, externalEmployeeId: "inactive" },
            ],
          })
        )
      ).status
    ).toBe(200);
    mocks.db.rpc.mockClear();
    expect(
      (
        await POST(
          request({
            ...payload,
            payeeMappings: [
              {
                userId: "17300a4e-45d0-4770-9f75-fbb0ca62bb54",
                externalEmployeeId: "inactive",
              },
            ],
          })
        )
      ).status
    ).toBe(400);
    expect(mocks.db.rpc).not.toHaveBeenCalled();
  });
});
