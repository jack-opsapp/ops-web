/**
 * OPS Web - Portal Activity Service
 *
 * Creates activity records for portal events. Uses service role client
 * since portal operations happen without Firebase auth.
 *
 * Activities are logged for the pipeline activity timeline and project feed.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { ActivityType } from "@/lib/types/pipeline";

interface PortalActivityParams {
  companyId: string;
  clientId: string;
  estimateId?: string | null;
  invoiceId?: string | null;
  projectId?: string | null;
  opportunityId?: string | null;
}

async function createPortalActivity(
  params: PortalActivityParams & {
    type: ActivityType;
    subject: string;
    content?: string | null;
    direction?: "inbound" | "outbound" | null;
  }
): Promise<void> {
  const supabase = getServiceRoleClient();

  const { error } = await supabase.from("activities").insert({
    company_id: params.companyId,
    client_id: params.clientId,
    estimate_id: params.estimateId ?? null,
    invoice_id: params.invoiceId ?? null,
    project_id: params.projectId ?? null,
    opportunity_id: params.opportunityId ?? null,
    type: params.type,
    subject: params.subject,
    content: params.content ?? null,
    direction: params.direction ?? "inbound",
    duration_minutes: null,
    attachments: [],
    is_read: false,
    created_by: null, // Portal client — no user ID
  });

  if (error) {
    // Log but don't throw — activity logging should not block portal operations
    console.error("[portal-activity] Failed to create activity:", error.message);
  }
}

// ─── Portal Event Loggers ────────────────────────────────────────────────────

export const PortalActivityService = {
  /** Client viewed an estimate in the portal */
  async logEstimateViewed(params: PortalActivityParams & { estimateNumber: string }) {
    await createPortalActivity({
      ...params,
      type: ActivityType.EstimateSent, // Reuse — "viewed" stage of sent
      subject: `Estimate #${params.estimateNumber} viewed by client`,
      direction: "inbound",
    });
  },

  /** Client approved an estimate */
  async logEstimateApproved(params: PortalActivityParams & { estimateNumber: string }) {
    await createPortalActivity({
      ...params,
      type: ActivityType.EstimateAccepted,
      subject: `Estimate #${params.estimateNumber} approved by client`,
      direction: "inbound",
    });
  },

  /** Client declined an estimate */
  async logEstimateDeclined(
    params: PortalActivityParams & { estimateNumber: string; reason?: string }
  ) {
    await createPortalActivity({
      ...params,
      type: ActivityType.EstimateDeclined,
      subject: `Estimate #${params.estimateNumber} declined by client`,
      content: params.reason ? `Reason: ${params.reason}` : null,
      direction: "inbound",
    });
  },

  /** Client submitted answers to line-item questions */
  async logQuestionsAnswered(
    params: PortalActivityParams & { estimateNumber: string; questionCount: number }
  ) {
    await createPortalActivity({
      ...params,
      type: ActivityType.Note,
      subject: `Client answered ${params.questionCount} question${params.questionCount !== 1 ? "s" : ""} on estimate #${params.estimateNumber}`,
      direction: "inbound",
    });
  },

  /** Client made a payment on an invoice */
  async logPaymentReceived(
    params: PortalActivityParams & { invoiceNumber: string; amount: string }
  ) {
    await createPortalActivity({
      ...params,
      type: ActivityType.PaymentReceived,
      subject: `Payment of ${params.amount} received for invoice #${params.invoiceNumber}`,
      direction: "inbound",
    });
  },

  /** Client sent a message via the portal */
  async logClientMessage(params: PortalActivityParams & { preview: string }) {
    await createPortalActivity({
      ...params,
      type: ActivityType.Note,
      subject: "Client message via portal",
      content: params.preview,
      direction: "inbound",
    });
  },
};
