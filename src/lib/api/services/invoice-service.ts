/**
 * OPS Web - Invoice Service
 *
 * CRUD operations for Invoices using Supabase.
 * Line items are stored as separate rows. Payments are in a separate table.
 *
 * IMPORTANT:
 *   - `line_total` is GENERATED ALWAYS — never include in INSERT/UPDATE to line_items.
 *   - `invoice_number` via RPC `get_next_document_number`.
 *   - Invoice `amount_paid`, `balance_due`, and status are maintained by DB triggers
 *     after payment insert/void — never update manually.
 *   - Payment voiding uses `voided_at`/`voided_by`, NOT `deleted_at`.
 */

import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import { mapLineItemFromDb, mapLineItemToDb } from "./estimate-service";
import type {
  Invoice,
  CreateInvoice,
  CreateLineItem,
  Payment,
  CreatePayment,
} from "@/lib/types/pipeline";
import { InvoiceStatus, PaymentMethod, DiscountType } from "@/lib/types/pipeline";

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchInvoicesOptions {
  status?: InvoiceStatus;
  clientId?: string;
  projectId?: string;
  opportunityId?: string;
  includeDeleted?: boolean;
}

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapInvoiceFromDb(row: Record<string, unknown>): Invoice {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    clientId: row.client_id as string,
    estimateId: (row.estimate_id as string) ?? null,
    opportunityId: (row.opportunity_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    invoiceNumber: row.invoice_number as string,

    // Content
    subject: (row.subject as string) ?? null,
    clientMessage: (row.client_message as string) ?? null,
    internalNotes: (row.internal_notes as string) ?? null,
    footer: (row.footer as string) ?? null,
    terms: (row.terms as string) ?? null,

    // Pricing
    subtotal: Number(row.subtotal ?? 0),
    discountType: (row.discount_type as DiscountType) ?? null,
    discountValue: row.discount_value != null ? Number(row.discount_value) : null,
    discountAmount: Number(row.discount_amount ?? 0),
    taxRate: row.tax_rate != null ? Number(row.tax_rate) : null,
    taxAmount: Number(row.tax_amount ?? 0),
    total: Number(row.total ?? 0),

    // Payment tracking (trigger-maintained)
    amountPaid: Number(row.amount_paid ?? 0),
    balanceDue: Number(row.balance_due ?? 0),
    depositApplied: Number(row.deposit_applied ?? 0),

    // Status & dates
    status: row.status as InvoiceStatus,
    issueDate: parseDateRequired(row.issue_date),
    dueDate: parseDateRequired(row.due_date),
    paymentTerms: (row.payment_terms as string) ?? null,
    sentAt: parseDate(row.sent_at),
    viewedAt: parseDate(row.viewed_at),
    paidAt: parseDate(row.paid_at),

    // PDF
    pdfStoragePath: (row.pdf_storage_path as string) ?? null,

    // System
    createdBy: (row.created_by as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapInvoiceToDb(
  data: Partial<CreateInvoice>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.clientId !== undefined) row.client_id = data.clientId;
  if (data.estimateId !== undefined) row.estimate_id = data.estimateId;
  if (data.opportunityId !== undefined) row.opportunity_id = data.opportunityId;
  if (data.projectId !== undefined) row.project_id = data.projectId;

  // Content
  if (data.subject !== undefined) row.subject = data.subject;
  if (data.clientMessage !== undefined) row.client_message = data.clientMessage;
  if (data.internalNotes !== undefined) row.internal_notes = data.internalNotes;
  if (data.footer !== undefined) row.footer = data.footer;
  if (data.terms !== undefined) row.terms = data.terms;

  // Pricing
  if (data.subtotal !== undefined) row.subtotal = data.subtotal;
  if (data.discountType !== undefined) row.discount_type = data.discountType;
  if (data.discountValue !== undefined) row.discount_value = data.discountValue;
  if (data.discountAmount !== undefined) row.discount_amount = data.discountAmount;
  if (data.taxRate !== undefined) row.tax_rate = data.taxRate;
  if (data.taxAmount !== undefined) row.tax_amount = data.taxAmount;
  if (data.total !== undefined) row.total = data.total;

  // Status & dates
  if (data.status !== undefined) row.status = data.status;
  if (data.issueDate !== undefined) {
    row.issue_date = data.issueDate instanceof Date
      ? data.issueDate.toISOString()
      : data.issueDate;
  }
  if (data.dueDate !== undefined) {
    row.due_date = data.dueDate instanceof Date
      ? data.dueDate.toISOString()
      : data.dueDate;
  }
  if (data.paymentTerms !== undefined) row.payment_terms = data.paymentTerms;
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
  if (data.paidAt !== undefined) {
    row.paid_at = data.paidAt
      ? data.paidAt instanceof Date ? data.paidAt.toISOString() : data.paidAt
      : null;
  }

  // PDF
  if (data.pdfStoragePath !== undefined) row.pdf_storage_path = data.pdfStoragePath;

  // System
  if (data.createdBy !== undefined) row.created_by = data.createdBy;

  return row;
}

function mapPaymentFromDb(row: Record<string, unknown>): Payment {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    invoiceId: row.invoice_id as string,
    clientId: row.client_id as string,
    amount: Number(row.amount ?? 0),
    paymentMethod: (row.payment_method as PaymentMethod) ?? null,
    referenceNumber: (row.reference_number as string) ?? null,
    notes: (row.notes as string) ?? null,
    paymentDate: parseDateRequired(row.payment_date),
    stripePaymentIntent: (row.stripe_payment_intent as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
    voidedAt: parseDate(row.voided_at),
    voidedBy: (row.voided_by as string) ?? null,
  };
}

function mapPaymentToDb(
  data: Partial<CreatePayment>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.invoiceId !== undefined) row.invoice_id = data.invoiceId;
  if (data.clientId !== undefined) row.client_id = data.clientId;
  if (data.amount !== undefined) row.amount = data.amount;
  if (data.paymentMethod !== undefined) row.payment_method = data.paymentMethod;
  if (data.referenceNumber !== undefined) row.reference_number = data.referenceNumber;
  if (data.notes !== undefined) row.notes = data.notes;
  if (data.paymentDate !== undefined) {
    row.payment_date = data.paymentDate instanceof Date
      ? data.paymentDate.toISOString()
      : data.paymentDate;
  }
  if (data.stripePaymentIntent !== undefined) row.stripe_payment_intent = data.stripePaymentIntent;
  if (data.createdBy !== undefined) row.created_by = data.createdBy;

  return row;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const InvoiceService = {
  async fetchInvoices(
    companyId: string,
    options: FetchInvoicesOptions = {}
  ): Promise<Invoice[]> {
    const supabase = requireSupabase();

    let query = supabase
      .from("invoices")
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
    if (options.projectId) {
      query = query.eq("project_id", options.projectId);
    }
    if (options.opportunityId) {
      query = query.eq("opportunity_id", options.opportunityId);
    }

    query = query.order("issue_date", { ascending: false });

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch invoices: ${error.message}`);
    return (data ?? []).map(mapInvoiceFromDb);
  },

  async fetchAllInvoices(
    companyId: string,
    options: FetchInvoicesOptions = {}
  ): Promise<Invoice[]> {
    // Supabase returns all matching rows
    return InvoiceService.fetchInvoices(companyId, options);
  },

  async fetchProjectInvoices(
    projectId: string,
    companyId: string
  ): Promise<Invoice[]> {
    return InvoiceService.fetchInvoices(companyId, { projectId });
  },

  async fetchInvoice(id: string): Promise<Invoice> {
    const supabase = requireSupabase();

    const [invoiceResult, lineItemsResult, paymentsResult] = await Promise.all([
      supabase.from("invoices").select("*").eq("id", id).single(),
      supabase
        .from("line_items")
        .select("*")
        .eq("invoice_id", id)
        .order("sort_order"),
      supabase
        .from("payments")
        .select("*")
        .eq("invoice_id", id)
        .is("voided_at", null)
        .order("payment_date", { ascending: false }),
    ]);

    if (invoiceResult.error)
      throw new Error(`Failed to fetch invoice: ${invoiceResult.error.message}`);
    if (lineItemsResult.error)
      throw new Error(`Failed to fetch line items: ${lineItemsResult.error.message}`);
    if (paymentsResult.error)
      throw new Error(`Failed to fetch payments: ${paymentsResult.error.message}`);

    const invoice = mapInvoiceFromDb(invoiceResult.data);
    invoice.lineItems = (lineItemsResult.data ?? []).map(mapLineItemFromDb);
    invoice.payments = (paymentsResult.data ?? []).map(mapPaymentFromDb);
    return invoice;
  },

  async createInvoice(
    data: Partial<CreateInvoice> & { companyId: string; clientId: string },
    lineItems: Partial<CreateLineItem>[]
  ): Promise<Invoice> {
    const supabase = requireSupabase();

    // Get next document number via RPC
    const { data: docNumber, error: rpcError } = await supabase.rpc(
      "get_next_document_number",
      { p_company_id: data.companyId, p_document_type: "invoice" }
    );
    if (rpcError)
      throw new Error(`Failed to get invoice number: ${rpcError.message}`);

    // Insert invoice header
    const row = mapInvoiceToDb(data);
    row.invoice_number = docNumber;

    const { data: created, error: insertError } = await supabase
      .from("invoices")
      .insert(row)
      .select()
      .single();

    if (insertError)
      throw new Error(`Failed to create invoice: ${insertError.message}`);

    const invoice = mapInvoiceFromDb(created);

    // Insert line items (never send line_total)
    if (lineItems.length > 0) {
      const lineItemRows = lineItems.map((item, idx) => {
        const liRow = mapLineItemToDb(item);
        liRow.invoice_id = invoice.id;
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

      invoice.lineItems = (createdItems ?? []).map(mapLineItemFromDb);
    }

    return invoice;
  },

  async updateInvoice(
    id: string,
    data: Partial<CreateInvoice>,
    lineItems?: Partial<CreateLineItem>[]
  ): Promise<Invoice> {
    const supabase = requireSupabase();
    const row = mapInvoiceToDb(data);

    const { data: updated, error } = await supabase
      .from("invoices")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update invoice: ${error.message}`);

    const invoice = mapInvoiceFromDb(updated);

    // Replace line items if provided
    if (lineItems) {
      const { error: delError } = await supabase
        .from("line_items")
        .delete()
        .eq("invoice_id", id);

      if (delError)
        throw new Error(`Failed to delete existing line items: ${delError.message}`);

      if (lineItems.length > 0) {
        const companyId = invoice.companyId;
        const lineItemRows = lineItems.map((item, idx) => {
          const liRow = mapLineItemToDb(item);
          liRow.invoice_id = id;
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

        invoice.lineItems = (createdItems ?? []).map(mapLineItemFromDb);
      } else {
        invoice.lineItems = [];
      }
    }

    return invoice;
  },

  async deleteInvoice(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("invoices")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete invoice: ${error.message}`);
  },

  async sendInvoice(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("invoices")
      .update({
        status: InvoiceStatus.Sent,
        sent_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw new Error(`Failed to send invoice: ${error.message}`);
  },

  async voidInvoice(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("invoices")
      .update({ status: InvoiceStatus.Void })
      .eq("id", id);

    if (error) throw new Error(`Failed to void invoice: ${error.message}`);
  },

  // ─── Payment Operations ───────────────────────────────────────────────────

  /**
   * Record a payment against an invoice. Do NOT update invoice balance —
   * the DB trigger handles amount_paid, balance_due, and status.
   */
  async recordPayment(data: CreatePayment): Promise<Payment> {
    const supabase = requireSupabase();
    const row = mapPaymentToDb(data);

    const { data: created, error } = await supabase
      .from("payments")
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(`Failed to record payment: ${error.message}`);
    return mapPaymentFromDb(created);
  },

  async fetchInvoicePayments(invoiceId: string): Promise<Payment[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .is("voided_at", null)
      .order("payment_date", { ascending: false });

    if (error) throw new Error(`Failed to fetch payments: ${error.message}`);
    return (data ?? []).map(mapPaymentFromDb);
  },

  /**
   * Void a payment by setting voided_at and voided_by (NOT deleted_at).
   * The DB trigger will recalculate the invoice balance.
   */
  async voidPayment(paymentId: string, userId: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("payments")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: userId,
      })
      .eq("id", paymentId);

    if (error) throw new Error(`Failed to void payment: ${error.message}`);
  },
};
