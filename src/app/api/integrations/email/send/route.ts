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
import { markdownToEmailHtml } from "@/lib/utils/markdown-to-email-html";
import { extractEmailAddress } from "@/lib/utils/email-parsing";
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

    // ── Create outbound activity ──────────────────────────────────────────
    // Uses direct insert (like sync-engine) to populate extended fields
    // (body_text, to_emails, cc_emails) that the Activity type omits.
    // body_text stores the original markdown (for in-app display).
    // content stores a plain-text snippet (first 500 chars of source text).
    await supabase.from("activities").insert({
      company_id: companyId,
      type: "email",
      subject,
      content: emailBody.substring(0, 500),
      body_text: emailBody,
      email_message_id: sendResult.messageId,
      email_thread_id: sendResult.threadId,
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
    });

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
      if (sendResult.threadId) {
        await supabase.from("opportunity_email_threads").upsert(
          {
            opportunity_id: opportunityId,
            thread_id: sendResult.threadId,
            connection_id: connection.id,
          },
          { onConflict: "thread_id,connection_id", ignoreDuplicates: true }
        );
      }
    }

    // ── Apply OPS Pipeline label ──────────────────────────────────────────
    if (connection.opsLabelId && sendResult.threadId) {
      try {
        await provider.applyLabel(sendResult.threadId, connection.opsLabelId);
      } catch (labelErr) {
        // Non-fatal — label application failure shouldn't block send
        console.error("[email-send] Failed to apply label:", labelErr);
      }
    }

    return NextResponse.json({
      ok: true,
      messageId: sendResult.messageId,
      threadId: sendResult.threadId,
      from: connection.email,
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
