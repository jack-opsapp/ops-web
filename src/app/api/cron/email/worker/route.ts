/**
 * /api/cron/email/worker
 *
 * Runs every minute. Atomically claims up to BATCH_LIMIT pending jobs
 * (FOR UPDATE SKIP LOCKED via the `claim_email_jobs` RPC), invokes the
 * registered campaign template's gatedSend wrapper for each, and updates
 * email_jobs + email_campaigns counters. When all jobs for a campaign are
 * terminal, transitions the campaign to `completed` and inserts a
 * notification onto the rail for the operator who scheduled it.
 *
 * Auth: Bearer ${CRON_SECRET}. Service-role DB only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { completeCampaignIfDone } from "@/lib/email/campaigns";
import { bootstrapCampaignTemplates } from "@/lib/email/campaign-templates-bootstrap";
import { getCampaignTemplate } from "@/lib/email/campaign-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_LIMIT = 200;
const INTER_SEND_DELAY_MS = 10;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ClaimedJob {
  id: string;
  campaign_id: string;
  recipient_email: string;
  recipient_user_id: string | null;
  template_payload: Record<string, unknown>;
  retry_count: number;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  bootstrapCampaignTemplates();
  const db = getServiceRoleClient();

  const { data: claimed, error: claimErr } = await db.rpc("claim_email_jobs", {
    p_limit: BATCH_LIMIT,
  });
  if (claimErr) {
    console.error("[email-worker] claim failed:", claimErr);
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }

  const jobs = (claimed ?? []) as ClaimedJob[];

  // Look up the template + status for each campaign once per batch.
  const campaignIds = Array.from(new Set(jobs.map((j) => j.campaign_id)));
  const campaignMap = new Map<
    string,
    { template_id: string; send_status: string; name: string; created_by_user_id: string | null }
  >();

  if (campaignIds.length > 0) {
    const { data: campaigns } = await db
      .from("email_campaigns")
      .select("id, template_id, send_status, name, created_by_user_id")
      .in("id", campaignIds);
    for (const c of campaigns ?? []) {
      campaignMap.set(c.id, {
        template_id: c.template_id,
        send_status: c.send_status,
        name: c.name,
        created_by_user_id: c.created_by_user_id,
      });
    }
  }

  // Per-campaign tallies for notification body.
  const tallies = new Map<
    string,
    { sent: number; bounced: number; failed: number; skipped: number }
  >();
  const tally = (cid: string) => {
    let t = tallies.get(cid);
    if (!t) {
      t = { sent: 0, bounced: 0, failed: 0, skipped: 0 };
      tallies.set(cid, t);
    }
    return t;
  };

  let totalSent = 0;
  let totalBounced = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const job of jobs) {
    const campaign = campaignMap.get(job.campaign_id);

    // Campaign was paused or cancelled while this batch was claimed —
    // re-pend (paused) or finalise as cancelled (cancelled). Pause logic
    // hardens in PR 4 with the killswitch state machine.
    if (
      !campaign ||
      campaign.send_status === "paused" ||
      campaign.send_status === "cancelled"
    ) {
      await db
        .from("email_jobs")
        .update({
          status: campaign?.send_status === "cancelled" ? "cancelled" : "pending",
        })
        .eq("id", job.id);
      continue;
    }

    const tpl = getCampaignTemplate(campaign.template_id);
    if (!tpl) {
      await db
        .from("email_jobs")
        .update({
          status: "failed",
          last_error: `unknown template_id ${campaign.template_id}`,
        })
        .eq("id", job.id);
      await db.rpc("increment_campaign_counter", {
        p_campaign_id: job.campaign_id,
        p_field: "failed_count",
        p_delta: 1,
      });
      tally(job.campaign_id).failed++;
      totalFailed++;
      continue;
    }

    try {
      const result = await tpl.sender({
        recipientEmail: job.recipient_email,
        recipientUserId: job.recipient_user_id,
        payload: job.template_payload,
        campaignId: job.campaign_id,
      });

      if (result.status === "suppression_skipped") {
        await db
          .from("email_jobs")
          .update({ status: "skipped_suppressed" })
          .eq("id", job.id);
        await db.rpc("increment_campaign_counter", {
          p_campaign_id: job.campaign_id,
          p_field: "suppressed_skipped_count",
          p_delta: 1,
        });
        tally(job.campaign_id).skipped++;
        totalSkipped++;
      } else {
        await db
          .from("email_jobs")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            sg_message_id: result.messageId,
          })
          .eq("id", job.id);
        await db.rpc("increment_campaign_counter", {
          p_campaign_id: job.campaign_id,
          p_field: "sent_count",
          p_delta: 1,
        });
        tally(job.campaign_id).sent++;
        totalSent++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const newRetry = job.retry_count + 1;
      const finalFail = newRetry >= MAX_RETRIES;
      await db
        .from("email_jobs")
        .update({
          status: finalFail ? "failed" : "pending",
          retry_count: newRetry,
          last_error: message.slice(0, 1000),
        })
        .eq("id", job.id);
      if (finalFail) {
        await db.rpc("increment_campaign_counter", {
          p_campaign_id: job.campaign_id,
          p_field: "failed_count",
          p_delta: 1,
        });
        tally(job.campaign_id).failed++;
        totalFailed++;
      }
    }

    // Pace ourselves so a 200-job batch doesn't smash the SendGrid API.
    await sleep(INTER_SEND_DELAY_MS);
  }

  // After processing, complete any campaigns with no remaining work and
  // post a notification rail entry for the originating operator.
  for (const cid of campaignIds) {
    const completed = await completeCampaignIfDone(cid, db);
    if (!completed) continue;

    const meta = campaignMap.get(cid);
    if (!meta?.created_by_user_id) continue;

    const { data: u } = await db
      .from("users")
      .select("company_id")
      .eq("id", meta.created_by_user_id)
      .maybeSingle();

    const t = tally(cid);
    const summaryBits: string[] = [];
    if (t.sent > 0) summaryBits.push(`${t.sent} delivered`);
    if (t.bounced > 0) summaryBits.push(`${t.bounced} bounced`);
    if (t.failed > 0) summaryBits.push(`${t.failed} failed`);
    if (t.skipped > 0) summaryBits.push(`${t.skipped} suppressed`);
    const body =
      summaryBits.length > 0
        ? `${summaryBits.join(", ")}. Open the campaign to see numbers.`
        : "Campaign finished. Open it to review the run.";

    await db
      .from("notifications")
      .insert({
        user_id: meta.created_by_user_id,
        company_id: u?.company_id ?? null,
        type: "campaign_done",
        title: `Campaign sent: ${meta.name}`,
        body,
        is_read: false,
        persistent: false,
        action_url: `/admin/email?campaign=${cid}`,
        action_label: "VIEW CAMPAIGN",
      })
      .select()
      .maybeSingle();
  }

  return NextResponse.json({
    ok: true,
    claimed: jobs.length,
    sent: totalSent,
    bounced: totalBounced,
    failed: totalFailed,
    skipped: totalSkipped,
  });
}
