import "server-only";

import { getServiceRoleClient } from "@/lib/supabase/server-client";

import type { SupplierBillIntakeStage } from "./intake-contracts";

type QueryError = { code?: string; message?: string } | null;
type QueryResult = { data: unknown; error: QueryError };
type QueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  is(column: string, value: null): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};
type QueryClient = {
  from(table: string): QueryBuilder;
};

export interface SupplierBillIntakeDuplicateCandidate {
  id: string;
  normalizedSupplierName: string;
  normalizedInvoiceNumber: string;
  sourceSha256: string;
}

export interface SupplierBillIntakeRepositoryContract {
  list(companyId: string, stage?: SupplierBillIntakeStage): Promise<unknown[]>;
  detail(companyId: string, intakeId: string): Promise<unknown | null>;
  duplicateCandidates(
    companyId: string,
    normalizedSupplierName: string,
    normalizedInvoiceNumber: string
  ): Promise<SupplierBillIntakeDuplicateCandidate[]>;
}

export class SupplierBillIntakeRepository implements SupplierBillIntakeRepositoryContract {
  private readonly client: QueryClient;

  constructor(client?: QueryClient) {
    this.client = client ?? (getServiceRoleClient() as unknown as QueryClient);
  }

  async list(
    companyId: string,
    stage?: SupplierBillIntakeStage
  ): Promise<unknown[]> {
    let query = this.client
      .from("supplier_bill_intakes")
      .select(
        "id,company_id,document_kind,review_stage,supplier_name,invoice_number,invoice_date,due_date,currency,total,payment_owner_id,planned_payment_date,hold_reason,next_action,revision,created_at,updated_at,promoted_bill_id"
      )
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (stage) query = query.eq("review_stage", stage);
    const result = await query;
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data : [];
  }

  async detail(companyId: string, intakeId: string): Promise<unknown | null> {
    const [intake, lines, checks, document, events] = await Promise.all([
      this.client
        .from("supplier_bill_intakes")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", intakeId)
        .is("deleted_at", null)
        .maybeSingle(),
      this.client
        .from("supplier_bill_intake_line_items")
        .select("*,supplier_bill_intake_allocations(*)")
        .eq("company_id", companyId)
        .eq("intake_id", intakeId)
        .order("position", { ascending: true }),
      this.client
        .from("supplier_bill_intake_checks")
        .select("*")
        .eq("company_id", companyId)
        .eq("intake_id", intakeId)
        .order("check_key", { ascending: true }),
      this.client
        .from("supplier_bill_intake_documents")
        .select("*")
        .eq("company_id", companyId)
        .eq("intake_id", intakeId)
        .maybeSingle(),
      this.client
        .from("supplier_bill_intake_events")
        .select("*")
        .eq("company_id", companyId)
        .eq("intake_id", intakeId)
        .order("created_at", { ascending: true }),
    ]);
    for (const result of [intake, lines, checks, document, events]) {
      if (result.error) throw result.error;
    }
    if (!intake.data) return null;
    return {
      intake: intake.data,
      lines: Array.isArray(lines.data) ? lines.data : [],
      checks: Array.isArray(checks.data) ? checks.data : [],
      document: document.data ?? null,
      events: Array.isArray(events.data) ? events.data : [],
    };
  }

  async duplicateCandidates(
    companyId: string,
    normalizedSupplierName: string,
    normalizedInvoiceNumber: string
  ): Promise<SupplierBillIntakeDuplicateCandidate[]> {
    const result = await this.client
      .from("supplier_bill_intakes")
      .select(
        "id,normalized_supplier_name,normalized_invoice_number,supplier_bill_intake_documents!inner(sha256)"
      )
      .eq("company_id", companyId)
      .eq("normalized_supplier_name", normalizedSupplierName)
      .eq("normalized_invoice_number", normalizedInvoiceNumber)
      .is("deleted_at", null);
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) return [];
    return result.data.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const value = row as Record<string, unknown>;
      const nested = value.supplier_bill_intake_documents;
      const document = Array.isArray(nested) ? nested[0] : nested;
      if (!document || typeof document !== "object") return [];
      const sha256 = (document as Record<string, unknown>).sha256;
      if (
        typeof value.id !== "string" ||
        typeof value.normalized_supplier_name !== "string" ||
        typeof value.normalized_invoice_number !== "string" ||
        typeof sha256 !== "string"
      ) {
        return [];
      }
      return [
        {
          id: value.id,
          normalizedSupplierName: value.normalized_supplier_name,
          normalizedInvoiceNumber: value.normalized_invoice_number,
          sourceSha256: sha256,
        },
      ];
    });
  }
}
