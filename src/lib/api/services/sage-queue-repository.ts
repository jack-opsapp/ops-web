import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountingSyncQueueRow } from "./accounting-sync-queue-types";
import {
  type PreparedSageQueueWrite,
  type SageQueueConnection,
} from "./sage-queue-processor";
import {
  buildSageContact,
  buildSageContactPayment,
  buildSageSalesDocument,
  SageMappingError,
  type SageLineSource,
  type SageSalesResource,
} from "./sage-push-mappers";

type DbRow = Record<string, unknown>;

function value(input: unknown): string {
  return String(input ?? "").trim();
}

function nullable(input: unknown): string | null {
  const result = value(input);
  return result || null;
}

function sourceSnapshot(row: AccountingSyncQueueRow): DbRow {
  const snapshot = row.payloadSnapshot.snapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as DbRow)
    : {};
}

function providerEnvironment(input: unknown): "sandbox" | "production" {
  if (input === "sandbox" || input === "production") return input;
  throw new SageMappingError(
    "sage_connection_environment_invalid",
    "Sage connection environment is invalid."
  );
}

function salesResource(row: DbRow): SageSalesResource {
  return row.sage_document_kind === "sales_estimate"
    ? "sales_estimates"
    : "sales_quotes";
}

function sourceAccountKeys(line: DbRow): string[] {
  const keys: string[] = [];
  if (nullable(line.product_id)) keys.push(`product:${value(line.product_id)}`);
  const taskType = nullable(line.task_type_id) ?? nullable(line.task_type_ref);
  if (taskType) keys.push(`task_type:${taskType}`);
  if (nullable(line.category)) {
    keys.push(`category:${value(line.category).toLowerCase()}`);
  }
  keys.push("default:*");
  return keys;
}

function sourceTaxKey(line: DbRow): string {
  if (line.is_taxable === false) return "non_taxable";
  const taxRateId = nullable(line.tax_rate_id);
  return taxRateId ? `tax_rate:${taxRateId}` : "taxable_default";
}

export class SageQueueRepository {
  // Sage mapping tables ship in the same unreleased migration as this worker.
  // Keep the ungenerated portion isolated while preserving typed Supabase at
  // every external boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly db: any;

  constructor(supabase: SupabaseClient) {
    this.db = supabase;
  }

  async loadConnection(
    row: AccountingSyncQueueRow
  ): Promise<SageQueueConnection | null> {
    const { data, error } = await this.db
      .from("accounting_connections")
      .select(
        "id, company_id, provider, provider_environment, is_connected, sync_enabled, sync_direction, sage_business_id"
      )
      .eq("id", row.connectionId)
      .eq("company_id", row.companyId)
      .eq("provider", "sage")
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: value(data.id),
      companyId: value(data.company_id),
      provider: value(data.provider),
      providerEnvironment: providerEnvironment(data.provider_environment),
      isConnected: data.is_connected === true,
      syncEnabled: data.sync_enabled === true,
      syncDirection: value(data.sync_direction),
      encryptedBusinessId: nullable(data.sage_business_id),
    };
  }

  async prepare(
    row: AccountingSyncQueueRow,
    _connection: SageQueueConnection
  ): Promise<PreparedSageQueueWrite> {
    switch (row.entityType) {
      case "customer":
        return this.prepareCustomer(row);
      case "invoice":
        return this.prepareInvoice(row);
      case "estimate":
        return this.prepareEstimate(row);
      case "payment":
        return this.preparePayment(row);
      default:
        throw new SageMappingError(
          "sage_queue_entity_unsupported",
          `Sage core queue cannot prepare ${row.entityType}.`
        );
    }
  }

  private async single(
    table: string,
    id: string,
    companyId: string
  ): Promise<DbRow | null> {
    const { data, error } = await this.db
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    return (data as DbRow | null) ?? null;
  }

  private async rows(
    table: string,
    filters: Array<[string, unknown]>,
    order?: string
  ): Promise<DbRow[]> {
    let query = this.db.from(table).select("*");
    for (const [column, filter] of filters) {
      query =
        filter === null ? query.is(column, null) : query.eq(column, filter);
    }
    if (order) query = query.order(order, { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as DbRow[];
  }

  private finalizeCore(
    table: "clients" | "invoices" | "estimates" | "payments",
    row: AccountingSyncQueueRow,
    sourceExists: boolean
  ): (externalId: string) => Promise<void> {
    if (!sourceExists) return async () => undefined;
    return async (externalId: string) => {
      const { data, error } = await this.db
        .from(table)
        .update({ sage_id: externalId })
        .eq("id", row.entityId)
        .eq("company_id", row.companyId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new Error(
          `OPS ${row.entityType} identity finalization lost its source row.`
        );
      }
    };
  }

  private async prepareCustomer(
    row: AccountingSyncQueueRow
  ): Promise<PreparedSageQueueWrite> {
    const source = await this.single("clients", row.entityId, row.companyId);
    const fallback = sourceSnapshot(row);
    const contact = source ?? fallback;
    if (!source && !["inactivate", "delete_soft"].includes(row.operation)) {
      throw new SageMappingError(
        "sage_customer_missing",
        "OPS customer row is unavailable."
      );
    }
    const payload = buildSageContact({
      name: value(contact.name),
      kind: "customer",
      email: nullable(contact.email),
      phone: nullable(contact.phone ?? contact.phone_number),
    });
    if (["inactivate", "delete_soft"].includes(row.operation)) {
      payload.active = false;
    }
    return {
      resource: "contacts",
      payload,
      externalId: nullable(source?.sage_id) ?? row.externalId,
      finalize: this.finalizeCore("clients", row, Boolean(source)),
    };
  }

  private async mappedSalesLines(
    row: AccountingSyncQueueRow,
    documentColumn: "invoice_id" | "estimate_id"
  ): Promise<SageLineSource[]> {
    const lines = await this.rows(
      "line_items",
      [
        [documentColumn, row.entityId],
        ["company_id", row.companyId],
      ],
      "sort_order"
    );
    if (lines.length === 0) {
      throw new SageMappingError(
        "sage_lines_required",
        "Sage financial document has no OPS lines."
      );
    }
    const [accountMappings, taxMappings] = await Promise.all([
      this.rows("sage_sales_account_mappings", [
        ["connection_id", row.connectionId],
        ["company_id", row.companyId],
      ]),
      this.rows("sage_tax_rate_mappings", [
        ["connection_id", row.connectionId],
        ["company_id", row.companyId],
      ]),
    ]);
    const accounts = new Map(
      accountMappings.map((mapping) => [
        `${value(mapping.source_kind)}:${value(mapping.source_key)}`,
        value(mapping.sage_ledger_account_id),
      ])
    );
    const taxes = new Map(
      taxMappings.map((mapping) => [
        value(mapping.source_tax_key),
        value(mapping.sage_tax_rate_id),
      ])
    );
    return lines.map((line) => {
      const subtotal = nullable(line.line_total) ?? nullable(line.amount);
      if (!subtotal) {
        throw new SageMappingError(
          "sage_line_total_required",
          "Sage financial document line total is unavailable."
        );
      }
      return {
        description: nullable(line.description) ?? value(line.name),
        quantity: value(line.quantity),
        unitPrice: value(line.unit_price),
        subtotal,
        ledgerAccountId:
          sourceAccountKeys(line)
            .map((key) => accounts.get(key))
            .find(Boolean) ?? null,
        taxRateId: taxes.get(sourceTaxKey(line)) ?? null,
      };
    });
  }

  private async prepareInvoice(
    row: AccountingSyncQueueRow
  ): Promise<PreparedSageQueueWrite> {
    const invoice = await this.single("invoices", row.entityId, row.companyId);
    const snapshot = sourceSnapshot(row);
    const source = invoice ?? snapshot;
    const externalId = nullable(invoice?.sage_id) ?? row.externalId;
    if (row.operation === "void") {
      return {
        resource: "sales_invoices",
        payload: {},
        externalId,
        finalize: this.finalizeCore("invoices", row, Boolean(invoice)),
      };
    }
    if (!invoice) {
      throw new SageMappingError(
        "sage_invoice_missing",
        "OPS invoice row is unavailable."
      );
    }
    const clientId = value(source.client_id ?? source.client_ref);
    const client = await this.single("clients", clientId, row.companyId);
    if (!client?.sage_id) {
      throw new SageMappingError(
        "sage_invoice_customer_missing",
        "Sage customer identity is required before the invoice."
      );
    }
    return {
      resource: "sales_invoices",
      payload: buildSageSalesDocument("sales_invoices", {
        contactId: value(client.sage_id),
        date: value(invoice.issue_date),
        dueOrExpiryDate: value(invoice.due_date),
        reference: value(invoice.invoice_number),
        lines: await this.mappedSalesLines(row, "invoice_id"),
      }),
      externalId,
      finalize: this.finalizeCore("invoices", row, true),
    };
  }

  private async prepareEstimate(
    row: AccountingSyncQueueRow
  ): Promise<PreparedSageQueueWrite> {
    const estimate = await this.single(
      "estimates",
      row.entityId,
      row.companyId
    );
    const snapshot = sourceSnapshot(row);
    const source = estimate ?? snapshot;
    const resource = salesResource(source);
    const externalId = nullable(estimate?.sage_id) ?? row.externalId;
    if (row.operation === "delete") {
      return {
        resource,
        payload: {},
        externalId,
        finalize: this.finalizeCore("estimates", row, Boolean(estimate)),
      };
    }
    if (!estimate) {
      throw new SageMappingError(
        "sage_estimate_missing",
        "OPS estimate row is unavailable."
      );
    }
    const clientId = value(source.client_id ?? source.client_ref);
    const client = await this.single("clients", clientId, row.companyId);
    if (!client?.sage_id) {
      throw new SageMappingError(
        "sage_estimate_customer_missing",
        "Sage customer identity is required before the estimate."
      );
    }
    return {
      resource,
      payload: buildSageSalesDocument(resource, {
        contactId: value(client.sage_id),
        date: value(estimate.issue_date),
        dueOrExpiryDate: value(estimate.expiration_date),
        reference: value(estimate.estimate_number),
        lines: await this.mappedSalesLines(row, "estimate_id"),
      }),
      externalId,
      finalize: this.finalizeCore("estimates", row, true),
    };
  }

  private async preparePayment(
    row: AccountingSyncQueueRow
  ): Promise<PreparedSageQueueWrite> {
    const payment = await this.single("payments", row.entityId, row.companyId);
    const externalId = nullable(payment?.sage_id) ?? row.externalId;
    if (row.operation === "void") {
      return {
        resource: "contact_payments",
        payload: {},
        externalId,
        finalize: this.finalizeCore("payments", row, Boolean(payment)),
      };
    }
    if (!payment) {
      throw new SageMappingError(
        "sage_payment_missing",
        "OPS payment row is unavailable."
      );
    }
    const [client, invoice, mapping] = await Promise.all([
      this.single("clients", value(payment.client_id), row.companyId),
      this.single("invoices", value(payment.invoice_id), row.companyId),
      this.paymentMapping(row, value(payment.payment_method)),
    ]);
    if (!client?.sage_id || !invoice?.sage_id) {
      throw new SageMappingError(
        "sage_payment_dependency_missing",
        "Sage customer and invoice identities are required before the payment."
      );
    }
    return {
      resource: "contact_payments",
      payload: buildSageContactPayment({
        transactionType: "CUSTOMER_RECEIPT",
        contactId: value(client.sage_id),
        bankAccountId: nullable(mapping?.sage_bank_account_id),
        paymentMethodId: nullable(mapping?.sage_payment_method_id),
        date: value(payment.payment_date),
        amount: value(payment.amount),
        allocations: [
          { artefactId: value(invoice.sage_id), amount: value(payment.amount) },
        ],
        reference: nullable(payment.reference_number),
      }),
      externalId,
      finalize: this.finalizeCore("payments", row, true),
    };
  }

  private async paymentMapping(
    row: AccountingSyncQueueRow,
    paymentMethod: string
  ): Promise<DbRow | null> {
    const exact = await this.rows("sage_payment_method_mappings", [
      ["connection_id", row.connectionId],
      ["company_id", row.companyId],
      ["payment_method", paymentMethod],
    ]);
    if (exact[0]) return exact[0];
    const fallback = await this.rows("sage_payment_method_mappings", [
      ["connection_id", row.connectionId],
      ["company_id", row.companyId],
      ["payment_method", "default"],
    ]);
    return fallback[0] ?? null;
  }
}
