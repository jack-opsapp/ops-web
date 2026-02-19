/**
 * OPS Web - Estimate Service
 *
 * CRUD operations for Estimates using Supabase.
 * Line items are stored as separate rows in the `line_items` table.
 * Document numbers are generated server-side via RPC.
 *
 * IMPORTANT:
 *   - `line_total` is GENERATED ALWAYS — never include in INSERT/UPDATE.
 *   - `estimate_number` via RPC `get_next_document_number`.
 *   - `convert_estimate_to_invoice` is an atomic RPC.
 */

import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  Estimate,
  CreateEstimate,
  LineItem,
  CreateLineItem,
} from "@/lib/types/pipeline";
import { EstimateStatus, DiscountType } from "@/lib/types/pipeline";

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchEstimatesOptions {
  status?: EstimateStatus;
  clientId?: string;
  projectId?: string;
  opportunityId?: string;
  includeDeleted?: boolean;
}

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapEstimateFromDb(row: Record<string, unknown>): Estimate {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    opportunityId: (row.opportunity_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    clientId: row.client_id as string,
    estimateNumber: row.estimate_number as string,
    version: Number(row.version ?? 1),
    parentId: (row.parent_id as string) ?? null,

    // Content
    title: (row.title as string) ?? null,
    clientMessage: (row.client_message as string) ?? null,
    internalNotes: (row.internal_notes as string) ?? null,
    terms: (row.terms as string) ?? null,

    // Pricing
    subtotal: Number(row.subtotal ?? 0),
    discountType: (row.discount_type as DiscountType) ?? null,
    discountValue: row.discount_value != null ? Number(row.discount_value) : null,
    discountAmount: Number(row.discount_amount ?? 0),
    taxRate: row.tax_rate != null ? Number(row.tax_rate) : null,
    taxAmount: Number(row.tax_amount ?? 0),
    total: Number(row.total ?? 0),

    // Payment schedule
    depositType: (row.deposit_type as DiscountType) ?? null,
    depositValue: row.deposit_value != null ? Number(row.deposit_value) : null,
    depositAmount: row.deposit_amount != null ? Number(row.deposit_amount) : null,

    // Status
    status: row.status as EstimateStatus,
    issueDate: parseDateRequired(row.issue_date),
    expirationDate: parseDate(row.expiration_date),
    sentAt: parseDate(row.sent_at),
    viewedAt: parseDate(row.viewed_at),
    approvedAt: parseDate(row.approved_at),

    // PDF
    pdfStoragePath: (row.pdf_storage_path as string) ?? null,

    // System
    createdBy: (row.created_by as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapEstimateToDb(
  data: Partial<CreateEstimate>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.opportunityId !== undefined) row.opportunity_id = data.opportunityId;
  if (data.clientId !== undefined) row.client_id = data.clientId;
  if (data.version !== undefined) row.version = data.version;
  if (data.parentId !== undefined) row.parent_id = data.parentId;

  // Content
  if (data.title !== undefined) row.title = data.title;
  if (data.clientMessage !== undefined) row.client_message = data.clientMessage;
  if (data.internalNotes !== undefined) row.internal_notes = data.internalNotes;
  if (data.terms !== undefined) row.terms = data.terms;

  // Pricing
  if (data.subtotal !== undefined) row.subtotal = data.subtotal;
  if (data.discountType !== undefined) row.discount_type = data.discountType;
  if (data.discountValue !== undefined) row.discount_value = data.discountValue;
  if (data.discountAmount !== undefined) row.discount_amount = data.discountAmount;
  if (data.taxRate !== undefined) row.tax_rate = data.taxRate;
  if (data.taxAmount !== undefined) row.tax_amount = data.taxAmount;
  if (data.total !== undefined) row.total = data.total;

  // Payment schedule
  if (data.depositType !== undefined) row.deposit_type = data.depositType;
  if (data.depositValue !== undefined) row.deposit_value = data.depositValue;
  if (data.depositAmount !== undefined) row.deposit_amount = data.depositAmount;

  // Status
  if (data.status !== undefined) row.status = data.status;
  if (data.issueDate !== undefined) {
    row.issue_date = data.issueDate instanceof Date
      ? data.issueDate.toISOString()
      : data.issueDate;
  }
  if (data.expirationDate !== undefined) {
    row.expiration_date = data.expirationDate
      ? data.expirationDate instanceof Date
        ? data.expirationDate.toISOString()
        : data.expirationDate
      : null;
  }
  if (data.sentAt !== undefined) {
    row.sent_at = data.sentAt
      ? data.sentAt instanceof Date ? data.sentAt.toISOString() : data.sentAt
      : null;
  }
  if (data.viewedAt !== undefined) {
    row.viewed_at = data.viewedAt
      ? data.viewedAt instanceof Date ? data.viewedAt.toISOString() : data.viewedAt
      : null;
  }
  if (data.approvedAt !== undefined) {
    row.approved_at = data.approvedAt
      ? data.approvedAt instanceof Date ? data.approvedAt.toISOString() : data.approvedAt
      : null;
  }

  // PDF
  if (data.pdfStoragePath !== undefined) row.pdf_storage_path = data.pdfStoragePath;

  // System
  if (data.createdBy !== undefined) row.created_by = data.createdBy;

  return row;
}

function mapLineItemFromDb(row: Record<string, unknown>): LineItem {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    estimateId: (row.estimate_id as string) ?? null,
    invoiceId: (row.invoice_id as string) ?? null,
    productId: (row.product_id as string) ?? null,

    // Type & template linkage
    type: (row.type as string as import("@/lib/types/pipeline").LineItemType) ?? "MATERIAL",
    taskTypeId: (row.task_type_id as string) ?? null,

    // Content
    name: row.name as string,
    description: (row.description as string) ?? null,
    quantity: Number(row.quantity ?? 0),
    unit: (row.unit as string) ?? "each",
    unitPrice: Number(row.unit_price ?? 0),
    unitCost: row.unit_cost != null ? Number(row.unit_cost) : null,
    discountPercent: Number(row.discount_percent ?? 0),
    isTaxable: (row.is_taxable as boolean) ?? false,
    taxRateId: (row.tax_rate_id as string) ?? null,

    // Calculated (DB-generated)
    lineTotal: Number(row.line_total ?? 0),

    // Estimate-specific
    isOptional: (row.is_optional as boolean) ?? false,
    isSelected: (row.is_selected as boolean) ?? true,

    // Display
    sortOrder: Number(row.sort_order ?? 0),
    category: (row.category as string) ?? null,
    serviceDate: parseDate(row.service_date),

    createdAt: parseDate(row.created_at),
  };
}

/**
 * Map a CreateLineItem to DB row. NEVER includes line_total (GENERATED ALWAYS).
 */
function mapLineItemToDb(
  data: Partial<CreateLineItem>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.estimateId !== undefined) row.estimate_id = data.estimateId;
  if (data.invoiceId !== undefined) row.invoice_id = data.invoiceId;
  if (data.productId !== undefined) row.product_id = data.productId;

  if (data.name !== undefined) row.name = data.name;
  if (data.description !== undefined) row.description = data.description;
  if (data.quantity !== undefined) row.quantity = data.quantity;
  if (data.unit !== undefined) row.unit = data.unit;
  if (data.unitPrice !== undefined) row.unit_price = data.unitPrice;
  if (data.unitCost !== undefined) row.unit_cost = data.unitCost;
  if (data.discountPercent !== undefined) row.discount_percent = data.discountPercent;
  if (data.isTaxable !== undefined) row.is_taxable = data.isTaxable;
  if (data.taxRateId !== undefined) row.tax_rate_id = data.taxRateId;

  if (data.isOptional !== undefined) row.is_optional = data.isOptional;
  if (data.isSelected !== undefined) row.is_selected = data.isSelected;

  if (data.sortOrder !== undefined) row.sort_order = data.sortOrder;
  if (data.category !== undefined) row.category = data.category;
  if (data.serviceDate !== undefined) {
    row.service_date = data.serviceDate
      ? data.serviceDate instanceof Date ? data.serviceDate.toISOString() : data.serviceDate
      : null;
  }

  return row;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export { mapLineItemFromDb, mapLineItemToDb };

export const EstimateService = {
  async fetchEstimates(
    companyId: string,
    options: FetchEstimatesOptions = {}
  ): Promise<Estimate[]> {
    const supabase = requireSupabase();

    let query = supabase
      .from("estimates")
      .select("*")
      .eq("company_id", companyId);

    if (!options.includeDeleted) {
      query = query.is("deleted_at", null);
    }
    if (options.status) {
      query = query.eq("status", options.status);
    }
    if (options.clientId) {
      query = query.eq("client_id", options.clientId);
    }
    if (options.opportunityId) {
      query = query.eq("opportunity_id", options.opportunityId);
    }

    query = query.order("issue_date", { ascending: false });

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch estimates: ${error.message}`);
    return (data ?? []).map(mapEstimateFromDb);
  },

  async fetchProjectEstimates(
    projectId: string,
    companyId: string
  ): Promise<Estimate[]> {
    // Estimates don't have a direct project_id — they link through opportunities.
    // For now, fetch all for the company. The UI can filter by opportunity→project.
    return EstimateService.fetchEstimates(companyId);
  },

  async fetchEstimate(id: string): Promise<Estimate> {
    const supabase = requireSupabase();

    const [estimateResult, lineItemsResult] = await Promise.all([
      supabase.from("estimates").select("*").eq("id", id).single(),
      supabase
        .from("line_items")
        .select("*")
        .eq("estimate_id", id)
        .order("sort_order"),
    ]);

    if (estimateResult.error)
      throw new Error(`Failed to fetch estimate: ${estimateResult.error.message}`);
    if (lineItemsResult.error)
      throw new Error(`Failed to fetch line items: ${lineItemsResult.error.message}`);

    const estimate = mapEstimateFromDb(estimateResult.data);
    estimate.lineItems = (lineItemsResult.data ?? []).map(mapLineItemFromDb);
    return estimate;
  },

  async createEstimate(
    data: Partial<CreateEstimate> & { companyId: string; clientId: string },
    lineItems: Partial<CreateLineItem>[]
  ): Promise<Estimate> {
    const supabase = requireSupabase();

    // Get next document number via RPC
    const { data: docNumber, error: rpcError } = await supabase.rpc(
      "get_next_document_number",
      { p_company_id: data.companyId, p_document_type: "estimate" }
    );
    if (rpcError)
      throw new Error(`Failed to get estimate number: ${rpcError.message}`);

    // Insert estimate header
    const row = mapEstimateToDb(data);
    row.estimate_number = docNumber;

    const { data: created, error: insertError } = await supabase
      .from("estimates")
      .insert(row)
      .select()
      .single();

    if (insertError)
      throw new Error(`Failed to create estimate: ${insertError.message}`);

    const estimate = mapEstimateFromDb(created);

    // Insert line items (never send line_total)
    if (lineItems.length > 0) {
      const lineItemRows = lineItems.map((item, idx) => {
        const liRow = mapLineItemToDb(item);
        liRow.estimate_id = estimate.id;
        liRow.company_id = data.companyId;
        if (liRow.sort_order === undefined) liRow.sort_order = idx;
        return liRow;
      });

      const { data: createdItems, error: liError } = await supabase
        .from("line_items")
        .insert(lineItemRows)
        .select();

      if (liError)
        throw new Error(`Failed to create line items: ${liError.message}`);

      estimate.lineItems = (createdItems ?? []).map(mapLineItemFromDb);
    }

    return estimate;
  },

  async updateEstimate(
    id: string,
    data: Partial<CreateEstimate>,
    lineItems?: Partial<CreateLineItem>[]
  ): Promise<Estimate> {
    const supabase = requireSupabase();
    const row = mapEstimateToDb(data);

    const { data: updated, error } = await supabase
      .from("estimates")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update estimate: ${error.message}`);

    const estimate = mapEstimateFromDb(updated);

    // Replace line items if provided
    if (lineItems) {
      // Delete existing
      const { error: delError } = await supabase
        .from("line_items")
        .delete()
        .eq("estimate_id", id);

      if (delError)
        throw new Error(`Failed to delete existing line items: ${delError.message}`);

      // Insert new
      if (lineItems.length > 0) {
        const companyId = estimate.companyId;
        const lineItemRows = lineItems.map((item, idx) => {
          const liRow = mapLineItemToDb(item);
          liRow.estimate_id = id;
          liRow.company_id = companyId;
          if (liRow.sort_order === undefined) liRow.sort_order = idx;
          return liRow;
        });

        const { data: createdItems, error: liError } = await supabase
          .from("line_items")
          .insert(lineItemRows)
          .select();

        if (liError)
          throw new Error(`Failed to insert line items: ${liError.message}`);

        estimate.lineItems = (createdItems ?? []).map(mapLineItemFromDb);
      } else {
        estimate.lineItems = [];
      }
    }

    return estimate;
  },

  async deleteEstimate(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("estimates")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete estimate: ${error.message}`);
  },

  async sendEstimate(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("estimates")
      .update({
        status: EstimateStatus.Sent,
        sent_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw new Error(`Failed to send estimate: ${error.message}`);
  },

  /**
   * Convert an approved estimate to an invoice atomically via RPC.
   * The RPC validates the estimate is in `approved` status, creates the invoice,
   * copies line items, and marks the estimate as `converted`.
   */
  async convertToInvoice(
    estimateId: string,
    dueDate?: string
  ): Promise<string> {
    const supabase = requireSupabase();

    const { data, error } = await supabase.rpc("convert_estimate_to_invoice", {
      p_estimate_id: estimateId,
      p_due_date: dueDate ?? null,
    });

    if (error)
      throw new Error(`Failed to convert estimate to invoice: ${error.message}`);

    return data as string;
  },
};
