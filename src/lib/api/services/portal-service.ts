/**
 * OPS Web - Portal Data Service
 *
 * Aggregation service for the client portal. Fetches data from Supabase
 * (estimates, invoices, line items, payments) and constructs the
 * PortalClientData shape for the portal UI.
 *
 * Uses getServiceRoleClient (NOT requireSupabase) because portal users
 * authenticate via magic link sessions, not Firebase auth.
 *
 * IMPORTANT:
 *   - Every read method verifies client_id to prevent cross-client data access.
 *   - snake_case in DB, camelCase in TypeScript.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import { mapLineItemFromDb } from "./estimate-service";
import { PortalBrandingService } from "./portal-branding-service";
import type { Client } from "@/lib/types/models";
import type {
  Estimate,
  Invoice,
  LineItem,
  Payment,
} from "@/lib/types/pipeline";
import { EstimateStatus, PaymentMethod, DiscountType } from "@/lib/types/pipeline";
import type {
  PortalClientData,
  PortalCompanyInfo,
  PortalEstimate,
  PortalInvoice,
  PortalProject,
} from "@/lib/types/portal";

// ─── Database ↔ TypeScript Mapping ──────────────────────────────────────────

function mapEstimateFromDb(row: Record<string, unknown>): Estimate {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    opportunityId: (row.opportunity_id as string) ?? null,
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

    // Project linkage
    projectId: (row.project_id as string) ?? null,

    // System
    createdBy: (row.created_by as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

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
    status: row.status as import("@/lib/types/pipeline").InvoiceStatus,
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

function mapClientFromDb(row: Record<string, unknown>): Client {
  return {
    id: row.id as string,
    name: row.name as string,
    email: (row.email as string) ?? null,
    phoneNumber: (row.phone_number as string) ?? null,
    address: (row.address as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    profileImageURL: (row.profile_image_url as string) ?? null,
    notes: (row.notes as string) ?? null,
    companyId: (row.company_id as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    createdAt: parseDate(row.created_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

// ─── Portal-Specific Mapping Helpers ────────────────────────────────────────

function toPortalEstimate(
  estimate: Estimate,
  hasUnansweredQuestions: boolean
): PortalEstimate {
  return {
    id: estimate.id,
    estimateNumber: estimate.estimateNumber,
    title: estimate.title,
    status: estimate.status,
    total: estimate.total,
    issueDate: estimate.issueDate,
    expirationDate: estimate.expirationDate,
    hasUnansweredQuestions,
    projectId: estimate.projectId,
  };
}

function toPortalInvoice(invoice: Invoice): PortalInvoice {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    subject: invoice.subject,
    status: invoice.status,
    total: invoice.total,
    balanceDue: invoice.balanceDue,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    projectId: invoice.projectId,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const PortalService = {
  /**
   * Fetch all portal data for a client: client info, company info, branding,
   * estimates, invoices, projects (derived), and unread message count.
   */
  async getPortalData(
    clientId: string,
    companyId: string
  ): Promise<PortalClientData> {
    const supabase = getServiceRoleClient();

    // Fetch client, branding, estimates, invoices, and unread count in parallel
    const [
      clientResult,
      branding,
      estimatesResult,
      invoicesResult,
      companyResult,
      unreadResult,
    ] = await Promise.all([
      // Client info from Supabase
      supabase
        .from("clients")
        .select("*")
        .eq("id", clientId)
        .eq("company_id", companyId)
        .maybeSingle(),

      // Branding (auto-creates default if missing)
      PortalBrandingService.getBranding(companyId),

      // Estimates for this client (non-deleted, non-draft only for portal)
      supabase
        .from("estimates")
        .select("*")
        .eq("client_id", clientId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .neq("status", EstimateStatus.Draft)
        .order("issue_date", { ascending: false }),

      // Invoices for this client (non-deleted, non-draft only for portal)
      supabase
        .from("invoices")
        .select("*")
        .eq("client_id", clientId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .neq("status", "draft")
        .order("issue_date", { ascending: false }),

      // Company info
      supabase
        .from("companies")
        .select("name, logo_url, phone, email")
        .eq("id", companyId)
        .maybeSingle(),

      // Unread message count
      supabase
        .from("portal_messages")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("company_id", companyId)
        .eq("sender_type", "company")
        .is("read_at", null),
    ]);

    if (estimatesResult.error)
      throw new Error(`Failed to fetch estimates: ${estimatesResult.error.message}`);
    if (invoicesResult.error)
      throw new Error(`Failed to fetch invoices: ${invoicesResult.error.message}`);

    // Build client object (fallback if not found in Supabase)
    const client: Client = clientResult.data
      ? mapClientFromDb(clientResult.data)
      : {
          id: clientId,
          name: "Client",
          email: null,
          phoneNumber: null,
          address: null,
          latitude: null,
          longitude: null,
          profileImageURL: null,
          notes: null,
          companyId,
          lastSyncedAt: null,
          needsSync: false,
          createdAt: null,
          deletedAt: null,
        };

    // Build company info
    const company: PortalCompanyInfo = {
      name: (companyResult.data?.name as string) ?? "Company",
      logoUrl: (companyResult.data?.logo_url as string) ?? null,
      phone: (companyResult.data?.phone as string) ?? null,
      email: (companyResult.data?.email as string) ?? null,
    };

    // Map estimates
    const estimates = (estimatesResult.data ?? []).map(mapEstimateFromDb);

    // Check which estimates have unanswered questions
    const estimateIds = estimates.map((e) => e.id);
    const unansweredByEstimate: Record<string, boolean> = {};

    if (estimateIds.length > 0) {
      // Fetch questions for all estimates
      const { data: questions } = await supabase
        .from("line_item_questions")
        .select("id, estimate_id")
        .in("estimate_id", estimateIds);

      if (questions && questions.length > 0) {
        const questionIds = questions.map((q) => q.id as string);

        // Fetch answers for those questions by this client
        const { data: answers } = await supabase
          .from("line_item_answers")
          .select("question_id")
          .eq("client_id", clientId)
          .in("question_id", questionIds);

        const answeredQuestionIds = new Set(
          (answers ?? []).map((a) => a.question_id as string)
        );

        // Group unanswered status by estimate
        for (const q of questions) {
          const estId = q.estimate_id as string;
          if (!answeredQuestionIds.has(q.id as string)) {
            unansweredByEstimate[estId] = true;
          }
        }
      }
    }

    const portalEstimates: PortalEstimate[] = estimates.map((e) =>
      toPortalEstimate(e, unansweredByEstimate[e.id] ?? false)
    );

    // Map invoices
    const portalInvoices: PortalInvoice[] = (invoicesResult.data ?? [])
      .map(mapInvoiceFromDb)
      .map(toPortalInvoice);

    // Build projects from estimate/invoice project references
    const projectMap = new Map<
      string,
      { estimateCount: number; invoiceCount: number }
    >();

    for (const est of portalEstimates) {
      if (est.projectId) {
        const entry = projectMap.get(est.projectId) ?? {
          estimateCount: 0,
          invoiceCount: 0,
        };
        entry.estimateCount++;
        projectMap.set(est.projectId, entry);
      }
    }
    for (const inv of portalInvoices) {
      if (inv.projectId) {
        const entry = projectMap.get(inv.projectId) ?? {
          estimateCount: 0,
          invoiceCount: 0,
        };
        entry.invoiceCount++;
        projectMap.set(inv.projectId, entry);
      }
    }

    // Fetch project details from Supabase for known project IDs
    let portalProjects: PortalProject[] = [];
    const projectIds = Array.from(projectMap.keys());

    if (projectIds.length > 0) {
      const { data: projectRows } = await supabase
        .from("projects")
        .select("id, title, address, status, start_date, end_date, project_images")
        .in("id", projectIds);

      if (projectRows) {
        portalProjects = projectRows.map((row) => {
          const counts = projectMap.get(row.id as string) ?? {
            estimateCount: 0,
            invoiceCount: 0,
          };
          return {
            id: row.id as string,
            title: (row.title as string) ?? "Untitled Project",
            address: (row.address as string) ?? null,
            status: (row.status as string) ?? "unknown",
            startDate: parseDate(row.start_date),
            endDate: parseDate(row.end_date),
            projectImages: (row.project_images as string[]) ?? [],
            estimateCount: counts.estimateCount,
            invoiceCount: counts.invoiceCount,
          };
        });
      }
    }

    return {
      client,
      company,
      branding,
      projects: portalProjects,
      estimates: portalEstimates,
      invoices: portalInvoices,
      unreadMessages: unreadResult.count ?? 0,
    };
  },

  /**
   * Fetch a single estimate with its line items for portal display.
   * Verifies client_id matches to prevent cross-client data access.
   */
  async getEstimateForPortal(
    estimateId: string,
    clientId: string
  ): Promise<Estimate & { lineItems: LineItem[] }> {
    const supabase = getServiceRoleClient();

    const [estimateResult, lineItemsResult] = await Promise.all([
      supabase
        .from("estimates")
        .select("*")
        .eq("id", estimateId)
        .is("deleted_at", null)
        .single(),
      supabase
        .from("line_items")
        .select("*")
        .eq("estimate_id", estimateId)
        .order("sort_order"),
    ]);

    if (estimateResult.error)
      throw new Error(`Failed to fetch estimate: ${estimateResult.error.message}`);
    if (lineItemsResult.error)
      throw new Error(`Failed to fetch line items: ${lineItemsResult.error.message}`);

    const estimate = mapEstimateFromDb(estimateResult.data);

    // Verify client ownership
    if (estimate.clientId !== clientId) {
      throw new Error("Access denied: estimate does not belong to this client");
    }

    const lineItems = (lineItemsResult.data ?? []).map(mapLineItemFromDb);

    return { ...estimate, lineItems };
  },

  /**
   * Fetch a single invoice with its line items and payments for portal display.
   * Verifies client_id matches to prevent cross-client data access.
   */
  async getInvoiceForPortal(
    invoiceId: string,
    clientId: string
  ): Promise<Invoice & { lineItems: LineItem[]; payments: Payment[] }> {
    const supabase = getServiceRoleClient();

    const [invoiceResult, lineItemsResult, paymentsResult] = await Promise.all([
      supabase
        .from("invoices")
        .select("*")
        .eq("id", invoiceId)
        .is("deleted_at", null)
        .single(),
      supabase
        .from("line_items")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("sort_order"),
      supabase
        .from("payments")
        .select("*")
        .eq("invoice_id", invoiceId)
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

    // Verify client ownership
    if (invoice.clientId !== clientId) {
      throw new Error("Access denied: invoice does not belong to this client");
    }

    const lineItems = (lineItemsResult.data ?? []).map(mapLineItemFromDb);
    const payments = (paymentsResult.data ?? []).map(mapPaymentFromDb);

    return { ...invoice, lineItems, payments };
  },

  /**
   * Mark an estimate as viewed by updating viewed_at timestamp.
   * Only sets the timestamp if it has not already been set (first view).
   */
  async markEstimateViewed(estimateId: string): Promise<void> {
    const supabase = getServiceRoleClient();

    // Only update if not already viewed — avoids overwriting the first view time
    const { data: existing } = await supabase
      .from("estimates")
      .select("viewed_at, status")
      .eq("id", estimateId)
      .single();

    if (existing && !existing.viewed_at) {
      const updates: Record<string, unknown> = {
        viewed_at: new Date().toISOString(),
      };

      // If the estimate is in "sent" status, advance to "viewed"
      if (existing.status === EstimateStatus.Sent) {
        updates.status = EstimateStatus.Viewed;
      }

      const { error } = await supabase
        .from("estimates")
        .update(updates)
        .eq("id", estimateId);

      if (error)
        throw new Error(`Failed to mark estimate viewed: ${error.message}`);
    }
  },

  /**
   * Approve an estimate on behalf of the client.
   * Verifies client_id matches to prevent cross-client action.
   */
  async approveEstimate(
    estimateId: string,
    clientId: string
  ): Promise<void> {
    const supabase = getServiceRoleClient();

    // Fetch estimate and verify ownership
    const { data, error: fetchError } = await supabase
      .from("estimates")
      .select("client_id, status")
      .eq("id", estimateId)
      .is("deleted_at", null)
      .single();

    if (fetchError)
      throw new Error(`Failed to fetch estimate: ${fetchError.message}`);

    if ((data.client_id as string) !== clientId) {
      throw new Error("Access denied: estimate does not belong to this client");
    }

    // Validate status allows approval
    const currentStatus = data.status as EstimateStatus;
    if (
      currentStatus !== EstimateStatus.Sent &&
      currentStatus !== EstimateStatus.Viewed &&
      currentStatus !== EstimateStatus.ChangesRequested
    ) {
      throw new Error(
        `Cannot approve estimate in "${currentStatus}" status`
      );
    }

    const { error } = await supabase
      .from("estimates")
      .update({
        status: EstimateStatus.Approved,
        approved_at: new Date().toISOString(),
      })
      .eq("id", estimateId);

    if (error)
      throw new Error(`Failed to approve estimate: ${error.message}`);
  },

  /**
   * Decline an estimate on behalf of the client.
   * Verifies client_id matches to prevent cross-client action.
   */
  async declineEstimate(
    estimateId: string,
    clientId: string,
    reason?: string
  ): Promise<void> {
    const supabase = getServiceRoleClient();

    // Fetch estimate and verify ownership
    const { data, error: fetchError } = await supabase
      .from("estimates")
      .select("client_id, status")
      .eq("id", estimateId)
      .is("deleted_at", null)
      .single();

    if (fetchError)
      throw new Error(`Failed to fetch estimate: ${fetchError.message}`);

    if ((data.client_id as string) !== clientId) {
      throw new Error("Access denied: estimate does not belong to this client");
    }

    // Validate status allows decline
    const currentStatus = data.status as EstimateStatus;
    if (
      currentStatus !== EstimateStatus.Sent &&
      currentStatus !== EstimateStatus.Viewed &&
      currentStatus !== EstimateStatus.ChangesRequested
    ) {
      throw new Error(
        `Cannot decline estimate in "${currentStatus}" status`
      );
    }

    const updates: Record<string, unknown> = {
      status: EstimateStatus.Declined,
    };

    // Store decline reason in internal_notes if provided
    if (reason) {
      updates.internal_notes = `[Client declined] ${reason}`;
    }

    const { error } = await supabase
      .from("estimates")
      .update(updates)
      .eq("id", estimateId);

    if (error)
      throw new Error(`Failed to decline estimate: ${error.message}`);
  },
};
