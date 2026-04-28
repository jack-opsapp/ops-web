/**
 * /api/cron/email/dispatcher
 *
 * Runs every minute. Picks up to N campaigns whose scheduled_for has
 * passed, resolves the audience, enqueues one email_jobs row per opted-in
 * recipient, and transitions the campaign to in_flight (or completed when
 * the audience is empty after suppression).
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { resolveAudience } from "@/lib/email/audiences";
import { enqueueCampaignJobs } from "@/lib/email/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const READY_BATCH = 5;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceRoleClient();
  const nowIso = new Date().toISOString();

  const { data: ready, error } = await db
    .from("email_campaigns")
    .select("id, name, audience_filter, audience_template_id")
    .eq("send_status", "scheduled")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(READY_BATCH);

  if (error) {
    console.error("[email-dispatcher] read failed:", error);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  const results: Array<{
    id: string;
    enqueued: number;
    suppressedSkipped: number;
    error?: string;
  }> = [];

  for (const c of ready ?? []) {
    try {
      // PR 5 introduces email_audience_templates; PR 3 falls back to the
      // inline audience_filter when the template table doesn't exist.
      let filter = (c.audience_filter ?? {}) as Record<string, unknown>;
      if (c.audience_template_id) {
        const { data: tpl } = await db
          .from("email_audience_templates")
          .select("filter")
          .eq("id", c.audience_template_id)
          .maybeSingle();
        if (tpl) {
          filter = (tpl.filter ?? {}) as Record<string, unknown>;
          await db
            .rpc("increment_audience_template_usage" as never, {
              p_template_id: c.audience_template_id,
            } as never)
            .then((res) => {
              if (res.error) {
                // PR 5 RPC absent in PR 3 — swallow silently.
              }
            })
            .then(() => undefined, () => undefined);
        }
      }

      const { recipients } = await resolveAudience(filter, db);
      const recipientList = recipients.map((r) => ({
        email: r.email,
        userId: r.userId,
        payload: { recipient_user_id: r.userId },
      }));

      const result = await enqueueCampaignJobs({
        campaignId: c.id,
        recipients: recipientList,
        client: db,
      });

      results.push({ id: c.id, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[email-dispatcher] campaign ${c.id} failed:`, message);
      // Mark campaign failed so it doesn't keep retrying every minute.
      await db
        .from("email_campaigns")
        .update({ send_status: "failed" })
        .eq("id", c.id);
      results.push({
        id: c.id,
        enqueued: 0,
        suppressedSkipped: 0,
        error: message,
      });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
