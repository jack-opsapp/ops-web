/**
 * POST /api/integrations/email/send
 *
 * Send an email from the user's connected Gmail or M365 account.
 * Creates an outbound activity record, updates correspondence counts
 * on the linked opportunity, and applies the OPS Pipeline label.
 *
 * The sent email's provider messageId is stored as email_message_id
 * on the activity — the sync engine deduplicates on this field,
 * so the next sync cycle will skip re-importing it.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { OpportunityLifecycleService } from "@/lib/api/services/opportunity-lifecycle-service";
import { EmailOutboundLearningService } from "@/lib/api/services/email-outbound-learning-service";
import type { OutboundLearningAuthority } from "@/lib/api/services/email-outbound-learning-service";
import { renderEmailBodyWithSignature } from "@/lib/api/services/email-signature-service";
import { resolveEmailSignatureForMessage } from "@/lib/email/email-signature-runtime";
import { markdownToEmailHtml } from "@/lib/utils/markdown-to-email-html";
import { extractEmailAddress } from "@/lib/utils/email-parsing";
import {
  logInvalidProviderEmailIds,
  validateProviderEmailIds,
} from "@/lib/email/provider-email-ids";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { getSubscriptionInfo } from "@/lib/subscription";
import {
  SubscriptionPlan,
  SubscriptionStatus,
  type Company,
} from "@/lib/types/models";

export const maxDuration = 60;

// RFC 5322 addr-spec regex (the bare `local@domain` part). The inbox
// composer forwards `from` strings straight from the provider, which return
// either a bare address or the full mailbox format `Display Name <addr>`
// when the sender has a display name. `isValidEmail` strips the optional
// display-name prefix before applying the regex so both forms validate.
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function isValidEmail(value: string): boolean {
  const addr = extractEmailAddress(value);
  return EMAIL_RE.test(addr) && addr.length <= 254;
}

// Rate limit: max sends per user per hour
const RATE_LIMIT_PER_HOUR = 100;

type CompanySubscriptionFields = Pick<
  Company,
  | "subscriptionPlan"
  | "subscriptionStatus"
  | "trialEndDate"
  | "seatedEmployeeIds"
  | "adminIds"
  | "maxSeats"
>;

interface ConfirmedDelivery {
  messageId: string | null;
  threadId: string | null;
  from: string;
  sentAt: string;
}

/** Minimal snake_case → camelCase mapper for subscription gating. */
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

/**
 * Give the durable post-delivery enqueue a short chance to finish without
 * allowing a stalled database call to turn an already-delivered email into a
 * false send failure. Provider sync re-enqueues the same immutable message ID
 * if this best-effort request continuation is interrupted.
 */
async function waitForPostDeliveryEnqueue(
  task: Promise<unknown>,
  timeoutMs = 1_500
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      task,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);
  let confirmedDelivery: ConfirmedDelivery | null = null;

  try {
    const authHeader = request.headers.get("authorization");
    const pipelineSecret = process.env.CRON_SECRET;
    const isInternalCaller =
      Boolean(pipelineSecret) && authHeader === `Bearer ${pipelineSecret}`;

    const payload = await request.json();
    const {
      userId,
      companyId,
      connectionId,
      to,
      cc,
      subject,
      body: emailBody,
      format,
      opportunityId,
      inReplyTo,
      threadId,
      draftHistoryId,
      followUpDraftId,
      learningAuthority: requestedLearningAuthority,
    } = payload;

    // ── Validate required fields ──────────────────────────────────────────
    if (!userId || !companyId) {
      return NextResponse.json(
        { error: "userId and companyId are required" },
        { status: 400 }
      );
    }

    // Browser sends must bind every caller-controlled tenant/user identifier
    // to the authenticated operator and require the actual send permission.
    // Server auto-send is allowed only when a non-empty CRON_SECRET matched.
    if (!isInternalCaller) {
      const authError = await requireEmailCompanyAccess(
        request,
        companyId,
        "inbox.send",
        userId
      );
      if (authError) return authError;
    }
    if (!to || !Array.isArray(to) || to.length === 0) {
      return NextResponse.json(
        { error: "to must be a non-empty array of email addresses" },
        { status: 400 }
      );
    }
    if (!subject || !emailBody) {
      return NextResponse.json(
        { error: "subject and body are required" },
        { status: 400 }
      );
    }

    // ── Validate email addresses ──────────────────────────────────────────
    const allAddresses = [...to, ...(cc || [])];
    const invalidAddresses = allAddresses.filter((addr) => !isValidEmail(addr));
    if (invalidAddresses.length > 0) {
      return NextResponse.json(
        {
          error: `Invalid email address${invalidAddresses.length > 1 ? "es" : ""}: ${invalidAddresses.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // ── Subscription gate ─────────────────────────────────────────────────
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select(
        "subscription_plan, subscription_status, trial_end_date, seated_employee_ids, admin_ids, max_seats"
      )
      .eq("id", companyId)
      .single();

    if (companyError || !company) {
      // Fail closed — a broken company lookup must not silently bypass the subscription gate.
      console.error(
        "[email-send] company subscription lookup failed:",
        companyError
      );
      return NextResponse.json(
        { error: "Failed to verify subscription" },
        { status: 500 }
      );
    }

    const subInfo = getSubscriptionInfo(mapSubscriptionRow(company));
    if (!subInfo.isActive) {
      return NextResponse.json(
        { error: "Subscription inactive", reason: "subscription_expired" },
        { status: 403 }
      );
    }

    // ── Rate limit (per-user, rolling 1-hour window) ──────────────────────
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentSends } = await supabase
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("created_by", userId)
      .eq("type", "email")
      .eq("direction", "outbound")
      .gte("created_at", oneHourAgo);

    if ((recentSends || 0) >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded — max ${RATE_LIMIT_PER_HOUR} emails per hour`,
          reason: "rate_limited",
        },
        { status: 429 }
      );
    }

    // ── Resolve email connection ──────────────────────────────────────────
    let connection;
    if (connectionId) {
      connection = await EmailService.getConnection(connectionId);
    } else {
      // Find user's active connection — prefer individual, fall back to company
      const connections = await EmailService.getConnections(companyId);
      connection =
        connections.find((c) => c.status === "active" && c.userId === userId) ||
        connections.find(
          (c) => c.status === "active" && c.type === "company"
        ) ||
        null;
    }

    if (!connection || connection.status !== "active") {
      return NextResponse.json(
        { error: "No active email connection found" },
        { status: 404 }
      );
    }
    if (
      connection.companyId !== companyId ||
      (!isInternalCaller &&
        connection.type !== "company" &&
        connection.userId !== userId)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Validate and normalize every CRM/draft identifier before the irreversible
    // provider call. The service-role client bypasses RLS, so every relation is
    // re-bound to tenant, actor, connection, opportunity, thread, and live state.
    let requestedOpportunityId: string | null = opportunityId || null;
    let validatedDraftHistoryId: string | null = null;
    let validatedFollowUpDraftId: string | null = null;
    let linkedDraftHistoryId: string | null = null;
    let validatedDraftProfileType = "general";

    if (followUpDraftId) {
      const { data: followUp, error: followUpError } = await supabase
        .from("opportunity_follow_up_drafts")
        .select(
          "id, company_id, opportunity_id, connection_id, provider_thread_id, ai_draft_history_id, status"
        )
        .eq("id", followUpDraftId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (followUpError) {
        throw new Error(
          `Failed to validate follow-up draft ownership: ${followUpError.message}`
        );
      }
      const validFollowUp =
        followUp &&
        followUp.status === "drafted" &&
        (!followUp.connection_id || followUp.connection_id === connection.id) &&
        (!threadId ||
          !followUp.provider_thread_id ||
          followUp.provider_thread_id === threadId) &&
        (!requestedOpportunityId ||
          followUp.opportunity_id === requestedOpportunityId);
      if (!validFollowUp) {
        return NextResponse.json(
          { error: "FOLLOW_UP_DRAFT_PROVENANCE_INVALID" },
          { status: 409 }
        );
      }
      validatedFollowUpDraftId = String(followUp.id);
      requestedOpportunityId = String(followUp.opportunity_id);
      linkedDraftHistoryId = followUp.ai_draft_history_id
        ? String(followUp.ai_draft_history_id)
        : null;
    }

    if (
      draftHistoryId &&
      linkedDraftHistoryId &&
      draftHistoryId !== linkedDraftHistoryId
    ) {
      return NextResponse.json(
        { error: "DRAFT_RELATIONSHIP_CONFLICT" },
        { status: 409 }
      );
    }

    const candidateDraftHistoryId = draftHistoryId || linkedDraftHistoryId;
    if (candidateDraftHistoryId) {
      const { data: draft, error: draftError } = await supabase
        .from("ai_draft_history")
        .select(
          "id, company_id, user_id, opportunity_id, connection_id, thread_id, status, profile_type"
        )
        .eq("id", candidateDraftHistoryId)
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .maybeSingle();
      if (draftError) {
        throw new Error(
          `Failed to validate draft ownership: ${draftError.message}`
        );
      }
      const validDraft =
        draft &&
        ["drafted", "auto_drafted"].includes(String(draft.status)) &&
        (!draft.connection_id || draft.connection_id === connection.id) &&
        (!threadId || !draft.thread_id || draft.thread_id === threadId) &&
        (!requestedOpportunityId ||
          !draft.opportunity_id ||
          draft.opportunity_id === requestedOpportunityId);
      if (!validDraft) {
        return NextResponse.json(
          { error: "DRAFT_PROVENANCE_INVALID" },
          { status: 409 }
        );
      }
      validatedDraftHistoryId = String(draft.id);
      validatedDraftProfileType =
        typeof draft.profile_type === "string" && draft.profile_type.trim()
          ? draft.profile_type
          : "general";
      if (!requestedOpportunityId && draft.opportunity_id) {
        requestedOpportunityId = String(draft.opportunity_id);
      }
    }

    const effectiveLearningAuthority: OutboundLearningAuthority =
      !isInternalCaller
        ? validatedDraftHistoryId
          ? "operator_approved"
          : "operator_authored"
        : requestedLearningAuthority === "operator_authored" ||
            requestedLearningAuthority === "operator_approved"
          ? requestedLearningAuthority
          : "autonomous";

    if (requestedOpportunityId) {
      const { data: ownedOpportunity, error: opportunityError } = await supabase
        .from("opportunities")
        .select("id")
        .eq("id", requestedOpportunityId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .maybeSingle();
      if (opportunityError) {
        throw new Error(
          `Failed to validate opportunity ownership: ${opportunityError.message}`
        );
      }
      if (!ownedOpportunity) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // A reply already carries the provider thread id before the irreversible
    // provider send. Resolve its first-writer owner now so a stale composer
    // cannot send successfully and only afterwards discover that the thread
    // belongs to another opportunity.
    if (typeof threadId === "string" && threadId.trim()) {
      const { data: requestedThreadLink, error: requestedThreadLinkError } =
        await supabase
          .from("opportunity_email_threads")
          .select("opportunity_id")
          .eq("thread_id", threadId)
          .eq("connection_id", connection.id)
          .limit(1)
          .maybeSingle();
      if (requestedThreadLinkError) {
        throw new Error(
          `Sent email thread preflight failed: ${requestedThreadLinkError.message ?? "unknown error"}`
        );
      }

      const requestedOwnerId = requestedThreadLink?.opportunity_id ?? null;
      if (requestedOwnerId) {
        const { data: ownedRequestedOpportunity, error: requestedOwnerError } =
          await supabase
            .from("opportunities")
            .select("id")
            .eq("id", requestedOwnerId)
            .eq("company_id", companyId)
            .is("deleted_at", null)
            .maybeSingle();
        if (requestedOwnerError) {
          throw new Error(
            `Failed to validate requested thread ownership: ${requestedOwnerError.message}`
          );
        }
        if (!ownedRequestedOpportunity) {
          return NextResponse.json(
            { error: "EMAIL_THREAD_OWNERSHIP_INVALID" },
            { status: 409 }
          );
        }
        if (
          requestedOpportunityId &&
          requestedOwnerId !== requestedOpportunityId
        ) {
          return NextResponse.json(
            { error: "EMAIL_THREAD_OWNERSHIP_CONFLICT" },
            { status: 409 }
          );
        }
      }
    }

    // ── Markdown → HTML conversion ─────────────────────────────────────────
    const isMarkdown = format === "markdown";
    const authoredSendBody = isMarkdown
      ? markdownToEmailHtml(emailBody)
      : emailBody;
    const sendContentType = isMarkdown ? ("html" as const) : ("text" as const);
    const signature = await resolveEmailSignatureForMessage({
      supabase,
      connection,
      userId,
      refreshProviderIfMissing: true,
    });
    if (effectiveLearningAuthority === "autonomous" && !signature) {
      return NextResponse.json(
        { error: "EMAIL_SIGNATURE_REQUIRED", reason: "signature_required" },
        { status: 409 }
      );
    }
    const sendBody = signature
      ? renderEmailBodyWithSignature({
          body: authoredSendBody,
          contentType: sendContentType,
          signature,
        })
      : authoredSendBody;

    // ── Send via provider ─────────────────────────────────────────────────
    const provider = EmailService.getProvider(connection);
    const sendResult = await provider.sendEmail({
      to,
      cc: cc || [],
      subject,
      body: sendBody,
      contentType: sendContentType,
      inReplyTo,
      threadId,
    });
    const sentAt = new Date();
    confirmedDelivery = {
      messageId:
        typeof sendResult.messageId === "string" ? sendResult.messageId : null,
      threadId:
        typeof sendResult.threadId === "string" ? sendResult.threadId : null,
      from: connection.email,
      sentAt: sentAt.toISOString(),
    };
    const providerIds = validateProviderEmailIds({
      boundary: "email_send_provider_result",
      providerThreadId: sendResult.threadId,
      providerMessageId: sendResult.messageId,
      requireMessageId: true,
    });

    if (!providerIds.ok) {
      logInvalidProviderEmailIds(providerIds, {
        companyId,
        connectionId: connection.id,
        opportunityId: requestedOpportunityId,
        userId,
        subject,
      });
      return NextResponse.json(
        {
          ok: true,
          delivered: true,
          reconciliationPending: true,
          reason: "EMAIL_SEND_INVALID_PROVIDER_IDS",
          ...confirmedDelivery,
        },
        { status: 202 }
      );
    }

    const providerMessageId = providerIds.providerMessageId!;
    const providerThreadId = providerIds.providerThreadId;

    // ── Resolve canonical provider-thread ownership ────────────────────────
    // The provider's returned thread id is authoritative. Claim it before any
    // activity, correspondence, projection, or inbox-thread write, then read
    // the first-writer winner back. A caller may omit opportunityId and safely
    // inherit an existing owner; it may never redirect an owned thread.
    if (requestedOpportunityId) {
      const { error: threadClaimError } = await supabase
        .from("opportunity_email_threads")
        .upsert(
          {
            opportunity_id: requestedOpportunityId,
            thread_id: providerThreadId,
            connection_id: connection.id,
          },
          { onConflict: "thread_id,connection_id", ignoreDuplicates: true }
        );
      if (threadClaimError) {
        throw new Error(
          `Sent email thread claim failed: ${threadClaimError.message ?? "unknown error"}`
        );
      }
    }

    const { data: canonicalThreadLink, error: canonicalThreadLinkError } =
      await supabase
        .from("opportunity_email_threads")
        .select("opportunity_id")
        .eq("thread_id", providerThreadId)
        .eq("connection_id", connection.id)
        .limit(1)
        .maybeSingle();
    if (canonicalThreadLinkError) {
      throw new Error(
        `Sent email canonical thread lookup failed: ${canonicalThreadLinkError.message ?? "unknown error"}`
      );
    }

    const canonicalOpportunityId = canonicalThreadLink?.opportunity_id ?? null;
    if (canonicalOpportunityId) {
      const { data: ownedCanonicalOpportunity, error: canonicalOwnerError } =
        await supabase
          .from("opportunities")
          .select("id")
          .eq("id", canonicalOpportunityId)
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .maybeSingle();
      if (canonicalOwnerError) {
        throw new Error(
          `Failed to validate canonical thread ownership: ${canonicalOwnerError.message}`
        );
      }
      if (!ownedCanonicalOpportunity) {
        throw new Error("EMAIL_THREAD_OWNERSHIP_INVALID_AFTER_DELIVERY");
      }
    }

    // The preflight rejects every conflict visible before send. A concurrent
    // first writer can still win while the provider request is in flight, or
    // the provider can return a different established thread. The email is
    // already irreversible at this point: adopt the verified same-company
    // canonical owner and report success so manual/auto-send never retries and
    // delivers a duplicate customer message.
    const threadOwnershipReconciled = Boolean(
      requestedOpportunityId &&
      canonicalOpportunityId &&
      canonicalOpportunityId !== requestedOpportunityId
    );
    if (threadOwnershipReconciled) {
      console.warn("[email-send] canonical thread owner won after send", {
        companyId,
        connectionId: connection.id,
        providerThreadId,
        requestedOpportunityId,
        canonicalOpportunityId,
      });
    }

    const effectiveOpportunityId =
      canonicalOpportunityId ?? requestedOpportunityId;

    // ── Create outbound activity ──────────────────────────────────────────
    // Uses direct insert (like sync-engine) to populate extended fields
    // (body_text, to_emails, cc_emails) that the Activity type omits.
    // body_text stores the original markdown (for in-app display).
    // content stores a plain-text snippet (first 500 chars of source text).
    const { data: insertedActivity, error: activityError } = await supabase
      .from("activities")
      .insert({
        company_id: companyId,
        type: "email",
        subject,
        content: emailBody.substring(0, 500),
        body_text: emailBody,
        email_connection_id: connection.id,
        email_message_id: providerMessageId,
        email_thread_id: providerThreadId,
        opportunity_id: effectiveOpportunityId,
        direction: "outbound",
        from_email: connection.email,
        to_emails: to,
        cc_emails: cc || [],
        has_attachments: false,
        attachment_count: 0,
        is_read: true,
        created_by: userId,
        // Keep activity chronology aligned with the irreversible provider
        // delivery rather than the later database insert.
        created_at: sentAt.toISOString(),
        // Link back to ai_draft_history when this send originated from an AI draft.
        // Populated by the auto-send cron via the draft_history_id field on
        // pending_auto_sends. Manual sends omit this. Requires migration
        // 20260508120000_activities_draft_history_link.sql to be applied.
        draft_history_id: validatedDraftHistoryId,
      })
      .select("id")
      .single();

    let canonicalActivity = insertedActivity as Record<string, unknown> | null;
    if ((activityError as { code?: string } | null)?.code === "23505") {
      // Provider delivery is irreversible. A mailbox sync can observe the
      // sent message and win this insert race, so recover only the exact
      // connection-scoped activity selected by the database invariant. Never
      // adopt an opaque provider id from another tenant/mailbox, and never
      // guess if legacy data contains more than one candidate.
      const { data: racedActivities, error: racedActivityError } =
        await supabase
          .from("activities")
          .select(
            "id, company_id, email_connection_id, email_message_id, email_thread_id, opportunity_id, type, direction"
          )
          .eq("company_id", companyId)
          .eq("email_connection_id", connection.id)
          .eq("email_message_id", providerMessageId)
          .limit(2);

      if (racedActivityError) {
        throw new Error(
          `Sent email canonical activity lookup failed: ${racedActivityError.message ?? "unknown error"}`
        );
      }

      const candidates = (racedActivities ?? []) as Array<
        Record<string, unknown>
      >;
      if (candidates.length !== 1) {
        throw new Error(
          "Sent email activity conflict did not resolve to exactly one same-mailbox activity"
        );
      }

      const candidate = candidates[0];
      const candidateIsCanonical =
        typeof candidate.id === "string" &&
        candidate.id.length > 0 &&
        candidate.company_id === companyId &&
        candidate.email_connection_id === connection.id &&
        candidate.email_message_id === providerMessageId &&
        candidate.email_thread_id === providerThreadId &&
        candidate.type === "email" &&
        candidate.direction === "outbound";
      if (!candidateIsCanonical) {
        throw new Error(
          "Sent email activity conflict resolved to an invalid canonical activity"
        );
      }

      canonicalActivity = candidate;
      console.warn("[email-send] provider sync won activity persistence race", {
        companyId,
        connectionId: connection.id,
        providerMessageId,
        activityId: candidate.id,
      });
    } else if (activityError || !canonicalActivity) {
      throw new Error(
        `Sent email activity persistence failed: ${activityError?.message ?? "insert returned no row"}`
      );
    }

    const correspondenceResult =
      await OpportunityLifecycleService.recordCorrespondenceEvent({
        supabase,
        companyId,
        opportunityId: effectiveOpportunityId,
        activityId: (canonicalActivity?.id as string | null) ?? null,
        connectionId: connection.id,
        providerThreadId,
        providerMessageId,
        requireProviderMessageId: true,
        direction: "outbound",
        occurredAt: sentAt,
        source: "email_send",
        applyOpportunityProjection: true,
        fromEmail: connection.email,
        fromName: connection.email,
        toEmails: to,
        ccEmails: cc || [],
        subject,
        bodyText: emailBody,
        connectionEmail: connection.email,
        companyDomains: connection.syncFilters?.companyDomains ?? [],
        userEmailAddresses: connection.syncFilters?.userEmailAddresses ?? [],
        knownPlatformSenders:
          connection.syncFilters?.knownPlatformSenders ?? [],
      });
    if (
      effectiveOpportunityId &&
      !correspondenceResult.created &&
      correspondenceResult.reason !== "duplicate_provider_message_id"
    ) {
      throw new Error(
        `Sent email correspondence persistence failed: ${correspondenceResult.reason}`
      );
    }

    if (effectiveOpportunityId) {
      const { data: projectionRows, error: projectionError } =
        await supabase.rpc("apply_opportunity_correspondence_event", {
          p_company_id: companyId,
          p_opportunity_id: effectiveOpportunityId,
          p_connection_id: connection.id,
          p_provider_message_id: providerMessageId,
        });
      if (projectionError || !projectionRows) {
        throw new Error(
          `Sent email correspondence projection failed: ${projectionError?.message ?? "RPC returned no rows"}`
        );
      }
    }

    const { threadRow } = await EmailThreadService.upsertFromEmail({
      companyId,
      connectionId: connection.id,
      providerThreadId,
      email: {
        id: providerMessageId,
        threadId: providerThreadId,
        from: connection.email,
        fromName: connection.email,
        to,
        cc: cc || [],
        subject,
        snippet: emailBody,
        bodyText: emailBody,
        date: sentAt,
        labelIds: [],
        isRead: true,
        hasAttachments: false,
        sizeEstimate: emailBody.length,
      },
      direction: "outbound",
      opportunityId: effectiveOpportunityId,
    });
    const outboundIsLatest = threadRow.latestDirection === "outbound";
    const labels =
      outboundIsLatest && threadRow.labels.includes("AWAITING_REPLY")
        ? await EmailThreadService.dismissAwaitingReply(threadRow.id, companyId)
        : threadRow.labels;

    // ── Apply OPS Pipeline label ──────────────────────────────────────────
    if (connection.opsLabelId) {
      try {
        await provider.applyLabel(providerThreadId, connection.opsLabelId);
      } catch (labelErr) {
        // Non-fatal — label application failure shouldn't block send
        console.error("[email-send] Failed to apply label:", labelErr);
      }
    }

    // Persist only the cleaned immutable sample here. The cron worker performs
    // model extraction and atomically applies profile/memory receipts later.
    // Draft/lifecycle identifiers travel with the same job so their sent state
    // is not lost when inline GPT work is removed from this irreversible path.
    const outboundLearningTask = new EmailOutboundLearningService(supabase)
      .enqueueIfEnabled({
        companyId,
        connectionId: connection.id,
        providerMessageId,
        providerThreadId,
        userId,
        fromEmail: connection.email,
        toEmails: to,
        subject,
        bodyText: emailBody,
        occurredAt: sentAt,
        draftHistoryId: validatedDraftHistoryId,
        followUpDraftId: validatedFollowUpDraftId,
        draftDeliveryChannel: validatedDraftHistoryId ? "ops_send" : null,
        opportunityId: effectiveOpportunityId,
        profileType: validatedDraftProfileType,
        learningAuthority: effectiveLearningAuthority,
      })
      .catch((learningError) => {
        console.error(
          "[email-send] outbound learning enqueue failed after delivery:",
          learningError
        );
        return null;
      });
    await waitForPostDeliveryEnqueue(outboundLearningTask);

    return NextResponse.json({
      ok: true,
      messageId: providerMessageId,
      threadId: providerThreadId,
      from: connection.email,
      sentAt: sentAt.toISOString(),
      labels,
      latestDirection: threadRow.latestDirection,
      opportunityId: effectiveOpportunityId,
      threadOwnershipReconciled,
    });
  } catch (err) {
    console.error("[email-send]", err);
    if (confirmedDelivery) {
      // Provider delivery is irreversible. Returning a retryable error here
      // makes both the manual composer and auto-send deliver the same message
      // again. Provider sync repairs the database by immutable provider ID.
      return NextResponse.json(
        {
          ok: true,
          delivered: true,
          reconciliationPending: true,
          reason:
            err instanceof Error
              ? err.message
              : "POST_DELIVERY_RECONCILIATION_FAILED",
          ...confirmedDelivery,
        },
        { status: 202 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
