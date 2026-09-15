import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AccountingTokenService } from "@/lib/api/services/accounting-token-service";
import { createSageReadClient } from "@/lib/api/services/sage-api-client";
import { decryptToken } from "@/lib/api/services/token-cipher";
import { sageExpenseProjectEligible } from "./project-mappings";
import { expenseAccountingConfigurationSchema } from "./provider-mappers";

type Row = Record<string, unknown>;
const object = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const number = (v: unknown): number =>
  typeof v === "number" || (typeof v === "string" && v.trim())
    ? Number(v)
    : NaN;
const reference = z.string().trim().min(1).max(255);
export const expenseSettingsRequestSchema = z
  .object({
    connectionId: z.string().uuid(),
    catalogueBinding: reference,
    configuration: expenseAccountingConfigurationSchema,
    categoryMappings: z
      .array(
        z
          .object({
            categoryId: z.string().uuid(),
            externalAccountId: reference,
          })
          .strict()
      )
      .max(500),
    payeeMappings: z
      .array(
        z
          .object({ userId: z.string().uuid(), externalEmployeeId: reference })
          .strict()
      )
      .max(1000),
    projectMappings: z
      .array(
        z
          .object({
            projectId: z.string().uuid(),
            externalProjectId: reference,
          })
          .strict()
      )
      .max(1000)
      .optional(),
    taxMappings: z
      .array(
        z
          .object({
            taxRate: z.number().min(0).max(100),
            externalTaxCodeId: reference,
          })
          .strict()
      )
      .max(100)
      .optional(),
  })
  .strict();
export interface AccountChoice {
  id: string;
  name: string;
  kind: "expense" | "liability" | "bank" | "credit_card" | "tax" | "other";
  nativeType?: string;
  nativeTypeId?: string;
  currency?: string;
  visibleInJournals?: boolean;
  visibleInOtherPayments?: boolean;
  isControlAccount?: boolean;
  controlName?: string;
  ledgerAccountId?: string;
  taxRecoverable?: boolean;
  recoverablePercentage?: number | null;
}
export interface TaxChoice {
  id: string;
  name: string;
  percentage: number;
  components: { id: string; name: string; percentage: number }[];
}
export interface ExpenseCatalogue {
  accounts: AccountChoice[];
  employees: { id: string; name: string }[];
  preservedEmployees?: { id: string; name: string }[];
  accountingProjects?: { id: string; name: string }[];
  preservedProjects?: { id: string; name: string }[];
  paymentMethods: { id: string; name: string }[];
  taxRates: TaxChoice[];
  taxComponents: { id: string; name: string }[];
}
function active(row: Row) {
  return row.Active !== false && row.is_active !== false && !row.deleted_at;
}
function qboKind(value: unknown): AccountChoice["kind"] {
  const type = text(value).replaceAll(" ", "");
  if (["Expense", "OtherExpense", "CostofGoodsSold"].includes(type))
    return "expense";
  if (["OtherCurrentLiability", "LongTermLiability"].includes(type))
    return "liability";
  if (type === "Bank") return "bank";
  if (type === "CreditCard") return "credit_card";
  return "other";
}
export function qboExpenseCatalogue(
  accounts: Row[],
  employees: Row[],
  codes: Row[],
  rates: Row[],
  customers: Row[] = []
): ExpenseCatalogue {
  const byId = new Map(rates.filter(active).map((row) => [text(row.Id), row]));
  const taxRates = codes.filter(active).flatMap((code) => {
    const detail = object(code.PurchaseTaxRateList).TaxRateDetail;
    if (
      !Array.isArray(detail) ||
      detail.some(
        (value) =>
          object(value).TaxTypeApplicable !== undefined &&
          object(value).TaxTypeApplicable !== "TaxOnAmount"
      )
    )
      return [];
    const components = detail.map((value) => {
      const rate = byId.get(text(object(object(value).TaxRateRef).value));
      return {
        id: text(rate?.Id),
        name: text(rate?.Name),
        percentage: number(rate?.RateValue),
      };
    });
    if (
      !components.length ||
      new Set(components.map((c) => c.id)).size !== components.length ||
      components.some(
        (c) => !c.id || !Number.isFinite(c.percentage) || c.percentage < 0
      )
    )
      return [];
    return [
      {
        id: text(code.Id),
        name: text(code.Name),
        percentage: components.reduce((sum, c) => sum + c.percentage, 0),
        components,
      },
    ];
  });
  return {
    accounts: accounts
      .filter((row) => row.Active === true)
      .map((row) => ({
        id: text(row.Id),
        name: text(row.FullyQualifiedName) || text(row.Name),
        kind: qboKind(row.AccountType),
        nativeType: text(row.AccountType),
        currency: text(object(row.CurrencyRef).value),
      }))
      .filter((row) => row.id && row.name),
    employees: employees
      .filter((row) => row.Active === true)
      .map((row) => ({ id: text(row.Id), name: text(row.DisplayName) }))
      .filter((row) => row.id && row.name),
    preservedEmployees: employees
      .filter((row) => row.Active === false)
      .map((row) => ({ id: text(row.Id), name: text(row.DisplayName) }))
      .filter((row) => row.id && row.name),
    accountingProjects: customers
      .filter((row) => row.Active === true && row.Job === true)
      .map((row) => ({
        id: text(row.Id),
        name: text(row.FullyQualifiedName) || text(row.DisplayName),
      }))
      .filter((row) => row.id && row.name),
    preservedProjects: customers
      .filter((row) => row.Active === false && row.Job === true)
      .map((row) => ({
        id: text(row.Id),
        name: text(row.FullyQualifiedName) || text(row.DisplayName),
      }))
      .filter((row) => row.id && row.name),
    paymentMethods: [
      { id: "Check", name: "Check / bank transfer" },
      { id: "Cash", name: "Cash" },
    ],
    taxRates,
    taxComponents: [
      ...new Map(
        taxRates
          .flatMap((rate) => rate.components)
          .map((component) => [
            component.id,
            { id: component.id, name: component.name },
          ])
      ).values(),
    ],
  };
}
export function sageExpenseCatalogue(
  ledgers: Row[],
  banks: Row[],
  methods: Row[],
  rates: Row[],
  today: string,
  projectCategories: Row[] = [],
  analysisTypes: Row[] = []
): ExpenseCatalogue {
  function percentage(row: Row): number {
    const periods = row.percentages;
    if (Array.isArray(periods) && periods.length) {
      const matches = periods
        .map(object)
        .filter(
          (p) =>
            (!text(p.from_date) || text(p.from_date) <= today) &&
            (!text(p.to_date) || text(p.to_date) >= today)
        );
      return matches.length === 1 ? number(matches[0].percentage) : NaN;
    }
    return number(row.percentage);
  }
  const taxRates = rates
    .filter((row) => active(row) && row.is_visible !== false)
    .flatMap((row) => {
      const raw =
        row.is_combined_rate === true
          ? Array.isArray(row.component_tax_rates)
            ? row.component_tax_rates.map(object)
            : []
          : [row];
      if (
        !raw.length ||
        raw.some(
          (component) =>
            component.is_combined_rate === true &&
            text(component.id) !== text(row.id)
        )
      )
        return [];
      const components = raw.map((c) => ({
        id: text(c.id),
        name: text(c.displayed_as) || text(c.name),
        percentage: percentage(c),
      }));
      if (
        new Set(components.map((c) => c.id)).size !== components.length ||
        components.some(
          (c) => !c.id || !Number.isFinite(c.percentage) || c.percentage < 0
        )
      )
        return [];
      return [
        {
          id: text(row.id),
          name: text(row.displayed_as) || text(row.name),
          percentage: components.reduce((sum, c) => sum + c.percentage, 0),
          components,
        },
      ];
    });
  return {
    accounts: [
      ...ledgers
        .filter((row) => active(row) && row.included_in_chart !== false)
        .map((row) => ({
          id: text(row.id),
          name: text(row.displayed_as) || text(row.name),
          // A control account can be receivables/payables. Its native flags, not a guessed type enum, determine eligibility.
          kind: "other" as const,
          nativeType: text(object(row.ledger_account_type).displayed_as),
          nativeTypeId: text(object(row.ledger_account_type).id),
          visibleInJournals: row.visible_in_journals === true,
          visibleInOtherPayments: row.visible_in_other_payments === true,
          isControlAccount: row.is_control_account === true,
          controlName: text(row.control_name),
          taxRecoverable: row.tax_recoverable === true,
          recoverablePercentage: Number.isFinite(
            number(row.recoverable_percentage)
          )
            ? number(row.recoverable_percentage)
            : null,
        })),
      ...banks
        .filter((row) => active(row) && row.is_active === true)
        .map((row) => ({
          id: text(row.id),
          name: text(row.displayed_as) || text(row.name),
          kind: "bank" as const,
          currency: text(object(row.currency).id),
          ledgerAccountId: text(object(row.ledger_account).id),
        })),
    ].filter((row) => row.id && row.name),
    employees: [],
    accountingProjects: projectCategories.flatMap((category) => {
      const parent = analysisTypes.find(
        (type) => type.id === object(category.analysis_type).id
      );
      if (!parent || !sageExpenseProjectEligible(category, parent)) return [];
      const parentName = text(parent.name) || text(parent.displayed_as);
      const categoryName = text(category.name) || text(category.displayed_as);
      if (!parentName || !categoryName) return [];
      return [
        { id: text(category.id), name: `${parentName}: ${categoryName}` },
      ];
    }),
    preservedProjects: projectCategories.flatMap((category) => {
      const parent = analysisTypes.find(
        (type) => type.id === object(category.analysis_type).id
      );
      if (!parent || sageExpenseProjectEligible(category, parent)) return [];
      const parentName = text(parent.name) || text(parent.displayed_as);
      const categoryName = text(category.name) || text(category.displayed_as);
      return parentName && categoryName
        ? [{ id: text(category.id), name: `${parentName}: ${categoryName}` }]
        : [];
    }),
    paymentMethods: methods
      .filter(active)
      .map((row) => ({
        id: text(row.id),
        name: text(row.displayed_as) || text(row.name),
      }))
      .filter((row) => row.id && row.name),
    taxRates,
    taxComponents: [
      ...new Map(
        taxRates
          .flatMap((rate) => rate.components)
          .map((c) => [c.id, { id: c.id, name: c.name }])
      ).values(),
    ],
  };
}

export async function expenseAccountingConnection(
  db: SupabaseClient,
  companyId: string,
  connectionId: string
): Promise<Row> {
  const { data, error } = await db
    .from("accounting_connections")
    .select(
      "id,company_id,provider,provider_environment,is_connected,sage_business_id,realm_id_lookup,sage_business_id_lookup"
    )
    .eq("id", connectionId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (
    !data ||
    !data.is_connected ||
    !["quickbooks", "sage"].includes(data.provider)
  )
    throw new Error("Accounting connection unavailable.");
  return data;
}
export function expenseCatalogueBinding(connection: Row): string {
  const identity =
    connection.provider === "quickbooks"
      ? text(connection.realm_id_lookup)
      : text(connection.sage_business_id_lookup);
  if (
    !["quickbooks", "sage"].includes(text(connection.provider)) ||
    !["sandbox", "production"].includes(
      text(connection.provider_environment)
    ) ||
    !/^[0-9a-f]{64}$/.test(identity)
  )
    throw new Error("Accounting connection needs review.");
  return `${connection.provider}:${connection.provider_environment}:${identity}`;
}
export async function loadExpenseCatalogue(
  db: SupabaseClient,
  connection: Row
): Promise<ExpenseCatalogue> {
  const connectionId = text(connection.id);
  const token = await AccountingTokenService.getValidToken(db, connectionId);
  if (
    token.providerEnvironment !== connection.provider_environment ||
    !token.accessToken
  )
    throw new Error("Accounting connection needs review.");
  if (connection.provider === "quickbooks") {
    if (!token.realmId || !/^\d+$/.test(token.realmId))
      throw new Error("QuickBooks company unavailable.");
    const host =
      token.providerEnvironment === "sandbox"
        ? "https://sandbox-quickbooks.api.intuit.com"
        : "https://quickbooks.api.intuit.com";
    async function list(
      entity: "Account" | "Employee" | "TaxCode" | "TaxRate" | "Customer"
    ): Promise<Row[]> {
      const result: Row[] = [];
      for (let start = 1; start <= 10000; start += 1000) {
        const query = `select * from ${entity}${["Employee", "Customer"].includes(entity) ? " WHERE Active IN (true, false)" : ""} STARTPOSITION ${start} MAXRESULTS 1000`;
        const response = await fetch(
          `${host}/v3/company/${token.realmId}/query?minorversion=75&query=${encodeURIComponent(query)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
              Accept: "application/json",
            },
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          }
        );
        if (!response.ok)
          throw new Error(
            "QuickBooks account choices are unavailable. Try again."
          );
        const body = object(await response.json());
        const rows = object(body.QueryResponse)[entity];
        if (rows !== undefined && !Array.isArray(rows))
          throw new Error("QuickBooks account choices need review.");
        result.push(...((rows ?? []) as Row[]));
        if (!rows || (rows as Row[]).length < 1000) return result;
      }
      throw new Error(
        "QuickBooks account list exceeds the supported selection limit."
      );
    }
    const [accounts, employees, codes, rates, customers] = await Promise.all([
      list("Account"),
      list("Employee"),
      list("TaxCode"),
      list("TaxRate"),
      list("Customer"),
    ]);
    return qboExpenseCatalogue(accounts, employees, codes, rates, customers);
  }
  const businessId = decryptToken(text(connection.sage_business_id));
  if (!businessId) throw new Error("Sage business unavailable.");
  let accessToken = token.accessToken;
  const client = createSageReadClient({
    businessId,
    getAccessToken: async () => accessToken,
    refreshAccessToken: async () =>
      (accessToken = await AccountingTokenService.forceRefresh(
        db,
        connectionId
      )),
    onDisconnect: () =>
      AccountingTokenService.disconnectGrant(db, connectionId, "sage"),
  });
  // Sage lists default to resource references. Explicitly request every field used below.
  const [ledgers, banks, methods, rates, projectCategories, analysisTypes] =
    await Promise.all([
      client.list("ledger_accounts", {
        query: {
          attributes:
            "name,ledger_account_type,included_in_chart,visible_in_journals,visible_in_other_payments,is_control_account,control_name,tax_recoverable,recoverable_percentage",
        },
      }),
      client.list("bank_accounts", {
        query: { attributes: "currency,is_active,deleted_at,ledger_account" },
      }),
      client.list("payment_methods"),
      client.list("tax_rates", {
        query: {
          attributes:
            "name,percentage,percentages,is_visible,is_combined_rate,component_tax_rates",
        },
      }),
      client.list("analysis_type_categories", {
        query: { attributes: "all", analysis_type_level: "TRANSACTION" },
      }),
      client.list("analysis_types", {
        query: { attributes: "all", analysis_type_level: "TRANSACTION" },
      }),
    ]);
  return sageExpenseCatalogue(
    ledgers,
    banks,
    methods,
    rates,
    new Date().toISOString().slice(0, 10),
    projectCategories,
    analysisTypes
  );
}

export function validateExpenseSettingsSelection(
  input: z.infer<typeof expenseSettingsRequestSchema>,
  provider: string,
  catalogue: ExpenseCatalogue,
  preservedPayees: readonly {
    userId: string;
    externalEmployeeId: string;
  }[] = [],
  preservedProjectMappings: readonly {
    projectId: string;
    externalProjectId: string;
  }[] = []
) {
  if (input.projectMappings) {
    if (
      new Set(input.projectMappings.map((mapping) => mapping.projectId))
        .size !== input.projectMappings.length
    )
      throw new Error("Each project needs one accounting assignment.");
    for (const mapping of input.projectMappings)
      if (
        !(catalogue.accountingProjects ?? []).some(
          (project) => project.id === mapping.externalProjectId
        ) &&
        !preservedProjectMappings.some(
          (saved) =>
            saved.projectId === mapping.projectId &&
            saved.externalProjectId === mapping.externalProjectId
        )
      )
        throw new Error("Choose an existing accounting project.");
  }
  const config = input.configuration;
  const byId = new Map(
    catalogue.accounts.map((account) => [account.id, account])
  );
  const check = (
    id: string | null | undefined,
    kinds: AccountChoice["kind"][],
    label: string
  ) => {
    if (!id) return undefined;
    const account = byId.get(id);
    if (
      !account ||
      !kinds.includes(account.kind) ||
      (account.currency && account.currency !== config.currency)
    )
      throw new Error(
        `Choose a valid ${label} account in the selected currency.`
      );
    return account;
  };
  const sageLedger: AccountChoice["kind"][] = ["other", "tax"];
  const journal = (account: AccountChoice | undefined) => {
    if (account && provider === "sage" && account.visibleInJournals !== true)
      throw new Error("Choose a Sage account available for journal entries.");
  };
  const liability = check(
    config.liabilityAccountId,
    provider === "sage" ? sageLedger : ["liability"],
    "reimbursement liability"
  );
  journal(liability);
  if (
    provider === "sage" &&
    liability &&
    (liability.isControlAccount || liability.visibleInOtherPayments !== true)
  )
    throw new Error(
      "Choose a dedicated reimbursement liability account available for other payments."
    );
  const card = check(
    config.companyCardAccountId,
    provider === "sage" ? sageLedger : ["credit_card"],
    "company card"
  );
  journal(card);
  if (provider === "sage" && card?.isControlAccount)
    throw new Error(
      "Choose the company card ledger, separate from Sage control accounts."
    );
  const bank = check(config.reimbursementAccountId, ["bank"], "repayment");
  if (provider === "sage" && bank) {
    const ledger = byId.get(bank.ledgerAccountId ?? "");
    if (bank.currency !== config.currency || !ledger || ledger.kind === "bank")
      throw new Error(
        "Choose a repayment bank with a journal ledger in the selected currency."
      );
    journal(ledger);
  }
  if (
    config.reimbursementPaymentMethod &&
    !catalogue.paymentMethods.some(
      (method) => method.id === config.reimbursementPaymentMethod
    )
  )
    throw new Error("Choose a valid repayment method.");
  const category = (id: string) => {
    // QBO permits expense and asset accounts for these distribution lines.
    const account = check(
      id,
      provider === "sage" ? sageLedger : ["expense", "other"],
      "expense category"
    );
    if (
      provider === "quickbooks" &&
      account?.kind === "other" &&
      !["Other Current Asset", "Fixed Asset", "Other Asset"].includes(
        account.nativeType ?? ""
      )
    )
      throw new Error(
        "Choose an expense or asset account for the expense category."
      );
    journal(account);
    if (
      provider === "sage" &&
      account &&
      (account.isControlAccount ||
        (account.taxRecoverable && account.recoverablePercentage !== 100))
    )
      throw new Error(
        "Choose an expense account without a control balance or partial tax recovery."
      );
  };
  for (const mapping of input.categoryMappings)
    category(mapping.externalAccountId);
  if (
    new Set(input.categoryMappings.map((m) => m.categoryId)).size !==
      input.categoryMappings.length ||
    new Set(input.payeeMappings.map((m) => m.userId)).size !==
      input.payeeMappings.length
  )
    throw new Error("Each expense category and crew member needs one mapping.");
  // This allowlist is read by the service from the exact company's saved connection, never supplied by the caller.
  for (const mapping of input.payeeMappings)
    if (
      provider !== "quickbooks" ||
      (!catalogue.employees.some(
        (employee) => employee.id === mapping.externalEmployeeId
      ) &&
        !preservedPayees.some(
          (saved) =>
            saved.userId === mapping.userId &&
            saved.externalEmployeeId === mapping.externalEmployeeId
        ))
    )
      throw new Error("Choose an existing QuickBooks employee.");
  for (const [componentId, mapping] of Object.entries(
    config.taxComponentAccounts
  )) {
    const account = byId.get(mapping.accountId);
    if (
      !catalogue.taxComponents.some(
        (component) => component.id === componentId
      ) ||
      !account ||
      (provider === "sage" &&
        mapping.recoverable &&
        (!account.isControlAccount || !account.controlName))
    )
      throw new Error(
        "Choose the matching tax component and its tax-control account."
      );
    if (provider === "sage" && mapping.recoverable) {
      if (config.countryCode !== "CA")
        throw new Error(
          "Recoverable Sage journal tax requires a supported Canadian tax-control account."
        );
      journal(account);
    } else category(mapping.accountId);
  }
  if (
    new Set((input.taxMappings ?? []).map((mapping) => mapping.taxRate))
      .size !== (input.taxMappings ?? []).length
  )
    throw new Error("Choose one accounting code for each receipt tax rate.");
  for (const mapping of input.taxMappings ?? [])
    if (
      !catalogue.taxRates.some(
        (rate) =>
          rate.id === mapping.externalTaxCodeId &&
          Math.abs(rate.percentage - mapping.taxRate) < 0.00005
      )
    )
      throw new Error(
        "Choose the accounting tax code matching the receipt tax rate."
      );
}

/** Read named expense-relevant projects without importing AP mapping authority. */
export async function loadExpenseProjectSettings(
  db: SupabaseClient,
  companyId: string,
  connectionId: string
) {
  const mappings: Row[] = [];
  const projectIds = new Set<string>();
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db
      .from("expense_accounting_project_mappings")
      .select("project_id,external_project_id")
      .eq("company_id", companyId)
      .eq("connection_id", connectionId)
      .order("project_id")
      .range(start, start + 999);
    if (error) throw error;
    mappings.push(...(data ?? []));
    for (const row of data ?? []) projectIds.add(text(row.project_id));
    if ((data ?? []).length < 1000) break;
  }
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db
      .from("expense_project_allocations")
      .select("id,project_id,expenses!inner(company_id)")
      .eq("expenses.company_id", companyId)
      .order("id")
      .range(start, start + 999);
    if (error) throw error;
    for (const row of data ?? [])
      if (z.string().uuid().safeParse(row.project_id).success)
        projectIds.add(row.project_id);
    if ((data ?? []).length < 1000) break;
  }
  const projects: { id: string; name: string; archived: boolean }[] = [];
  const ids = [...projectIds];
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await db
      .from("projects")
      .select("id,title,deleted_at")
      .eq("company_id", companyId)
      .in("id", ids.slice(start, start + 200));
    if (error) throw error;
    projects.push(
      ...(data ?? []).map((row) => ({
        id: row.id,
        name: row.title,
        archived: Boolean(row.deleted_at),
      }))
    );
  }
  projects.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
  const ownIds = new Set(projects.map((project) => project.id));
  return {
    projects,
    projectMappings: mappings
      .filter((row) => ownIds.has(text(row.project_id)))
      .map((row) => ({
        projectId: text(row.project_id),
        externalProjectId: text(row.external_project_id),
      })),
  };
}
