import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExpenseAccountingSettings } from "@/components/settings/expense-accounting-settings";
import en from "@/i18n/dictionaries/en/settings.json";
import es from "@/i18n/dictionaries/es/settings.json";
import { toast } from "@/components/ui/toast";

const state = vi.hoisted(() => ({ permissions: new Set<string>(), locale: "en" }));
const getIdToken = vi.hoisted(() => vi.fn().mockResolvedValue("test-token"));
vi.mock("@/lib/firebase/auth", () => ({ getIdToken }));
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (selector: (s: { can: (p: string) => boolean }) => unknown) =>
    selector({ can: (p) => state.permissions.has(p) }),
}));
vi.mock("@/i18n/client", () => ({ useLocale: () => ({ locale: state.locale }), useDictionary: () => ({
  t: (key: string) => (state.locale === "en" ? en : es)[key as keyof typeof en] ?? key,
}) }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn() } }));

const configuration = {
  countryCode: "CA", currency: "CAD", liabilityAccountId: "liability-1",
  reimbursementAccountId: "bank-1", reimbursementPaymentMethod: "Cash",
  companyCardAccountId: "card-1", taxComponentAccounts: {},
};

function payload(overrides = {}) {
  return {
    connectionId: "connection-1", catalogueBinding: "current-books-binding", provider: "quickbooks", configuration,
    recommendedCountryCode: "CA", recommendedCurrency: "CAD",
    categoryMappings: [{ categoryId: "category-1", externalAccountId: "expense-1" }],
    payeeMappings: [{ userId: "crew-1", externalEmployeeId: "employee-1" }],
    categories: [{ id: "category-1", name: "Materials" }],
    crew: [{ id: "crew-1", name: "Alex Crew" }],
    accounts: [
      { id: "liability-1", name: "Crew reimbursements owed", kind: "liability" },
      { id: "bank-1", name: "Operating chequing", kind: "bank" },
      { id: "bank-2", name: "Payroll chequing", kind: "bank" },
      { id: "card-1", name: "Company Visa", kind: "credit_card" },
      { id: "expense-1", name: "Job materials", kind: "expense" },
      { id: "tax-1", name: "GST receivable", kind: "other", nativeType: "Other Current Asset" },
    ],
    employees: [{ id: "employee-1", name: "Alex Crew (Books)" }],
    paymentMethods: [{ id: "Cash", name: "Cash" }, { id: "Check", name: "Cheque" }],
    taxComponents: [{ id: "gst", name: "GST" }],
    taxRates: [{ id: "gst-code", name: "GST purchases", percentage: 5, components: [{ id: "gst", name: "GST", percentage: 5 }] }],
    taxMappings: [],
    ...overrides,
  };
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ExpenseAccountingSettings companyId="company-1" connectionId="connection-1" /></QueryClientProvider>);
}

async function expand() {
  fireEvent.click(screen.getByRole("button", { name: state.locale === "en" ? "Expense accounts" : "Cuentas de gastos" }));
  await screen.findByLabelText(state.locale === "en" ? "Country" : "País");
}

beforeEach(() => {
  state.permissions = new Set(["accounting.manage_connections", "expenses.approve"]);
  state.locale = "en";
  vi.mocked(toast.success).mockClear();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(respond(payload()))));
});

describe("expense accounting settings", () => {
  it.each(["accounting.manage_connections", "expenses.approve"])("requires %s before showing or fetching setup", (permission) => {
    state.permissions.delete(permission);
    mount();
    expect(screen.queryByRole("button", { name: "Expense accounts" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches only after expansion, using the exact connection and signed-in token", async () => {
    mount();
    expect(fetch).not.toHaveBeenCalled();
    await expand();
    expect(fetch).toHaveBeenCalledWith("/api/integrations/accounting/expense-settings?connectionId=connection-1", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
    expect(screen.getByLabelText("Reimbursement bank account")).toHaveValue("bank-1");
    expect(screen.getByRole("option", { name: "Operating chequing" })).toBeInTheDocument();
    expect(screen.queryByText("bank-1")).toBeNull();
  });

  it("uses provider locale recommendations without inventing default accounts", async () => {
    vi.mocked(fetch).mockResolvedValue(respond(payload({ configuration: null, categoryMappings: [], payeeMappings: [] })));
    mount();
    await expand();
    expect(screen.getByLabelText("Country")).toHaveValue("CA");
    expect(screen.getByLabelText("Currency")).toHaveValue("CAD");
    expect(screen.getByLabelText("Crew reimbursement liability account")).toHaveValue("");
    expect(screen.getByLabelText("Reimbursement bank account")).toHaveValue("");
    expect(screen.getByLabelText("Company card account")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save expense accounts" })).toBeEnabled();
  });

  it("saves selected references and waits for canonical readback", async () => {
    let releaseReadback: (response: Response) => void = () => undefined;
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload()))
      .mockResolvedValueOnce(respond({ success: true }))
      .mockImplementationOnce(() => new Promise((resolve) => { releaseReadback = resolve; }));
    mount();
    await expand();
    fireEvent.change(screen.getByLabelText("Reimbursement bank account"), { target: { value: "bank-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const [, request] = vi.mocked(fetch).mock.calls[1];
    expect(JSON.parse(request!.body as string)).toEqual({
      connectionId: "connection-1", catalogueBinding: "current-books-binding", configuration: { ...configuration, reimbursementAccountId: "bank-2" },
      categoryMappings: payload().categoryMappings, payeeMappings: payload().payeeMappings, taxMappings: [],
    });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    releaseReadback(respond(payload({ configuration: { ...configuration, reimbursementAccountId: "bank-2" } })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save expense accounts" })).toBeDisabled());
  });

  it("keeps selections after a failed save and offers a retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload())).mockResolvedValueOnce(respond({ error: "internal account bank-2 failed" }, 500));
    mount();
    await expand();
    fireEvent.change(screen.getByLabelText("Reimbursement bank account"), { target: { value: "bank-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Expense account changes couldn’t be confirmed. Try again.");
    expect(screen.getByLabelText("Reimbursement bank account")).toHaveValue("bank-2");
    expect(screen.getByRole("button", { name: "Save expense accounts" })).toBeEnabled();
    expect(screen.queryByText("internal account bank-2 failed")).toBeNull();
  });

  it("loads bilingual labels from the settings dictionary", async () => {
    state.locale = "es";
    mount();
    await expand();
    expect(screen.getByLabelText("Cuenta bancaria para reembolsos")).toHaveValue("bank-1");
    expect(screen.getByRole("button", { name: "Guardar cuentas de gastos" })).toBeInTheDocument();
    expect(screen.queryByText(/accounting\.expenses\./)).toBeNull();
  });

  it("allows crew-only setup and sends unused accounts as null", async () => {
    const partial = { ...configuration, companyCardAccountId: null };
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({ configuration: null, categoryMappings: [], payeeMappings: [] })))
      .mockResolvedValueOnce(respond({ success: true })).mockResolvedValueOnce(respond(payload({ configuration: partial })));
    mount();
    await expand();
    fireEvent.change(screen.getByLabelText("Crew reimbursement liability account"), { target: { value: "liability-1" } });
    fireEvent.change(screen.getByLabelText("Reimbursement bank account"), { target: { value: "bank-1" } });
    fireEvent.change(screen.getByLabelText("Reimbursement payment method"), { target: { value: "Cash" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({ configuration: partial });
  });

  it("does not invent a country or currency when the provider gives none", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({ configuration: null, recommendedCountryCode: null, recommendedCurrency: null })));
    mount();
    await expand();
    expect(screen.getByLabelText("Country")).toHaveValue("");
    expect(screen.getByLabelText("Currency")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save expense accounts" })).toBeDisabled();
  });

  it("offers Sage journal ledgers by name and uses bank resources separately", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({ provider: "sage", configuration: null, accounts: [
      { id: "ledger-1", name: "Staff expenses payable", kind: "other", visibleInJournals: true, visibleInOtherPayments: true, isControlAccount: false },
      { id: "ledger-hidden", name: "Unavailable ledger", kind: "other", visibleInJournals: false },
      { id: "control-1", name: "Debtors control", kind: "other", visibleInJournals: true, isControlAccount: true },
      { id: "bank-resource", name: "Business bank", kind: "bank" },
    ] })));
    mount();
    await expand();
    const liability = screen.getByLabelText("Crew reimbursement liability account");
    expect(within(liability).getByRole("option", { name: "Staff expenses payable" })).toBeInTheDocument();
    expect(within(liability).queryByRole("option", { name: "Business bank" })).toBeNull();
    expect(within(liability).queryByRole("option", { name: "Debtors control" })).toBeNull();
    expect(within(liability).queryByRole("option", { name: "Unavailable ledger" })).toBeNull();
    expect(within(screen.getByLabelText("Company card account")).getByRole("option", { name: "Staff expenses payable" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Reimbursement bank account")).getByRole("option", { name: "Business bank" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Country")).queryByRole("option", { name: "United States" })).toBeNull();
  });

  it("maps receipt tax rates by name and requires an explicit recovery choice", async () => {
    mount();
    await expand();
    fireEvent.click(screen.getByText("Receipt taxes"));
    fireEvent.change(screen.getByLabelText("5%"), { target: { value: "gst-code" } });
    fireEvent.change(screen.getByLabelText("GST"), { target: { value: "tax-1" } });
    expect(screen.getByLabelText("Tax treatment")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save expense accounts" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Tax treatment"), { target: { value: "recoverable" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({
      configuration: { taxComponentAccounts: { gst: { accountId: "tax-1", recoverable: true } } },
      taxMappings: [{ taxRate: 5, externalTaxCodeId: "gst-code" }],
    });
  });

  it("includes Sage input-tax control accounts for recoverable tax", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({ provider: "sage", configuration: null, accounts: [
      { id: "gst-input", name: "GST paid control", kind: "tax", visibleInJournals: true, isControlAccount: true, controlName: "GST" },
    ] })));
    mount();
    await expand();
    fireEvent.click(screen.getByText("Receipt taxes"));
    fireEvent.change(screen.getByLabelText("5%"), { target: { value: "gst-code" } });
    expect(within(screen.getByLabelText("GST")).getByRole("option", { name: "GST paid control" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Crew reimbursement liability account")).queryByRole("option", { name: "GST paid control" })).toBeNull();
  });

  it("preserves mappings for archived rows when editing one current account", async () => {
    const categoryMappings = [...payload().categoryMappings, { categoryId: "archived-category", externalAccountId: "old-expense" }];
    const payeeMappings = [...payload().payeeMappings, { userId: "former-crew", externalEmployeeId: "former-employee" }];
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({ categoryMappings, payeeMappings })));
    mount();
    await expand();
    fireEvent.change(screen.getByLabelText("Reimbursement bank account"), { target: { value: "bank-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({ categoryMappings, payeeMappings });
  });

  it("lets an archived crew mapping be removed when no provider employees are active", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({
      crew: [{ id: "crew-1", name: "Alex Crew", archived: true }], employees: [],
      preservedEmployees: [{ id: "employee-1", name: "Alex Crew (Books)" }],
    })));
    mount(); await expand(); fireEvent.click(screen.getByText("Crew members"));
    const crew = screen.getByLabelText("Alex Crew · Archived");
    expect(within(crew).getByRole("option", { name: "Alex Crew (Books)" })).toBeDisabled();
    fireEvent.change(crew, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).payeeMappings).toEqual([]);
  });

  it("offers QuickBooks expense and asset category accounts without unrelated other types", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({ accounts: [...payload().accounts,
      { id: "asset", name: "Equipment asset", kind: "other", nativeType: "Fixed Asset" },
      { id: "income", name: "Sales income", kind: "other", nativeType: "Income" },
    ] })));
    mount(); await expand(); fireEvent.click(screen.getByText("Expense categories"));
    expect(within(screen.getByLabelText("Materials")).getByRole("option", { name: "Equipment asset" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Materials")).queryByRole("option", { name: "Sales income" })).toBeNull();
  });

  it("excludes Sage expense ledgers with partial or unknown journal eligibility", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({ provider: "sage", configuration: null, accounts: [
      { id: "valid", name: "Full recovery", kind: "other", visibleInJournals: true, taxRecoverable: true, recoverablePercentage: 100 },
      { id: "partial", name: "Partial recovery", kind: "other", visibleInJournals: true, taxRecoverable: true, recoverablePercentage: 50 },
      { id: "unknown", name: "Unknown visibility", kind: "other" },
    ] })));
    mount(); await expand(); fireEvent.click(screen.getByText("Expense categories"));
    const category = screen.getByLabelText("Materials");
    expect(within(category).getByRole("option", { name: "Full recovery" })).toBeInTheDocument();
    expect(within(category).queryByRole("option", { name: "Partial recovery" })).toBeNull();
    expect(within(category).queryByRole("option", { name: "Unknown visibility" })).toBeNull();
  });

  it("omits project controls and preserves older servers when no expense projects are supplied", async () => {
    mount(); await expand();
    expect(screen.queryByText("Project allocations")).toBeNull();
    fireEvent.change(screen.getByLabelText("Reimbursement bank account"), { target: { value: "bank-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).not.toHaveProperty("projectMappings");
  });

  it.each(["quickbooks", "sage"])("shows only expense-relevant projects and saves named %s mappings", async (provider) => {
    const projects = [{ id: "project-1", name: "Cedar retrofit" }];
    const accountingProjects = [{ id: "native-project-1", name: provider === "quickbooks" ? "Cedar customer job" : "Cedar analysis category" }];
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({ provider, configuration: provider === "sage" ? null : configuration,
      projectMappings: [{ projectId: "existing-project", externalProjectId: "existing-native" }], projects, accountingProjects,
    })));
    mount(); await expand(); fireEvent.click(screen.getByText("Project allocations"));
    expect(screen.queryByText("native-project-1")).toBeNull();
    fireEvent.change(screen.getByLabelText("Cedar retrofit"), { target: { value: "native-project-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).projectMappings).toEqual([
      { projectId: "existing-project", externalProjectId: "existing-native" }, { projectId: "project-1", externalProjectId: "native-project-1" },
    ]);
  });

  it("lets a removed project mapping be cleared without assigning it to another accounting project", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({
      projects: [{ id: "project-1", name: "Old workshop", archived: true }],
      projectMappings: [{ projectId: "project-1", externalProjectId: "native-old" }],
      accountingProjects: [{ id: "native-active", name: "Current job" }], preservedProjects: [{ id: "native-old", name: "Old workshop job" }],
    })));
    mount(); await expand(); fireEvent.click(screen.getByText("Project allocations"));
    const project = screen.getByLabelText("Old workshop · Archived");
    expect(within(project).getByRole("option", { name: "Old workshop job" })).toBeDisabled();
    expect(within(project).queryByRole("option", { name: "Current job" })).toBeNull();
    fireEvent.change(project, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).projectMappings).toEqual([]);
  });

  it("retains an unsaved edit while the subsection is collapsed", async () => {
    mount();
    await expand();
    fireEvent.change(screen.getByLabelText("Reimbursement bank account"), { target: { value: "bank-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Expense accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Expense accounts" }));
    expect(screen.getByLabelText("Reimbursement bank account")).toHaveValue("bank-2");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate saves while a request is pending", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload())).mockImplementationOnce(() => new Promise(() => undefined));
    mount();
    await expand();
    fireEvent.change(screen.getByLabelText("Reimbursement bank account"), { target: { value: "bank-2" } });
    const button = screen.getByRole("button", { name: "Save expense accounts" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Reimbursement bank account")).toBeDisabled();
  });

  it("does not claim success when post-save readback fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload())).mockResolvedValueOnce(respond({ success: true })).mockResolvedValueOnce(respond({}, 500));
    mount();
    await expand();
    fireEvent.change(screen.getByLabelText("Reimbursement bank account"), { target: { value: "bank-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    await screen.findByRole("alert");
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Reimbursement bank account")).toHaveValue("bank-2");
  });

  it("rejects setup returned for a different connection and lets the operator retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({ connectionId: "another-company-connection" }))).mockResolvedValueOnce(respond(payload()));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Expense accounts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Expense accounts couldn’t load. Try again.");
    expect(screen.queryByLabelText("Country")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByLabelText("Country");
  });

  it("blocks a stale relinked form until the operator reloads the bound catalogue", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload()))
      .mockResolvedValueOnce(respond({ error: "private binding mismatch" }, 409))
      .mockResolvedValueOnce(respond(payload({ catalogueBinding: "new-books-binding" })));
    mount(); await expand();
    fireEvent.change(screen.getByLabelText("Reimbursement bank account"), { target: { value: "bank-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The accounting connection changed. Reload accounts before saving.");
    expect(screen.getByRole("button", { name: "Save expense accounts" })).toBeDisabled();
    expect(screen.getByLabelText("Reimbursement bank account")).toHaveValue("bank-2");
    fireEvent.click(screen.getByRole("button", { name: "Reload accounts" }));
    await waitFor(() => expect(screen.getByLabelText("Reimbursement bank account")).toHaveValue("bank-1"));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText("Reimbursement bank account"), { target: { value: "bank-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense accounts" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[3][1]!.body as string).catalogueBinding).toBe("new-books-binding");
  });

  it("requires a server catalogue binding before showing editable mappings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(payload({ catalogueBinding: undefined })));
    mount(); fireEvent.click(screen.getByRole("button", { name: "Expense accounts" }));
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Country")).toBeNull();
  });
});
