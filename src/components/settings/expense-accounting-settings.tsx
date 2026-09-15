"use client";

import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useDictionary, useLocale } from "@/i18n/client";
import { queryKeys } from "@/lib/api/query-client";
import { usePermissionStore } from "@/lib/store/permissions-store";

interface NamedReference { id: string; name: string; archived?: boolean }
interface Account extends NamedReference {
  kind: "expense" | "liability" | "bank" | "credit_card" | "tax" | "other";
  nativeType?: string;
  nativeTypeId?: string;
  taxRecoverable?: boolean;
  recoverablePercentage?: number | null;
  visibleInJournals?: boolean;
  visibleInOtherPayments?: boolean;
  isControlAccount?: boolean;
}
interface TaxAccount { accountId: string; recoverable: boolean }
interface Configuration {
  currency: string;
  countryCode: string;
  liabilityAccountId: string | null;
  reimbursementAccountId: string | null;
  reimbursementPaymentMethod: string | null;
  companyCardAccountId: string | null;
  taxComponentAccounts: Record<string, TaxAccount>;
}
interface ExpenseAccountingSetup {
  connectionId: string;
  catalogueBinding: string;
  provider: "quickbooks" | "sage";
  configuration: Configuration | null;
  recommendedCurrency: string | null;
  recommendedCountryCode: string | null;
  projectMappings?: { projectId: string; externalProjectId: string }[];
  projects?: NamedReference[];
  accountingProjects?: NamedReference[];
  preservedProjects?: NamedReference[];
  categoryMappings: { categoryId: string; externalAccountId: string }[];
  payeeMappings: { userId: string; externalEmployeeId: string }[];
  taxMappings: { taxRate: number; externalTaxCodeId: string }[];
  categories: NamedReference[];
  crew: NamedReference[];
  accounts: Account[];
  employees: NamedReference[];
  preservedEmployees?: NamedReference[];
  paymentMethods: NamedReference[];
  taxComponents: NamedReference[];
  taxRates: (NamedReference & { percentage: number; components: (NamedReference & { percentage: number })[] })[];
}

async function requestSetup(connectionId: string, body?: unknown): Promise<ExpenseAccountingSetup> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  const response = await fetch(
    `/api/integrations/accounting/expense-settings${body ? "" : `?${new URLSearchParams({ connectionId })}`}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (!response.ok) throw new Error(response.status === 409 ? "expense_accounting_connection_changed" : "expense_accounting_settings_request_failed");
  // Saving is confirmed by the subsequent canonical GET, not a local echo.
  const result = await response.json();
  if (!body && (result.connectionId !== connectionId || typeof result.catalogueBinding !== "string" || !result.catalogueBinding || !["quickbooks", "sage"].includes(result.provider))) {
    throw new Error("expense_accounting_settings_connection_mismatch");
  }
  return result;
}

function Choice({ label, value, options, onChange, disabled, optional = false, preservedOptions = [] }: {
  label: React.ReactNode;
  value: string;
  options: NamedReference[];
  onChange: (value: string) => void;
  disabled?: boolean;
  optional?: boolean;
  preservedOptions?: NamedReference[];
}) {
  const id = useId();
  const { t } = useDictionary("settings");
  const unavailable = value && !options.some((option) => option.id === value);
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="block font-mohave text-body-sm text-text-2">{label}</label>
      <select
        id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
        className="h-control-36 w-full min-w-0 rounded border border-border bg-surface-input px-1.5 font-mohave text-body-sm text-text focus:border-ops-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
      >
        <option value="">{t(optional ? "accounting.expenses.unmapped" : "accounting.expenses.select")}</option>
        {unavailable && <option value={value} disabled>{preservedOptions.find((option) => option.id === value)?.name ?? t("accounting.expenses.unavailable")}</option>}
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </div>
  );
}

function MappingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="border-t border-border pt-1.5">
      <summary className="cursor-pointer font-mohave text-body text-text focus-visible:outline-ops-accent">{title}</summary>
      <div className="space-y-1.5 pt-1.5">{children}</div>
    </details>
  );
}

function SetupForm({ data, onSave, saving, failed, connectionChanged, reloading, onReload }: {
  data: ExpenseAccountingSetup;
  onSave: (body: unknown) => void;
  saving: boolean;
  failed: boolean;
  connectionChanged: boolean;
  reloading: boolean;
  onReload: () => void;
}) {
  const { t } = useDictionary("settings");
  const { locale } = useLocale();
  const initial = {
    configuration: {
      ...(data.configuration ?? {
      currency: data.recommendedCurrency ?? "", countryCode: data.recommendedCountryCode ?? "",
      liabilityAccountId: "", reimbursementAccountId: "", reimbursementPaymentMethod: "",
      companyCardAccountId: "", taxComponentAccounts: {},
      }),
      liabilityAccountId: data.configuration?.liabilityAccountId ?? "",
      reimbursementAccountId: data.configuration?.reimbursementAccountId ?? "",
      reimbursementPaymentMethod: data.configuration?.reimbursementPaymentMethod ?? "",
      companyCardAccountId: data.configuration?.companyCardAccountId ?? "",
    },
    projects: Object.fromEntries((data.projectMappings ?? []).map((mapping) => [mapping.projectId, mapping.externalProjectId])),
    categories: Object.fromEntries(data.categoryMappings.map((mapping) => [mapping.categoryId, mapping.externalAccountId])),
    payees: Object.fromEntries(data.payeeMappings.map((mapping) => [mapping.userId, mapping.externalEmployeeId])),
    taxRates: Object.fromEntries((data.taxMappings ?? []).map((mapping) => [String(mapping.taxRate), mapping.externalTaxCodeId])),
    taxes: Object.fromEntries(Object.entries(data.configuration?.taxComponentAccounts ?? {}).map(([id, account]) => [id, { ...account, recoverable: account.recoverable as boolean | null }])),
  };
  const [draft, setDraft] = useState(initial);
  const dirty = !data.configuration || JSON.stringify(draft) !== JSON.stringify(initial);
  const config = draft.configuration;
  const setConfig = (field: keyof Omit<Configuration, "taxComponentAccounts">, value: string) =>
    setDraft((current) => ({ ...current, configuration: { ...current.configuration, [field]: value } }));
  const setMap = (field: "categories" | "payees" | "taxRates" | "projects", id: string, value: string) =>
    setDraft((current) => ({ ...current, [field]: { ...current[field], [id]: value } }));
  const setTax = (id: string, value: Partial<{ accountId: string; recoverable: boolean | null }>) =>
    setDraft((current) => {
      const previous = current.taxes[id] ?? { accountId: "", recoverable: null };
      return { ...current, taxes: { ...current.taxes, [id]: { ...previous, ...value } } };
    });

  const sage = data.provider === "sage";
  const ledgers = data.accounts.filter((account) => account.kind !== "bank" && account.visibleInJournals === true && account.isControlAccount !== true);
  const liabilities = sage ? ledgers.filter((account) => account.visibleInOtherPayments === true) : data.accounts.filter((account) => account.kind === "liability");
  const cards = sage ? ledgers : data.accounts.filter((account) => account.kind === "credit_card");
  const expenseAccounts = sage ? ledgers.filter((account) => !account.taxRecoverable || account.recoverablePercentage === 100)
    : data.accounts.filter((account) => account.kind === "expense" || (account.kind === "other" && ["Other Current Asset", "Fixed Asset", "Other Asset"].includes(account.nativeType ?? "")));
  const bankAccounts = data.accounts.filter((account) => account.kind === "bank");
  const taxAccounts = sage
    ? data.accounts.filter((account) => account.kind !== "bank" && account.visibleInJournals === true)
    : expenseAccounts;
  const countries = (sage ? ["CA", "GB", "IE"] : ["CA", "US", "GB", "IE", "AU"])
    .map((id) => ({ id, name: t(`accounting.expenses.country.${id}`) }));
  const currencyNames = new Intl.DisplayNames([locale], { type: "currency" });
  const currencies = [...new Set(["CAD", "USD", "GBP", "EUR", "AUD", data.configuration?.currency, data.recommendedCurrency].filter((value): value is string => Boolean(value)))]
    .map((id) => ({ id, name: `${currencyNames.of(id) ?? id} (${id})` }));
  const rateOptions = data.taxRates ?? [];
  const percentages = [...new Set([...rateOptions.map((rate) => rate.percentage), ...Object.keys(draft.taxRates).map(Number)])].sort((a, b) => a - b);
  const selectedComponents = new Set([
    ...rateOptions.filter((rate) => Object.values(draft.taxRates).includes(rate.id)).flatMap((rate) => rate.components.map((component) => component.id)),
    ...Object.keys(draft.taxes),
  ]);
  const components = (data.taxComponents ?? []).filter((component) => selectedComponents.has(component.id));
  const hasOption = (options: NamedReference[], value: string) => options.some((option) => option.id === value);
  const complete = hasOption(countries, config.countryCode) && hasOption(currencies, config.currency)
    && (!config.liabilityAccountId || hasOption(liabilities, config.liabilityAccountId))
    && (!config.reimbursementAccountId || hasOption(bankAccounts, config.reimbursementAccountId))
    && (!config.companyCardAccountId || hasOption(cards, config.companyCardAccountId))
    && (!config.reimbursementPaymentMethod || hasOption(data.paymentMethods, config.reimbursementPaymentMethod))
    && Object.values(draft.taxes).every((mapping) => !mapping.accountId || (mapping.recoverable !== null && (config.countryCode === "CA" || !mapping.recoverable)));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || !dirty || saving || reloading || connectionChanged) return;
    onSave({
      connectionId: data.connectionId,
      catalogueBinding: data.catalogueBinding,
      configuration: { ...config,
        liabilityAccountId: config.liabilityAccountId || null, reimbursementAccountId: config.reimbursementAccountId || null,
        reimbursementPaymentMethod: config.reimbursementPaymentMethod || null, companyCardAccountId: config.companyCardAccountId || null,
        taxComponentAccounts: Object.fromEntries(Object.entries(draft.taxes).filter(([, mapping]) => mapping.accountId)) },
      ...(data.projectMappings !== undefined ? { projectMappings: Object.entries(draft.projects).filter(([, id]) => id).map(([projectId, externalProjectId]) => ({ projectId, externalProjectId })) } : {}),
      categoryMappings: Object.entries(draft.categories).filter(([, id]) => id).map(([categoryId, externalAccountId]) => ({ categoryId, externalAccountId })),
      payeeMappings: Object.entries(draft.payees).filter(([, id]) => id).map(([userId, externalEmployeeId]) => ({ userId, externalEmployeeId })),
      taxMappings: Object.entries(draft.taxRates).filter(([, id]) => id).map(([taxRate, externalTaxCodeId]) => ({ taxRate: Number(taxRate), externalTaxCodeId })),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <fieldset disabled={saving || reloading} className="space-y-1.5">
        <legend className="sr-only">{t("accounting.expenses.title")}</legend>
        <p className="font-mohave text-body-sm text-text-3">{t("accounting.expenses.intro")}</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Choice label={t("accounting.expenses.country")} value={config.countryCode} options={countries} onChange={(value) => setConfig("countryCode", value)} />
          <Choice label={t("accounting.expenses.currency")} value={config.currency} options={currencies} onChange={(value) => setConfig("currency", value)} />
        </div>
        <Choice label={t("accounting.expenses.liability")} value={config.liabilityAccountId} options={liabilities} onChange={(value) => setConfig("liabilityAccountId", value)} optional />
        <Choice label={t("accounting.expenses.bank")} value={config.reimbursementAccountId} options={bankAccounts} onChange={(value) => setConfig("reimbursementAccountId", value)} optional />
        <Choice label={t("accounting.expenses.paymentMethod")} value={config.reimbursementPaymentMethod} options={data.paymentMethods} onChange={(value) => setConfig("reimbursementPaymentMethod", value)} optional />
        <Choice label={t("accounting.expenses.card")} value={config.companyCardAccountId} options={cards} onChange={(value) => setConfig("companyCardAccountId", value)} optional />
        {data.categories.length > 0 && <MappingGroup title={t("accounting.expenses.categories")}>
          {data.categories.map((category) => <Choice key={category.id} label={category.name} value={draft.categories[category.id] ?? ""} options={expenseAccounts} onChange={(value) => setMap("categories", category.id, value)} optional />)}
        </MappingGroup>}
        {data.projectMappings !== undefined && (data.projects?.length ?? 0) > 0 && <MappingGroup title={t("accounting.expenses.projects")}>
          <p className="font-mohave text-body-sm text-text-3">{t(`accounting.expenses.projectIntro.${data.provider}`)}</p>
          {data.projects!.map((project) => <Choice
            key={project.id}
            label={project.archived ? `${project.name} · ${t("accounting.expenses.archived")}` : project.name}
            value={draft.projects[project.id] ?? ""}
            options={project.archived ? [] : (data.accountingProjects ?? [])}
            preservedOptions={[...(data.accountingProjects ?? []), ...(data.preservedProjects ?? [])]}
            onChange={(value) => setMap("projects", project.id, value)} optional
          />)}
        </MappingGroup>}
        {(data.employees.length > 0 || data.payeeMappings.length > 0) && data.crew.length > 0 && <MappingGroup title={t("accounting.expenses.crew")}>
          {data.crew.map((person) => <Choice key={person.id} label={person.archived ? `${person.name} · ${t("accounting.expenses.archived")}` : person.name} value={draft.payees[person.id] ?? ""} options={person.archived ? [] : data.employees} preservedOptions={[...data.employees, ...(data.preservedEmployees ?? [])]} onChange={(value) => setMap("payees", person.id, value)} optional />)}
        </MappingGroup>}
        {(percentages.length > 0 || components.length > 0) && <MappingGroup title={t("accounting.expenses.taxes")}>
          <p className="font-mohave text-body-sm text-text-3">{t("accounting.expenses.taxIntro")}</p>
          {percentages.map((percentage) => <Choice
            key={percentage} label={<span className="font-mono">{new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(percentage)}%</span>}
            value={draft.taxRates[String(percentage)] ?? ""}
            options={rateOptions.filter((rate) => rate.percentage === percentage)}
            onChange={(value) => setMap("taxRates", String(percentage), value)} optional
          />)}
          {components.map((component) => <div key={component.id} className="space-y-1 border-t border-border pt-1.5">
            <Choice label={component.name} value={draft.taxes[component.id]?.accountId ?? ""} options={taxAccounts} onChange={(value) => setTax(component.id, { accountId: value })} optional />
            {draft.taxes[component.id]?.accountId && <Choice
              label={t("accounting.expenses.taxTreatment")}
              value={draft.taxes[component.id].recoverable === null ? "" : draft.taxes[component.id].recoverable ? "recoverable" : "expense"}
              options={[
                ...(config.countryCode === "CA" ? [{ id: "recoverable", name: t("accounting.expenses.recoverable") }] : []),
                { id: "expense", name: t("accounting.expenses.nonRecoverable") },
              ]}
              onChange={(value) => setTax(component.id, { recoverable: value ? value === "recoverable" : null })}
            />}
          </div>)}
        </MappingGroup>}
      </fieldset>
      {failed && <p role="alert" className="font-mohave text-body-sm text-rose">{t(connectionChanged ? "accounting.expenses.connectionChanged" : "accounting.expenses.saveFailed")}</p>}
      {!complete && <p className="font-mohave text-body-sm text-text-3">{t("accounting.expenses.required")}</p>}
      <div className="flex flex-wrap gap-1.5">
      {connectionChanged && <Button type="button" variant="secondary" disabled={reloading} onClick={onReload}>{t("accounting.expenses.reload")}</Button>}
      <Button type="submit" variant="primary" disabled={!complete || !dirty || saving || reloading || connectionChanged}>
        {t(saving ? "accounting.expenses.saving" : "accounting.expenses.save")}
      </Button>
      </div>
    </form>
  );
}

function LoadedSettings({ companyId, connectionId }: { companyId: string; connectionId: string }) {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((state) => state.can);
  const queryClient = useQueryClient();
  const queryKey = [...queryKeys.accounting.all, "expenseSettings", companyId, connectionId];
  const query = useQuery({ queryKey, queryFn: () => requestSetup(connectionId), refetchOnWindowFocus: false, retry: false });
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: async (body: unknown) => {
      await requestSetup(connectionId, body);
      return requestSetup(connectionId);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      toast.success(t("accounting.expenses.saved"));
    },
    onSettled: () => { inFlight.current = false; },
  });

  if (query.isPending) return <p role="status" className="font-mohave text-body-sm text-text-3">{t("integrations.loading")}</p>;
  if (query.isError || !query.data) return <div className="space-y-1.5">
    <p role="alert" className="font-mohave text-body-sm text-rose">{t("accounting.expenses.loadFailed")}</p>
    <Button variant="secondary" onClick={() => void query.refetch()}>{t("integrations.analysis.retry")}</Button>
  </div>;
  return <SetupForm key={query.dataUpdatedAt} data={query.data} saving={mutation.isPending} failed={mutation.isError} connectionChanged={mutation.error?.message === "expense_accounting_connection_changed"} reloading={query.isFetching} onReload={() => { void query.refetch().then((result) => { if (result.isSuccess) mutation.reset(); }); }} onSave={(body) => {
    if (inFlight.current || !can("accounting.manage_connections") || !can("expenses.approve")) return;
    inFlight.current = true;
    mutation.mutate(body);
  }} />;
}

export function ExpenseAccountingSettings({ companyId, connectionId }: { companyId: string; connectionId: string }) {
  const { t } = useDictionary("settings");
  const authorized = usePermissionStore((state) => state.can("accounting.manage_connections") && state.can("expenses.approve"));
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  const id = useId();
  if (!authorized) return null;
  return (
    <section className="space-y-1.5 border-t border-border pt-3">
      <Button variant="ghost" className="w-full justify-start px-0" aria-expanded={expanded} aria-controls={id} onClick={() => { setOpened(true); setExpanded((value) => !value); }}>
        {expanded ? <ChevronDown aria-hidden className="h-2 w-2 shrink-0" /> : <ChevronRight aria-hidden className="h-2 w-2 shrink-0" />}
        {t("accounting.expenses.title")}
      </Button>
      {opened && <div id={id} hidden={!expanded}><LoadedSettings companyId={companyId} connectionId={connectionId} /></div>}
    </section>
  );
}
