import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExpensePosting,
  expenseAccountingConfigurationSchema,
  expenseCents,
  expenseMappingError,
  expensePostingGraphSchema,
  type ExpenseMappingInput,
  type ExpensePostingGraph,
  type ExpenseTaxComponent,
} from "@/lib/accounting/expenses/provider-mappers";
import type { AccountingSyncQueueRow } from "./accounting-sync-queue-types";
import type { QuickBooksWriteService } from "./quickbooks-write-service";
import type { SageWriteClient } from "./sage-api-client";
import { sageExpenseProjectEligible } from "@/lib/accounting/expenses/project-mappings";
import { sageIdempotencyKey } from "./sage-idempotency";

export type ExpenseQueueRow = AccountingSyncQueueRow<"expense">;
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const sourceSchema = z
  .object({
    id: z.string().uuid(),
    company_id: z.string().uuid(),
    submitted_by: z.string().uuid(),
    amount: z.string(),
    tax_amount: z.string().nullable(),
    currency: z.string(),
    expense_date: z.string(),
    payment_method: z.string().nullable(),
    category_id: z.string().uuid().nullable(),
    description: z.string().nullable(),
    merchant_name: z.string().nullable(),
    recorded_at: z.string().datetime({ offset: true }),
    allocations: z.array(
      z.object({
        project_id: z.string().uuid(),
        amount: z.string(),
        percentage: z.string().nullable(),
      })
    ),
  })
  .passthrough();
const eventSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  expense_id: z.string().uuid(),
  kind: z.enum(["accrual", "purchase", "settlement", "reversal", "review"]),
  original_event_id: z.string().uuid().nullable(),
  source_snapshot: sourceSchema,
});
export interface ExpenseProviderSession {
  providerTargetId: string;
  environment: "sandbox" | "production";
  quickbooks?: Pick<QuickBooksWriteService, "fetchReference" | "create">;
  sage?: SageWriteClient;
}
const frozenPayloadSchema = z.object({
  resource: expensePostingGraphSchema.shape.resource,
  body: z.record(z.unknown()),
  providerEnvironment: z.enum(["sandbox", "production"]),
  providerTargetId: z.string().min(1),
  idempotencyId: z.string().min(1),
});
export interface FrozenExpenseWrite {
  payload: z.infer<typeof frozenPayloadSchema>;
  posting: ExpensePostingGraph;
  createdAt: string;
}

/** Reads only exact company/connection identities. RPCs own all posting mutations. */
export class ExpenseAccountingProviderService {
  constructor(
    private readonly db: SupabaseClient,
    private readonly row: ExpenseQueueRow,
    private readonly workerId: string
  ) {}

  private async one(
    table: string,
    columns: string,
    filters: Record<string, string>
  ) {
    let query = this.db
      .from(table)
      .select(columns)
      .eq("company_id", this.row.companyId);
    for (const [key, value] of Object.entries(filters))
      query = query.eq(key, value);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data as Record<string, unknown> | null;
  }

  private decodeFrozen(
    value: unknown,
    session: ExpenseProviderSession,
    eventId: string
  ): FrozenExpenseWrite {
    const record = object(value);
    const payload = frozenPayloadSchema.safeParse(record.payload);
    const posting = expensePostingGraphSchema.safeParse(record.posting);
    if (
      !payload.success ||
      !posting.success ||
      record.company_id !== this.row.companyId ||
      record.expense_id !== this.row.entityId ||
      record.connection_id !== this.row.connectionId ||
      record.queue_id !== this.row.id ||
      record.event_id !== eventId ||
      record.provider !== this.row.provider ||
      posting.data.eventId !== eventId ||
      posting.data.expenseId !== this.row.entityId ||
      posting.data.provider !== this.row.provider ||
      posting.data.resource !== payload.data.resource ||
      payload.data.providerEnvironment !== session.environment ||
      payload.data.providerTargetId !== session.providerTargetId ||
      !Number.isFinite(Date.parse(text(record.created_at)))
    ) {
      return expenseMappingError(
        "expense_frozen_posting_invalid",
        "The saved expense posting no longer matches this accounting connection. Review before syncing."
      );
    }
    if (
      this.row.provider === "quickbooks"
        ? !["JournalEntry", "Purchase"].includes(payload.data.resource)
        : !["journals", "other_payments"].includes(payload.data.resource)
    ) {
      return expenseMappingError(
        "expense_provider_resource_invalid",
        "Expense posting provider resource needs review."
      );
    }
    return {
      payload: payload.data,
      posting: posting.data,
      createdAt: text(record.created_at),
    };
  }

  async prepare(session: ExpenseProviderSession): Promise<FrozenExpenseWrite> {
    const eventId = text(this.row.payloadSnapshot.eventId);
    if (!z.string().uuid().safeParse(eventId).success)
      expenseMappingError(
        "expense_event_missing",
        "Expense accounting event is unavailable."
      );
    const eventResult = eventSchema.safeParse(
      await this.one("expense_accounting_events", "*", {
        id: eventId,
        expense_id: this.row.entityId,
      })
    );
    if (!eventResult.success)
      expenseMappingError(
        "expense_event_invalid",
        "Expense accounting source needs review."
      );
    const event = eventResult.data;
    const source = event.source_snapshot;
    if (
      source.id !== this.row.entityId ||
      source.company_id !== this.row.companyId
    )
      expenseMappingError(
        "expense_source_mismatch",
        "Expense accounting source identity does not match."
      );
    if (event.kind === "review")
      expenseMappingError(
        "expense_legacy_review",
        "Review the existing provider history for this expense before syncing."
      );
    const frozen = await this.one("expense_accounting_postings", "*", {
      event_id: eventId,
      connection_id: this.row.connectionId,
    });
    let proposed: FrozenExpenseWrite["payload"];
    let posting: ExpensePostingGraph;
    if (frozen) {
      const decoded = this.decodeFrozen(frozen, session, eventId);
      if (frozen.external_id)
        expenseMappingError(
          "expense_already_posted",
          "This expense posting already has provider evidence. Reconcile it before retrying."
        );
      proposed = decoded.payload;
      posting = decoded.posting;
    } else {
      let original: ExpensePostingGraph | undefined;
      if (event.kind === "reversal" || event.kind === "settlement") {
        if (!event.original_event_id)
          expenseMappingError(
            "expense_original_missing",
            "The original expense posting is required before repayment or undo."
          );
        const previous = await this.one("expense_accounting_postings", "*", {
          event_id: event.original_event_id!,
          connection_id: this.row.connectionId,
          expense_id: this.row.entityId,
        });
        const parsed = expensePostingGraphSchema.safeParse(previous?.posting);
        if (
          !previous?.external_id ||
          !parsed.success ||
          previous.provider !== this.row.provider ||
          parsed.data.eventId !== event.original_event_id ||
          parsed.data.expenseId !== this.row.entityId ||
          parsed.data.provider !== this.row.provider
        ) {
          expenseMappingError(
            "expense_original_missing",
            "The original expense must finish syncing before repayment or undo can sync."
          );
        }
        const previousPayload = frozenPayloadSchema.safeParse(previous.payload);
        if (
          !previousPayload.success ||
          previousPayload.data.providerTargetId !== session.providerTargetId ||
          previousPayload.data.providerEnvironment !== session.environment
        ) {
          expenseMappingError(
            "expense_original_connection_mismatch",
            "The original expense belongs to a different provider company or environment."
          );
        }
        original = parsed.data;
      }
      let configurationValue =
        event.kind === "reversal"
          ? original?.configuration
          : this.row.payloadSnapshot.configurationSnapshot;
      if (!configurationValue && event.kind !== "settlement") {
        configurationValue = (
          await this.one("expense_accounting_settings", "configuration", {
            connection_id: this.row.connectionId,
          })
        )?.configuration;
      }
      const configured =
        expenseAccountingConfigurationSchema.safeParse(configurationValue);
      if (!configured.success)
        expenseMappingError(
          "expense_configuration_required",
          event.kind === "settlement"
            ? "Record the repayment account for this expense before syncing the payment."
            : "Complete expense accounting settings before syncing this expense."
        );
      const configuration = configured.data;
      let expenseAccountId = text(
        this.row.payloadSnapshot.categoryAccountSnapshot
      );
      let employeeId = text(this.row.payloadSnapshot.employeeIdSnapshot);
      if (
        !expenseAccountId &&
        source.category_id &&
        ["accrual", "purchase"].includes(event.kind)
      ) {
        expenseAccountId = text(
          (
            await this.one(
              "expense_accounting_category_mappings",
              "external_account_id",
              {
                connection_id: this.row.connectionId,
                category_id: source.category_id,
              }
            )
          )?.external_account_id
        );
      }
      if (
        !employeeId &&
        this.row.provider === "quickbooks" &&
        event.kind === "accrual"
      ) {
        employeeId = text(
          (
            await this.one(
              "expense_accounting_payee_mappings",
              "external_employee_id",
              {
                connection_id: this.row.connectionId,
                user_id: source.submitted_by,
              }
            )
          )?.external_employee_id
        );
      }
      const mapping: ExpenseMappingInput = {
        provider: this.row.provider,
        eventId,
        expenseId: this.row.entityId,
        kind: event.kind,
        currency: source.currency,
        date: ["settlement", "reversal"].includes(event.kind)
          ? source.recorded_at.slice(0, 10)
          : source.expense_date,
        gross: source.amount,
        tax: source.tax_amount,
        description: [
          `crew ${source.submitted_by}`,
          source.merchant_name,
          source.description,
        ]
          .filter(Boolean)
          .join(" | "),
        configuration,
        employeeId,
        expenseAccountId,
        original,
      };
      if (
        ["accrual", "purchase"].includes(event.kind) &&
        source.allocations.length
      ) {
        mapping.allocations = [];
        for (const allocation of source.allocations) {
          const project = await this.one("projects", "id", {
            id: allocation.project_id,
          });
          if (!project)
            expenseMappingError(
              "expense_project_company_mismatch",
              "An expense project does not belong to this company."
            );
          // Project choices belong to this immutable decision. Only the explicit
          // pre-write recovery RPC may adopt a later mapping; AP mappings are unrelated.
          const externalProjectId = text(
            object(this.row.payloadSnapshot.projectMappingsSnapshot)[
              allocation.project_id
            ]
          );
          if (!externalProjectId)
            expenseMappingError(
              "expense_project_mapping_required",
              "Map every allocated project in accounting before syncing this expense."
            );
          if (session.quickbooks) {
            const job = await session.quickbooks.fetchReference(
              "Customer",
              externalProjectId
            );
            if (
              job.Id !== externalProjectId ||
              job.Active !== true ||
              job.Job !== true
            )
              expenseMappingError(
                "expense_project_mapping_invalid",
                "The mapped QuickBooks project must be an active customer job."
              );
          } else {
            const category = object(
              await session.sage!.get(
                "analysis_type_categories",
                externalProjectId,
                { attributes: "all" }
              )
            );
            const parentId = text(object(category.analysis_type).id);
            const parent = parentId
              ? object(
                  await session.sage!.get("analysis_types", parentId, {
                    attributes: "all",
                  })
                )
              : {};
            if (
              category.id !== externalProjectId ||
              !sageExpenseProjectEligible(category, parent)
            )
              expenseMappingError(
                "expense_project_mapping_invalid",
                "The mapped Sage project must be a transaction analysis category enabled for journals."
              );
          }
          mapping.allocations.push({
            grossCents: expenseCents(allocation.amount, "project allocation"),
            externalProjectId,
          });
        }
      }
      // Expense-owned mappings are cleared on relink; AP mappings have no expense identity custody.
      if (
        ["accrual", "purchase"].includes(event.kind) &&
        expenseCents(source.tax_amount, "tax amount") > 0
      ) {
        const gross = expenseCents(source.amount),
          tax = expenseCents(source.tax_amount);
        if (tax >= gross)
          expenseMappingError(
            "expense_tax_invalid",
            "Receipt tax must be less than its total."
          );
        const { data, error } = await this.db
          .from("expense_accounting_tax_mappings")
          .select("tax_rate,external_tax_code_id")
          .eq("company_id", this.row.companyId)
          .eq("connection_id", this.row.connectionId)
          .eq("provider", this.row.provider);
        if (error) throw error;
        const matches = (data ?? []).filter(
          (item) =>
            Number.isFinite(Number(item.tax_rate)) &&
            Math.round(((gross - tax) * Number(item.tax_rate)) / 100) === tax
        );
        if (matches.length !== 1)
          expenseMappingError(
            "expense_tax_mapping_required",
            "Choose an unambiguous accounting tax mapping for this receipt."
          );
        mapping.taxCodeId = text(matches[0].external_tax_code_id);
        mapping.taxComponents = await this.taxComponents(
          session,
          mapping.taxCodeId!,
          source.expense_date
        );
      }
      if (session.sage && event.kind === "settlement") {
        if (!configuration.reimbursementAccountId)
          expenseMappingError(
            "expense_repayment_account_required",
            "Record the repayment bank account before syncing."
          );
        const bank = object(
          await session.sage.get(
            "bank_accounts",
            configuration.reimbursementAccountId!,
            { attributes: "all" }
          )
        );
        mapping.reimbursementLedgerAccountId = text(
          object(bank.ledger_account).id
        );
        if (
          bank.is_active !== true ||
          bank.deleted_at ||
          text(object(bank.currency).id) !== configuration.currency
        )
          expenseMappingError(
            "expense_bank_currency_mismatch",
            "Repayment account must be active and match this expense currency."
          );
      }
      const plan = buildExpensePosting(mapping);
      await this.validateReferences(
        session,
        plan.posting,
        configuration.reimbursementAccountId,
        configuration.reimbursementPaymentMethod
      );
      posting = plan.posting;
      proposed = {
        resource: plan.resource,
        body: plan.payload,
        providerEnvironment: session.environment,
        providerTargetId: session.providerTargetId,
        idempotencyId:
          this.row.provider === "quickbooks"
            ? this.row.id
            : sageIdempotencyKey(
                this.row.id,
                plan.resource as "journals" | "other_payments"
              ).id,
      };
    }
    // This also rechecks live ownership, exact connection, and predecessor completion on replay.
    const { data, error } = await this.db.rpc(
      "prepare_expense_accounting_write",
      {
        p_queue_id: this.row.id,
        p_worker_id: this.workerId,
        p_payload: proposed,
        p_posting: posting,
      }
    );
    if (error) throw error;
    return this.decodeFrozen(data, session, eventId);
  }

  private async taxComponents(
    session: ExpenseProviderSession,
    codeId: string,
    date: string
  ): Promise<ExpenseTaxComponent[]> {
    if (session.quickbooks) {
      const code = await session.quickbooks.fetchReference("TaxCode", codeId);
      if (code.Active === false)
        expenseMappingError(
          "expense_tax_inactive",
          "The mapped QuickBooks tax code is inactive."
        );
      const rates = object(code.PurchaseTaxRateList).TaxRateDetail;
      if (!Array.isArray(rates) || rates.length === 0)
        expenseMappingError(
          "expense_tax_purchase_required",
          "The mapped QuickBooks tax code has no purchase tax rates."
        );
      const result: ExpenseTaxComponent[] = [];
      for (const entry of rates) {
        const item = object(entry);
        if (
          item.TaxTypeApplicable !== undefined &&
          item.TaxTypeApplicable !== "TaxOnAmount"
        )
          expenseMappingError(
            "expense_compound_tax_review",
            "Compound receipt tax needs accounting review."
          );
        const id = text(object(item.TaxRateRef).value);
        const rate = await session.quickbooks.fetchReference("TaxRate", id);
        if (rate.Active === false || !Number.isFinite(Number(rate.RateValue)))
          expenseMappingError(
            "expense_tax_rate_invalid",
            "The mapped QuickBooks purchase tax rate is unavailable."
          );
        result.push({ id, rate: Number(rate.RateValue) });
      }
      const preferences =
        await session.quickbooks.fetchReference("Preferences");
      if (object(preferences.TaxPrefs).UsingSalesTax !== true)
        expenseMappingError(
          "expense_tax_disabled",
          "Enable the mapped tax setup in QuickBooks before syncing taxable expenses."
        );
      return result;
    }
    const rate = object(
      await session.sage!.get("tax_rates", codeId, { attributes: "all" })
    );
    if (!rate.id || rate.is_visible === false)
      expenseMappingError(
        "expense_tax_rate_invalid",
        "The mapped Sage receipt tax rate is unavailable."
      );
    const components =
      rate.is_combined_rate === true ? rate.component_tax_rates : [rate];
    if (!Array.isArray(components) || !components.length)
      expenseMappingError(
        "expense_tax_components_missing",
        "Sage tax component details need review."
      );
    return components.map((entry) => {
      const component = object(entry);
      if (component.is_combined_rate === true && text(component.id) !== codeId)
        expenseMappingError(
          "expense_nested_tax_review",
          "Nested Sage tax components need accounting review."
        );
      const history = component.percentages;
      let percentage = component.percentage;
      if (Array.isArray(history) && history.length) {
        const effective = history.filter((value) => {
          const period = object(value);
          return (
            (!period.from_date || text(period.from_date) <= date) &&
            (!period.to_date || text(period.to_date) >= date)
          );
        });
        if (effective.length !== 1)
          expenseMappingError(
            "expense_tax_date_review",
            "The receipt date has no unambiguous Sage tax rate."
          );
        percentage = object(effective[0]).percentage;
      }
      return { id: text(component.id), rate: Number(percentage) };
    });
  }

  private async validateReferences(
    session: ExpenseProviderSession,
    posting: ExpensePostingGraph,
    bankId: string | null,
    paymentMethod: string | null
  ) {
    for (const line of posting.lines) {
      if (session.quickbooks) {
        const account = await session.quickbooks.fetchReference(
          "Account",
          line.accountId
        );
        const type = text(account.AccountType);
        const allowed =
          line.role === "liability"
            ? ["Other Current Liability", "Long Term Liability"]
            : line.role === "funding"
              ? line.fundingType === "credit_card"
                ? ["Credit Card"]
                : ["Bank"]
              : [
                  "Expense",
                  "Other Expense",
                  "Cost of Goods Sold",
                  "Other Current Asset",
                  "Fixed Asset",
                  "Other Asset",
                ];
        if (account.Active !== true || !allowed.includes(type))
          expenseMappingError(
            "expense_account_type_invalid",
            "The mapped QuickBooks account is inactive or has the wrong account type for this expense."
          );
        if (
          object(account.CurrencyRef).value &&
          object(account.CurrencyRef).value !== posting.currency
        )
          expenseMappingError(
            "expense_account_currency_mismatch",
            "The mapped QuickBooks account currency does not match this expense."
          );
        if (line.employeeId) {
          const employee = await session.quickbooks.fetchReference(
            "Employee",
            line.employeeId
          );
          if (employee.Active !== true)
            expenseMappingError(
              "expense_employee_inactive",
              "The mapped QuickBooks employee is unavailable or inactive."
            );
        }
      } else {
        const account = object(
          await session.sage!.get("ledger_accounts", line.accountId, {
            attributes: "all",
          })
        );
        if (
          !account.id ||
          account.included_in_chart === false ||
          account.visible_in_journals !== true
        )
          expenseMappingError(
            "expense_account_unavailable",
            "The mapped Sage account is unavailable for journal entries."
          );
        if (line.role === "liability" && account.is_control_account === true)
          expenseMappingError(
            "expense_liability_control_account",
            "Use a dedicated crew reimbursement liability account, separate from Sage's control accounts."
          );
        if (
          line.includeOnTaxReturn &&
          (account.is_control_account !== true || !text(account.control_name))
        )
          expenseMappingError(
            "expense_tax_control_account_required",
            "Recoverable tax must map to the correct native Sage input-tax control account."
          );
        if (
          line.role === "expense" &&
          account.tax_recoverable === true &&
          Number(account.recoverable_percentage) !== 100
        )
          expenseMappingError(
            "expense_partial_tax_recovery_review",
            "This Sage expense account uses partial tax recovery. Review the receipt tax treatment before syncing."
          );
        if (
          posting.kind === "settlement" &&
          line.role === "liability" &&
          account.visible_in_other_payments !== true
        )
          expenseMappingError(
            "expense_liability_payment_unavailable",
            "The Sage reimbursement liability must be available for other payments."
          );
      }
    }
    if (session.quickbooks) {
      const company = await session.quickbooks.fetchReference(
        "CompanyInfo",
        session.providerTargetId
      );
      if (company.Country !== posting.countryCode)
        expenseMappingError(
          "expense_provider_country_mismatch",
          "Expense accounting country does not match the connected QuickBooks company."
        );
      const preferences =
        await session.quickbooks.fetchReference("Preferences");
      const homeCurrency = text(
        object(object(preferences.CurrencyPrefs).HomeCurrency).value
      );
      if (homeCurrency !== posting.currency)
        expenseMappingError(
          "expense_provider_currency_mismatch",
          "Expense currency must match the connected accounting company's home currency."
        );
    } else if (posting.kind === "settlement") {
      const bank = object(
        await session.sage!.get("bank_accounts", bankId!, { attributes: "all" })
      );
      const method = object(
        await session.sage!.get("payment_methods", paymentMethod!, {
          attributes: "all",
        })
      );
      if (!bank.id || bank.is_active !== true || bank.deleted_at || !method.id)
        expenseMappingError(
          "expense_payment_mapping_invalid",
          "The Sage repayment bank account or payment method is unavailable."
        );
    }
  }
}
