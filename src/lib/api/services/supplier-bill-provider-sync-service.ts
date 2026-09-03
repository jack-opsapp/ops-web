import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ProviderMappingError,
  buildQuickBooksBillPayload,
  buildQuickBooksBillPaymentPayload,
  buildQuickBooksSupplierPayload,
  buildSageContactPaymentPayload,
  buildSagePurchaseInvoicePayload,
  buildSageSupplierPayload,
  type ProviderBillSource,
  type ProviderProjectAllocation,
  type SupplierPayloadSource,
} from "@/lib/accounting/supplier-bills/provider-mappers";

import type {
  AccountingSyncQueueRow,
  SupplierBillSyncEntityType,
} from "./accounting-sync-queue-types";
import type { QuickBooksEnvironment } from "./quickbooks-config";
import { QuickBooksWriteService } from "./quickbooks-write-service";
import { SagePurchasingService } from "./sage-purchasing-service";

type DbRow = Record<string, unknown>;
type ApQueueRow = AccountingSyncQueueRow<SupplierBillSyncEntityType>;

export class SupplierBillSyncDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierBillSyncDependencyError";
  }
}

export interface SupplierBillProviderWriteResult {
  externalId: string;
  syncToken: string | null;
  providerUpdatedAt: string | null;
}

interface ProviderServices {
  quickBooks?: QuickBooksWriteService;
  sage?: SagePurchasingService;
}

function text(value: unknown): string {
  return String(value ?? "");
}

function nullableText(value: unknown): string | null {
  const result =
    value === null || value === undefined ? "" : String(value).trim();
  return result || null;
}

function money(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ProviderMappingError(
      "invalid_provider_amount",
      "Provider amount is invalid."
    );
  }
  return parsed.toFixed(2);
}

function taxKey(value: unknown): string {
  return Number(value).toFixed(4);
}

function supplierSource(row: DbRow): SupplierPayloadSource {
  return {
    displayName: text(row.display_name),
    email: nullableText(row.email),
    phone: nullableText(row.phone),
    taxNumber: nullableText(row.tax_number),
  };
}

export class SupplierBillProviderSyncService {
  // New AP tables are introduced by this release migration, ahead of generated
  // database types. Keep this adapter isolated until post-deploy type refresh.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly db: any;
  private readonly services: ProviderServices;

  constructor(
    supabase: SupabaseClient,
    private readonly row: ApQueueRow,
    input: {
      accessToken: string;
      realmId: string | null;
      providerEnvironment: QuickBooksEnvironment;
      quickBooks?: QuickBooksWriteService;
      sage?: SagePurchasingService;
    }
  ) {
    this.db = supabase;
    this.services = {
      quickBooks:
        input.quickBooks ??
        (row.provider === "quickbooks" && input.realmId
          ? new QuickBooksWriteService({
              realmId: input.realmId,
              accessToken: input.accessToken,
              environment: input.providerEnvironment,
            })
          : undefined),
      sage:
        input.sage ??
        (row.provider === "sage"
          ? new SagePurchasingService({ accessToken: input.accessToken })
          : undefined),
    };
  }

  async write(): Promise<SupplierBillProviderWriteResult> {
    if (this.row.entityType === "supplier") return this.writeSupplier();
    if (this.row.entityType === "supplier_bill") return this.writeBill();
    return this.writePayment();
  }

  private async single(table: string, id: string): Promise<DbRow> {
    const { data, error } = await this.db
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", this.row.companyId)
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new SupplierBillSyncDependencyError(
        `${table} source row is unavailable.`
      );
    return data as DbRow;
  }

  private async link(entityType: SupplierBillSyncEntityType, entityId: string) {
    const { data, error } = await this.db
      .from("supplier_bill_provider_links")
      .select("external_id, sync_token, provider_updated_at")
      .eq("connection_id", this.row.connectionId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .maybeSingle();
    if (error) throw error;
    return data as DbRow | null;
  }

  private async requireLink(
    entityType: SupplierBillSyncEntityType,
    entityId: string
  ) {
    const link = await this.link(entityType, entityId);
    if (!link?.external_id) {
      throw new SupplierBillSyncDependencyError(
        `${entityType} provider identity is not ready yet.`
      );
    }
    return link;
  }

  private qbo(): QuickBooksWriteService {
    if (!this.services.quickBooks) {
      throw new ProviderMappingError(
        "qbo_connection_invalid",
        "QuickBooks realm and access token are required."
      );
    }
    return this.services.quickBooks;
  }

  private sage(): SagePurchasingService {
    if (!this.services.sage) {
      throw new ProviderMappingError(
        "sage_connection_invalid",
        "Sage access token is required."
      );
    }
    return this.services.sage;
  }

  private async quickBooksSyncToken(
    entity: "Vendor" | "Bill",
    externalId: string,
    cachedToken: unknown
  ): Promise<string> {
    const cached = nullableText(cachedToken);
    if (cached) return cached;

    const current = await this.qbo().fetchCurrent(entity, externalId);
    const body = current[entity] as DbRow | undefined;
    const fetched = nullableText(body?.SyncToken);
    if (!fetched) {
      throw new SupplierBillSyncDependencyError(
        `QuickBooks ${entity} sync token is unavailable.`
      );
    }
    return fetched;
  }

  private async writeSupplier(): Promise<SupplierBillProviderWriteResult> {
    const supplier = await this.single("suppliers", this.row.entityId);
    const link = await this.link("supplier", this.row.entityId);
    if (this.row.provider === "quickbooks") {
      const payload = buildQuickBooksSupplierPayload(supplierSource(supplier));
      const externalId = nullableText(link?.external_id);
      const result = externalId
        ? await this.qbo().update(
            "Vendor",
            {
              ...payload,
              Id: externalId,
              SyncToken: await this.quickBooksSyncToken(
                "Vendor",
                externalId,
                link?.sync_token
              ),
              sparse: true,
            },
            this.row.id
          )
        : await this.qbo().create("Vendor", payload, this.row.id);
      return {
        externalId: result.qbId,
        syncToken: result.syncToken,
        providerUpdatedAt: result.metaUpdatedAt,
      };
    }
    const payload = buildSageSupplierPayload(supplierSource(supplier));
    const result = link?.external_id
      ? await this.sage().update("contacts", text(link.external_id), payload)
      : await this.sage().create("contacts", payload);
    return {
      externalId: result.sageId,
      syncToken: null,
      providerUpdatedAt: null,
    };
  }

  private async billSource(bill: DbRow): Promise<ProviderBillSource> {
    const supplier = await this.single("suppliers", text(bill.supplier_id));
    const { data: lineData, error: lineError } = await this.db
      .from("supplier_bill_line_items")
      .select("*")
      .eq("bill_id", this.row.entityId)
      .eq("company_id", this.row.companyId)
      .order("position");
    if (lineError) throw lineError;
    const lines = (lineData ?? []) as DbRow[];
    if (lines.length === 0)
      throw new SupplierBillSyncDependencyError("Bill lines are unavailable.");

    const lineIds = lines.map((line) => text(line.id));
    const categoryIds = [
      ...new Set(lines.map((line) => text(line.category_id))),
    ];
    const { data: allocationData, error: allocationError } = await this.db
      .from("supplier_bill_project_allocations")
      .select("line_item_id, project_id, amount")
      .in("line_item_id", lineIds)
      .eq("company_id", this.row.companyId);
    if (allocationError) throw allocationError;
    const allocations = (allocationData ?? []) as DbRow[];

    const { data: categoryData, error: categoryError } = await this.db
      .from("accounting_category_mappings")
      .select("expense_category_id, external_account_id")
      .eq("company_id", this.row.companyId)
      .eq("provider", this.row.provider)
      .in("expense_category_id", categoryIds);
    if (categoryError) throw categoryError;
    const accounts = new Map(
      ((categoryData ?? []) as DbRow[]).map((mapping) => [
        text(mapping.expense_category_id),
        text(mapping.external_account_id),
      ])
    );

    const { data: taxData, error: taxError } = await this.db
      .from("supplier_bill_tax_mappings")
      .select("tax_rate, external_tax_code_id")
      .eq("connection_id", this.row.connectionId)
      .eq("company_id", this.row.companyId)
      .eq("provider", this.row.provider);
    if (taxError) throw taxError;
    const taxes = new Map(
      ((taxData ?? []) as DbRow[]).map((mapping) => [
        taxKey(mapping.tax_rate),
        text(mapping.external_tax_code_id),
      ])
    );

    let projects = new Map<string, string>();
    if (this.row.provider === "quickbooks") {
      const projectIds = [
        ...new Set(
          allocations.map((allocation) => text(allocation.project_id))
        ),
      ];
      const { data: projectData, error: projectError } = await this.db
        .from("supplier_bill_project_mappings")
        .select("project_id, external_project_id")
        .eq("connection_id", this.row.connectionId)
        .eq("company_id", this.row.companyId)
        .eq("provider", this.row.provider)
        .in("project_id", projectIds);
      if (projectError) throw projectError;
      projects = new Map(
        ((projectData ?? []) as DbRow[]).map((mapping) => [
          text(mapping.project_id),
          text(mapping.external_project_id),
        ])
      );
    }

    return {
      supplier: supplierSource(supplier),
      invoiceNumber: text(bill.invoice_number),
      invoiceDate: text(bill.invoice_date),
      dueDate: nullableText(bill.due_date),
      currency: text(bill.currency),
      subtotal: money(bill.subtotal),
      taxTotal: money(bill.tax_total),
      total: money(bill.total),
      lines: lines.map((line) => {
        const projectAllocations: ProviderProjectAllocation[] = allocations
          .filter(
            (allocation) => text(allocation.line_item_id) === text(line.id)
          )
          .map((allocation) => ({
            externalProjectId:
              this.row.provider === "quickbooks"
                ? (projects.get(text(allocation.project_id)) ?? null)
                : null,
            amount: money(allocation.amount),
          }));
        return {
          id: text(line.id),
          description: text(line.description),
          quantity: text(line.quantity),
          unitPrice: money(line.unit_price),
          subtotal: money(line.subtotal),
          taxAmount: money(line.tax_amount),
          total: money(line.total),
          externalAccountId: accounts.get(text(line.category_id)) ?? null,
          externalTaxCodeId: taxes.get(taxKey(line.tax_rate)) ?? null,
          projectAllocations,
        };
      }),
    };
  }

  private async writeBill(): Promise<SupplierBillProviderWriteResult> {
    const bill = await this.single("supplier_bills", this.row.entityId);
    const link = await this.link("supplier_bill", this.row.entityId);
    if (this.row.operation === "void") {
      const externalId = text(link?.external_id);
      if (!externalId) {
        throw new ProviderMappingError(
          "provider_bill_link_required",
          "Provider bill identity is required before voiding."
        );
      }
      if (this.row.provider === "quickbooks") {
        const syncToken = await this.quickBooksSyncToken(
          "Bill",
          externalId,
          link?.sync_token
        );
        const result = await this.qbo().void(
          "Bill",
          { Id: externalId, SyncToken: syncToken },
          this.row.id
        );
        return {
          externalId: result.qbId,
          syncToken: result.syncToken,
          providerUpdatedAt: result.metaUpdatedAt,
        };
      }
      await this.sage().delete("purchase_invoices", externalId);
      return { externalId, syncToken: null, providerUpdatedAt: null };
    }

    const supplierLink = await this.requireLink(
      "supplier",
      text(bill.supplier_id)
    );
    const source = await this.billSource(bill);
    if (this.row.provider === "quickbooks") {
      const payload = buildQuickBooksBillPayload(
        source,
        text(supplierLink.external_id)
      );
      const externalId = nullableText(link?.external_id);
      const result = externalId
        ? await this.qbo().update(
            "Bill",
            {
              ...payload,
              Id: externalId,
              SyncToken: await this.quickBooksSyncToken(
                "Bill",
                externalId,
                link?.sync_token
              ),
            },
            this.row.id
          )
        : await this.qbo().create("Bill", payload, this.row.id);
      return {
        externalId: result.qbId,
        syncToken: result.syncToken,
        providerUpdatedAt: result.metaUpdatedAt,
      };
    }
    const payload = buildSagePurchaseInvoicePayload(
      source,
      text(supplierLink.external_id)
    );
    const result = link?.external_id
      ? await this.sage().update(
          "purchase_invoices",
          text(link.external_id),
          payload
        )
      : await this.sage().create("purchase_invoices", payload);
    return {
      externalId: result.sageId,
      syncToken: null,
      providerUpdatedAt: null,
    };
  }

  private async writePayment(): Promise<SupplierBillProviderWriteResult> {
    const payment = await this.single(
      "supplier_bill_payments",
      this.row.entityId
    );
    const bill = await this.single("supplier_bills", text(payment.bill_id));
    const supplierLink = await this.requireLink(
      "supplier",
      text(bill.supplier_id)
    );
    const billLink = await this.requireLink("supplier_bill", text(bill.id));
    const { data: mapping, error } = await this.db
      .from("supplier_bill_payment_account_mappings")
      .select("external_account_id, external_payment_method_id")
      .eq("connection_id", this.row.connectionId)
      .eq("company_id", this.row.companyId)
      .eq("provider", this.row.provider)
      .eq("payment_method", text(payment.payment_method))
      .maybeSingle();
    if (error) throw error;

    if (this.row.provider === "quickbooks") {
      const payload = buildQuickBooksBillPaymentPayload({
        vendorId: text(supplierLink.external_id),
        billId: text(billLink.external_id),
        amount: money(payment.amount),
        paymentDate: text(payment.payment_date),
        paymentMethod:
          payment.payment_method === "credit_card" ? "credit_card" : "check",
        bankAccountId: nullableText(mapping?.external_account_id),
        reference: nullableText(payment.reference),
      });
      const result = await this.qbo().create(
        "BillPayment",
        payload,
        this.row.id
      );
      return {
        externalId: result.qbId,
        syncToken: result.syncToken,
        providerUpdatedAt: result.metaUpdatedAt,
      };
    }
    const payload = buildSageContactPaymentPayload({
      vendorId: text(supplierLink.external_id),
      billId: text(billLink.external_id),
      amount: money(payment.amount),
      paymentDate: text(payment.payment_date),
      bankAccountId: nullableText(mapping?.external_account_id),
      paymentMethodId: nullableText(mapping?.external_payment_method_id),
      reference: nullableText(payment.reference),
    });
    const result = await this.sage().create("contact_payments", payload);
    return {
      externalId: result.sageId,
      syncToken: null,
      providerUpdatedAt: null,
    };
  }
}
