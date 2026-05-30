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
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { EmailService } from "@/lib/api/services/email-service";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { OpportunityLifecycleService } from "@/lib/api/services/opportunity-lifecycle-service";
import {
  AIDraftService,
  LIFECYCLE_LEARNING_ENABLED,
} from "@/lib/api/services/ai-draft-service";
import { markdownToEmailHtml } from "@/lib/utils/markdown-to-email-html";
import { extractEmailAddress } from "@/lib/utils/email-parsing";
import {
  logInvalidProviderEmailIds,
  validateProviderEmailIds,
} from "@/lib/email/provider-email-ids";
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

/** Minimal snake_case → camelCase mapper for subscription gating. */
function mapSubscriptionRow(row: Record<string, unknown>): CompanySubscriptionFields {
  return {
    subscriptionPlan: (row.subscription_plan as SubscriptionPlan) ?? null,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) ?? null,
    trialEndDate: row.trial_end_date ? new Date(row.trial_end_date as string) : null,
    seatedEmployeeIds: (row.seated_employee_ids as string[]) ?? [],
    adminIds: (row.admin_ids as string[]) ?? [],
    maxSeats: (row.max_seats as number) ?? 10,
  };
}

// Lifecycle drafts that surface in the operator inbox and are sent by hand.
// Mirrors the origin allowlist in /api/inbox/drafts.
const LIFECYCLE_DRAFT_ORIGINS = ["template_follow_up", "phase_c"] as const;

type SendSupabaseClient = ReturnType<typeof getServiceRoleClient>;

/**
 * Mark a lifecycle follow-up draft sent and run the P4-D learning pipeline.
 *
 * Resolution: prefer an explicit `followUpDraftId` (the precise, unambiguous
 * signal). Failing that, resolve the *single* still-`drafted` lifecycle draft
 * for this (opportunity, provider thread) pair — the universal signals every
 * operator send already carries. If the thread/opportunity pair maps to more
 * than one open draft we do nothing (ambiguous → no guess, no wrong learning).
 *
 * Idempotent: the status flip is conditioned on `status = 'drafted'`, so a
 * draft already `sent` updates zero rows and we skip the learning call. A
 * second send of the same draft therefore re-processes nothing.
 *
 * Operator-only: the caller gates this behind `!isInternalCaller`; this helper
 * is never reached on the auto-send/cron path.
 */
async function handleLifecycleDraftSendTransition(args: {
  supabase: SendSupabaseClient;
  companyId: string;
  userId: string;
  followUpDraftId: string | null;
  opportunityId: string | null;
  providerThreadId: string | null;
  finalBody: string;
  finalSubject: string;
}): Promise<void> {
  const {
    supabase,
    companyId,
    userId,
    followUpDraftId,
    opportunityId,
    providerThreadId,
    finalBody,
    finalSubject,
  } = args;

  // ── Resolve the draft this send corresponds to ───────────────────────────
  let draftId: string | null = null;

  if (followUpDraftId) {
    const { data } = await supabase
      .from("opportunity_follow_up_drafts")
      .select("id, status")
      .eq("id", followUpDraftId)
      .eq("company_id", companyId)
      .in("origin", LIFECYCLE_DRAFT_ORIGINS as unknown as string[])
      .maybeSingle();
    // Only a still-open draft is eligible. An already-sent / discarded row is
    // a no-op (idempotency + abandoned drafts never learn).
    if (data && (data as { status: string }).status === "drafted") {
      draftId = (data as { id: string }).id;
    } else {
      return;
    }
  } else if (opportunityId && providerThreadId) {
    // Fallback: the (opportunity, thread) pair must map to exactly one open
    // lifecycle draft. Zero → not a lifecycle send. More than one → ambiguous,
    // so we refuse to guess.
    const { data: candidates } = await supabase
      .from("opportunity_follow_up_drafts")
      .select("id")
      .eq("company_id", companyId)
      .eq("opportunity_id", opportunityId)
      .eq("provider_thread_id", providerThreadId)
      .in("origin", LIFECYCLE_DRAFT_ORIGINS as unknown as string[])
      .eq("status", "drafted");
    if (!candidates || candidates.length !== 1) return;
    draftId = (candidates[0] as { id: string }).id;
  } else {
    return;
  }

  // ── Flip the draft to sent (idempotent) ──────────────────────────────────
  // The `status = 'drafted'` filter is the idempotency guard: a re-send of an
  // already-sent draft updates nothing, so we never re-record or re-learn.
  const now = new Date().toISOString();
  const { data: updatedRows } = await supabase
    .from("opportunity_follow_up_drafts")
    .update({
      status: "sent",
      final_sent_body: finalBody,
      subject: finalSubject,
      sent_at: now,
      edited_by: userId,
      updated_at: now,
    })
    .eq("id", draftId)
    .eq("company_id", companyId)
    .eq("status", "drafted")
    .select("id");

  // Lost the race / already sent → another path beat us here; do not learn.
  if (!updatedRows || updatedRows.length === 0) return;

  // ── Learning (gated) ──────────────────────────────────────────────────────
  // LIFECYCLE_LEARNING_ENABLED is the documented go-live switch: now that the
  // send-transition exists, flipping that flag to true (in ai-draft-service.ts)
  // turns lifecycle-draft learning on. recordLifecycleDraftOutcome already
  // learns only from SENT drafts and only on >threshold edits.
  if (LIFECYCLE_LEARNING_ENABLED) {
    await AIDraftService.recordLifecycleDraftOutcome(
      draftId,
      companyId,
      userId,
      finalBody,
      finalSubject
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    // ── Auth: verify caller identity ─────────────────────────────────────
    // Internal callers (auto-send cron) pass CRON_SECRET to bypass user auth
    const authHeader = request.headers.get("authorization");
    const isInternalCaller = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isInternalCaller) {
      const authUser = await verifyAdminAuth(request);
      if (!authUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
      if (!user) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

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
    } = payload;

    // ── Validate required fields ──────────────────────────────────────────
    if (!userId || !companyId) {
      return NextResponse.json(
        { error: "userId and companyId are required" },
        { status: 400 }
      );
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
      console.error("[email-send] company subscription lookup failed:", companyError);
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
        connections.find(
          (c) => c.status === "active" && c.userId === userId
        ) ||
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

    // ── Markdown → HTML conversion ─────────────────────────────────────────
    const isMarkdown = format === "markdown";
    const sendBody = isMarkdown ? markdownToEmailHtml(emailBody) : emailBody;
    const sendContentType = isMarkdown ? ("html" as const) : ("text" as const);

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
        opportunityId: opportunityId || null,
        userId,
        subject,
      });
      return NextResponse.json(
        { error: "EMAIL_SEND_INVALID_PROVIDER_IDS" },
        { status: 502 }
      );
    }

    const providerMessageId = providerIds.providerMessageId!;
    const providerThreadId = providerIds.providerThreadId;

    // ── Create outbound activity ──────────────────────────────────────────
    // Uses direct insert (like sync-engine) to populate extended fields
    // (body_text, to_emails, cc_emails) that the Activity type omits.
    // body_text stores the original markdown (for in-app display).
    // content stores a plain-text snippet (first 500 chars of source text).
    const { data: insertedActivity } = await supabase.from("activities").insert({
      company_id: companyId,
      type: "email",
      subject,
      content: emailBody.substring(0, 500),
      body_text: emailBody,
      email_message_id: providerMessageId,
      email_thread_id: providerThreadId,
      opportunity_id: opportunityId || null,
      direction: "outbound",
      from_email: connection.email,
      to_emails: to,
      cc_emails: cc || [],
      has_attachments: false,
      attachment_count: 0,
      is_read: true,
      created_by: userId,
      // Link back to ai_draft_history when this send originated from an AI draft.
      // Populated by the auto-send cron via the draft_history_id field on
      // pending_auto_sends. Manual sends omit this. Requires migration
      // 20260508120000_activities_draft_history_link.sql to be applied.
      draft_history_id: draftHistoryId || null,
    }).select("id").single();

    await OpportunityLifecycleService.recordCorrespondenceEvent({
      supabase,
      companyId,
      opportunityId: opportunityId || null,
      activityId:
        ((insertedActivity as Record<string, unknown> | null)?.id as string | null) ??
        null,
      connectionId: connection.id,
      providerThreadId,
      providerMessageId,
      requireProviderMessageId: true,
      direction: "outbound",
      occurredAt: sentAt,
      source: "email_send",
      fromEmail: connection.email,
      fromName: connection.email,
      toEmails: to,
      ccEmails: cc || [],
      subject,
      bodyText: emailBody,
      connectionEmail: connection.email,
      companyDomains: connection.syncFilters?.companyDomains ?? [],
      userEmailAddresses: connection.syncFilters?.userEmailAddresses ?? [],
      knownPlatformSenders: connection.syncFilters?.knownPlatformSenders ?? [],
    });

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
      opportunityId: opportunityId || null,
    });
    const outboundIsLatest = threadRow.latestDirection === "outbound";
    const labels =
      outboundIsLatest && threadRow.labels.includes("AWAITING_REPLY")
        ? await EmailThreadService.dismissAwaitingReply(threadRow.id, companyId)
        : threadRow.labels;

    // ── Update correspondence counts on linked opportunity ────────────────
    if (opportunityId) {
      const { data: opp } = await supabase
        .from("opportunities")
        .select(
          "correspondence_count, outbound_count, last_outbound_at"
        )
        .eq("id", opportunityId)
        .single();

      if (opp) {
        const now = new Date();
        const existingOutbound = opp.last_outbound_at
          ? new Date(opp.last_outbound_at)
          : null;

        await supabase
          .from("opportunities")
          .update({
            correspondence_count: (opp.correspondence_count || 0) + 1,
            outbound_count: (opp.outbound_count || 0) + 1,
            last_outbound_at:
              !existingOutbound || now > existingOutbound
                ? now.toISOString()
                : opp.last_outbound_at,
            last_message_direction: "out",
            last_activity_at: now.toISOString(),
          })
          .eq("id", opportunityId);
      }

      // Link thread → opportunity if not already linked
      await supabase.from("opportunity_email_threads").upsert(
        {
          opportunity_id: opportunityId,
          thread_id: providerThreadId,
          connection_id: connection.id,
        },
        { onConflict: "thread_id,connection_id", ignoreDuplicates: true }
      );
    }

    // ── Apply OPS Pipeline label ──────────────────────────────────────────
    if (connection.opsLabelId) {
      try {
        await provider.applyLabel(providerThreadId, connection.opsLabelId);
      } catch (labelErr) {
        // Non-fatal — label application failure shouldn't block send
        console.error("[email-send] Failed to apply label:", labelErr);
      }
    }

    // ── Lifecycle follow-up draft send-transition (operator-only) ─────────
    // When this send corresponds to a lifecycle follow-up draft
    // (opportunity_follow_up_drafts, origin template_follow_up | phase_c), mark
    // that draft sent and feed the operator's final body/subject into the P4-D
    // learning pipeline. This is the ONLY correct trigger for lifecycle-draft
    // learning — the real operator-send path. It must NEVER fire on an
    // autonomous path: the auto-send cron authenticates with CRON_SECRET
    // (isInternalCaller === true), and we skip the whole block for it. We never
    // auto-send email, so no system path can reach this.
    if (!isInternalCaller) {
      try {
        await handleLifecycleDraftSendTransition({
          supabase,
          companyId,
          userId,
          followUpDraftId:
            typeof followUpDraftId === "string" ? followUpDraftId : null,
          opportunityId: opportunityId || null,
          providerThreadId,
          finalBody: emailBody,
          finalSubject: subject,
        });
      } catch (lifecycleErr) {
        // Non-fatal — the email already sent successfully. A learning-pipeline
        // failure must not surface as a send failure to the operator.
        console.error(
          "[email-send] lifecycle send-transition failed:",
          lifecycleErr
        );
      }
    }

    return NextResponse.json({
      ok: true,
      messageId: providerMessageId,
      threadId: providerThreadId,
      from: connection.email,
      sentAt: sentAt.toISOString(),
      labels,
      latestDirection: threadRow.latestDirection,
    });
  } catch (err) {
    console.error("[email-send]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
