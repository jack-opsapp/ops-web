/**
 * POST /api/integrations/email/send
 *
 * Lead-bound email delivery. The authenticated OPS user, canonical mailbox,
 * internal thread, and lead relationship are resolved server-side. A durable
 * intent is committed before provider I/O and is the only authority allowed to
 * claim delivery or resume post-provider reconciliation.
 */

import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { EmailSendDeliveryService } from "@/lib/api/services/email-send-delivery-service";
import { EmailService } from "@/lib/api/services/email-service";
import { EmailSendIntentService } from "@/lib/api/services/email-send-intent-service";
import { reconcileEmailSend } from "@/lib/api/services/email-send-reconciliation-service";
import { renderEmailBodyWithSignature } from "@/lib/api/services/email-signature-service";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { resolveEmailSignatureForMessage } from "@/lib/email/email-signature-runtime";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getSubscriptionInfo } from "@/lib/subscription";
import {
  SubscriptionPlan,
  SubscriptionStatus,
  type Company,
} from "@/lib/types/models";
import { extractEmailAddress } from "@/lib/utils/email-parsing";
import { markdownToEmailHtml } from "@/lib/utils/markdown-to-email-html";

export const maxDuration = 60;

const RATE_LIMIT_PER_HOUR = 100;
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

interface BrowserSendPayload {
  idempotencyKey?: unknown;
  connectionId?: unknown;
  emailThreadId?: unknown;
  opportunityId?: unknown;
  senderSwitched?: unknown;
  to?: unknown;
  cc?: unknown;
  subject?: unknown;
  body?: unknown;
  format?: unknown;
  inReplyTo?: unknown;
  draftHistoryId?: unknown;
  followUpDraftId?: unknown;
  /** Legacy claims are deliberately ignored; token subject is authoritative. */
  userId?: unknown;
  companyId?: unknown;
}

type CompanySubscriptionFields = Pick<
  Company,
  | "subscriptionPlan"
  | "subscriptionStatus"
  | "trialEndDate"
  | "seatedEmployeeIds"
  | "adminIds"
  | "maxSeats"
>;

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function isValidEmail(value: string): boolean {
  const address = extractEmailAddress(value);
  return EMAIL_RE.test(address) && address.length <= 254;
}

function mapSubscriptionRow(
  row: Record<string, unknown>
): CompanySubscriptionFields {
  return {
    subscriptionPlan: (row.subscription_plan as SubscriptionPlan) ?? null,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) ?? null,
    trialEndDate: row.trial_end_date
      ? new Date(row.trial_end_date as string)
      : null,
    seatedEmployeeIds: (row.seated_employee_ids as string[]) ?? [],
    adminIds: (row.admin_ids as string[]) ?? [],
    maxSeats: (row.max_seats as number) ?? 10,
  };
}

function accessError(reason: string): NextResponse {
  const conflictReasons = new Set([
    "connection_identity_mismatch",
    "thread_identity_mismatch",
    "opportunity_identity_mismatch",
    "canonical_relationship_conflict",
  ]);
  return NextResponse.json(
    { error: reason },
    { status: conflictReasons.has(reason) ? 409 : 403 }
  );
}

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const pipelineSecret = process.env.CRON_SECRET;
    const isInternalCaller =
      Boolean(pipelineSecret) &&
      request.headers.get("authorization") === `Bearer ${pipelineSecret}`;
    if (isInternalCaller) {
      // Generic CRON-secret requests previously trusted body user/company IDs.
      // Internal senders now need a source-record resolver (pending auto-send or
      // approved action) and may not enter through the browser contract.
      return NextResponse.json(
        { error: "EMAIL_SEND_TRUSTED_SOURCE_REQUIRED" },
        { status: 403 }
      );
    }

    const actorResolution = await resolveEmailRouteActor(request);
    if (!actorResolution.ok) return actorResolution.response;
    const actor = actorResolution.actor;
    const payload = (await request.json()) as BrowserSendPayload;

    const idempotencyKey = string(payload.idempotencyKey);
    const selectedConnectionId = string(payload.connectionId);
    const sourceEmailThreadId = string(payload.emailThreadId);
    const assertedOpportunityId = string(payload.opportunityId);
    const senderSwitched = payload.senderSwitched === true;
    const to = stringArray(payload.to);
    const cc = stringArray(payload.cc) ?? [];
    const subject = string(payload.subject);
    const emailBody = string(payload.body);
    const inReplyTo = string(payload.inReplyTo);
    const draftHistoryId = string(payload.draftHistoryId);
    const followUpDraftId = string(payload.followUpDraftId);

    if (!idempotencyKey || idempotencyKey.length > 200) {
      return NextResponse.json(
        { error: "EMAIL_SEND_IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }
    if (!to?.length) {
      return NextResponse.json(
        { error: "EMAIL_SEND_RECIPIENT_REQUIRED" },
        { status: 400 }
      );
    }
    if (!subject || !emailBody) {
      return NextResponse.json(
        { error: "EMAIL_SEND_CONTENT_REQUIRED" },
        { status: 400 }
      );
    }
    const invalidAddresses = [...to, ...cc].filter(
      (address) => !isValidEmail(address)
    );
    if (invalidAddresses.length) {
      return NextResponse.json(
        { error: "EMAIL_SEND_RECIPIENT_INVALID", invalidAddresses },
        { status: 400 }
      );
    }
    if (senderSwitched && (!sourceEmailThreadId || !selectedConnectionId)) {
      return NextResponse.json(
        { error: "EMAIL_SEND_SENDER_SWITCH_INVALID" },
        { status: 400 }
      );
    }

    // Existing replies first authorize the canonical source thread. An
    // explicit sender switch then separately authorizes the selected mailbox
    // as a new conversation on the same lead.
    const sourceAccess = sourceEmailThreadId
      ? await resolveEmailOpportunityAccess({
          actor,
          operation: senderSwitched ? "read" : "send",
          threadId: sourceEmailThreadId,
          connectionId: senderSwitched
            ? undefined
            : selectedConnectionId ?? undefined,
          opportunityId: assertedOpportunityId ?? undefined,
        })
      : null;
    if (sourceAccess && !sourceAccess.allowed) {
      return accessError(sourceAccess.reason);
    }

    const canonicalOpportunityId = sourceAccess?.allowed
      ? sourceAccess.opportunityId
      : assertedOpportunityId;
    if (!canonicalOpportunityId) {
      return NextResponse.json(
        { error: "EMAIL_SEND_OPPORTUNITY_REQUIRED" },
        { status: 400 }
      );
    }

    const selectedAccess =
      senderSwitched || !sourceAccess
        ? await resolveEmailOpportunityAccess({
            actor,
            operation: "send",
            connectionId: selectedConnectionId ?? undefined,
            opportunityId: canonicalOpportunityId,
          })
        : sourceAccess;
    if (!selectedAccess.allowed) return accessError(selectedAccess.reason);
    if (
      senderSwitched &&
      sourceAccess?.allowed &&
      selectedAccess.connectionId === sourceAccess.connectionId
    ) {
      return NextResponse.json(
        { error: "EMAIL_SEND_SENDER_SWITCH_INVALID" },
        { status: 409 }
      );
    }

    const connection = await EmailService.getConnection(
      selectedAccess.connectionId
    );
    if (
      !connection ||
      connection.status !== "active" ||
      connection.companyId !== actor.companyId
    ) {
      return NextResponse.json(
        { error: "EMAIL_SEND_CONNECTION_INVALID" },
        { status: 409 }
      );
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select(
        "subscription_plan, subscription_status, trial_end_date, seated_employee_ids, admin_ids, max_seats"
      )
      .eq("id", actor.companyId)
      .single();
    if (companyError || !company) {
      return NextResponse.json(
        { error: "EMAIL_SEND_SUBSCRIPTION_LOOKUP_FAILED" },
        { status: 500 }
      );
    }
    if (!getSubscriptionInfo(mapSubscriptionRow(company)).isActive) {
      return NextResponse.json(
        { error: "EMAIL_SEND_SUBSCRIPTION_INACTIVE" },
        { status: 403 }
      );
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentSends } = await supabase
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("company_id", actor.companyId)
      .eq("created_by", actor.userId)
      .eq("type", "email")
      .eq("direction", "outbound")
      .gte("created_at", oneHourAgo);
    if ((recentSends ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        { error: "EMAIL_SEND_RATE_LIMITED" },
        { status: 429 }
      );
    }

    const contentType =
      payload.format === "markdown" ? ("html" as const) : ("text" as const);
    const authoredBody =
      contentType === "html" ? markdownToEmailHtml(emailBody) : emailBody;
    const signature = await resolveEmailSignatureForMessage({
      supabase,
      connection,
      userId: actor.userId,
      refreshProviderIfMissing: true,
    });
    if (!signature) {
      return NextResponse.json(
        {
          error: "EMAIL_SIGNATURE_REQUIRED",
          message: "Add your email signature in Settings before sending.",
        },
        { status: 409 }
      );
    }
    const renderedBody = renderEmailBodyWithSignature({
      body: authoredBody,
      contentType,
      signature,
    });
    const renderedBodyHash = createHash("sha256")
      .update(renderedBody)
      .digest("hex");

    const provider = EmailService.getProvider(connection);
    const intentStore = new EmailSendIntentService(supabase);
    let reconciliationResult:
      | Awaited<ReturnType<typeof reconcileEmailSend>>
      | null = null;
    const delivery = new EmailSendDeliveryService({
      intentStore,
      provider,
      reconcile: async (intent) => {
        reconciliationResult = await reconcileEmailSend({
          supabase,
          intent,
          connection,
          provider,
        });
        return { activityId: reconciliationResult.activityId };
      },
    });

    const result = await delivery.execute({
      idempotencyKey,
      companyId: actor.companyId,
      actorUserId: actor.userId,
      initiatedBy: "operator",
      connectionId: selectedAccess.connectionId,
      opportunityId: canonicalOpportunityId,
      sourceEmailThreadId,
      replyProviderThreadId: senderSwitched
        ? null
        : (sourceAccess?.allowed
            ? sourceAccess.providerThreadId
            : null),
      inReplyTo: senderSwitched ? null : inReplyTo,
      senderSwitched,
      toEmails: to,
      ccEmails: cc,
      subject,
      authoredBody: emailBody,
      renderedBody,
      contentType,
      draftHistoryId,
      followUpDraftId,
      learningAuthority: draftHistoryId
        ? "operator_approved"
        : "operator_authored",
      signatureId: signature?.recordId ?? null,
      signatureContentHash: signature?.hash ?? null,
      renderedBodyHash,
      pendingAutoSendId: null,
    });

    if (result.state === "rejected") {
      return NextResponse.json(
        {
          error: "EMAIL_SEND_PROVIDER_REJECTED",
          reason: result.error,
          intentId: result.intentId,
        },
        { status: 502 }
      );
    }
    if (result.state !== "reconciled") {
      return NextResponse.json(
        {
          ok: result.delivered,
          delivered: result.delivered,
          reconciliationPending: result.delivered,
          deliveryUnknown: result.state === "delivery_unknown",
          intentId: result.intentId,
          messageId: result.providerMessageId,
          threadId: result.providerThreadId,
          from: connection.email,
          reason: result.error,
        },
        { status: 202 }
      );
    }

    const responseReconciliation = reconciliationResult as Awaited<
      ReturnType<typeof reconcileEmailSend>
    > | null;
    return NextResponse.json({
      ok: true,
      delivered: true,
      intentId: result.intentId,
      messageId: result.providerMessageId,
      threadId: result.providerThreadId,
      from: connection.email,
      sentAt: responseReconciliation?.sentAt ?? null,
      labels: responseReconciliation?.labels ?? [],
      latestDirection: responseReconciliation?.latestDirection ?? "outbound",
      opportunityId: canonicalOpportunityId,
    });
  } catch (error) {
    console.error("[email-send]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "EMAIL_SEND_REQUEST_FAILED",
      },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
