/**
 * /api/cron/email/worker
 *
 * Runs every 20 minutes on an isolated offset. Atomically claims up to
 * BATCH_LIMIT pending jobs
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
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_LIMIT = 25;
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

function databaseErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function requireDatabaseOperation<T>(
  operation: string,
  execute: () => PromiseLike<T>
): Promise<T> {
  try {
    return await execute();
  } catch (cause) {
    if (cause instanceof CronDatabaseOperationError) throw cause;
    throw new CronDatabaseOperationError(
      `${operation} failed: ${databaseErrorMessage(cause)}`,
      { cause }
    );
  }
}

async function requireDatabaseResponse<T extends { error: unknown }>(
  operation: string,
  execute: () => PromiseLike<T>
): Promise<T> {
  const response = await requireDatabaseOperation(operation, execute);
  if (response.error) {
    throw new CronDatabaseOperationError(
      `${operation} failed: ${databaseErrorMessage(response.error)}`,
      { cause: response.error }
    );
  }
  return response;
}

async function runWorkerRequest(request: NextRequest) {
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

  const { data: claimed } = await requireDatabaseResponse(
    "Email campaign job claim",
    () =>
      db.rpc("claim_email_jobs", {
        p_limit: BATCH_LIMIT,
      })
  );

  const jobs = (claimed ?? []) as ClaimedJob[];

  // Look up the template + status for each campaign once per batch.
  const campaignIds = Array.from(new Set(jobs.map((j) => j.campaign_id)));
  const campaignMap = new Map<
    string,
    {
      template_id: string;
      send_status: string;
      name: string;
      created_by_user_id: string | null;
    }
  >();

  if (campaignIds.length > 0) {
    const { data: campaigns } = await requireDatabaseResponse(
      "Email campaign metadata lookup",
      () =>
        db
          .from("email_campaigns")
          .select("id, template_id, send_status, name, created_by_user_id")
          .in("id", campaignIds)
    );
    for (const c of campaigns ?? []) {
      campaignMap.set(c.id, {
        template_id: c.template_id,
        send_status: c.send_status,
        name: c.name,
        created_by_user_id: c.created_by_user_id,
      });
    }
  }

  // PR 4 — campaign-scope killswitch. For every campaign in this batch,
  // resolve whether `email_pause_state` has an active `campaign:<uuid>`
  // pause. We check once per campaign (not per job) to keep this fast.
  // Paused jobs stay in 'pending' so they're reconsidered next minute —
  // pauses are reversible, so we never flip them to a terminal status here.
  const campaignPauseMap = new Map<string, boolean>();
  for (const cid of campaignIds) {
    const { data: pauseState } = await requireDatabaseResponse(
      "Email campaign pause lookup",
      () =>
        db
          .from("email_pause_state")
          .select("is_paused")
          .eq("scope", `campaign:${cid}`)
          .maybeSingle()
    );
    campaignPauseMap.set(cid, pauseState?.is_paused === true);
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
  // Bounces arrive via the SendGrid webhook (PR 6), not in the worker
  // dispatch path — the counter is reported here for API stability and
  // populated upstream by the webhook handler.
  const totalBounced = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const job of jobs) {
    const campaign = campaignMap.get(job.campaign_id);

    // Campaign was paused or cancelled while this batch was claimed —
    // re-pend (paused) or finalise as cancelled (cancelled). PR 4 adds the
    // `email_pause_state` killswitch as an additional pause source — the
    // operator can pause a campaign without touching `email_campaigns.send_status`.
    const killswitchPaused = campaignPauseMap.get(job.campaign_id) === true;
    if (
      !campaign ||
      campaign.send_status === "paused" ||
      campaign.send_status === "cancelled" ||
      killswitchPaused
    ) {
      await requireDatabaseResponse("Email campaign job defer", () =>
        db
          .from("email_jobs")
          .update({
            status:
              campaign?.send_status === "cancelled" ? "cancelled" : "pending",
          })
          .eq("id", job.id)
      );
      continue;
    }

    const tpl = getCampaignTemplate(campaign.template_id);
    if (!tpl) {
      await requireDatabaseResponse("Email campaign job template failure", () =>
        db
          .from("email_jobs")
          .update({
            status: "failed",
            last_error: `unknown template_id ${campaign.template_id}`,
          })
          .eq("id", job.id)
      );
      await requireDatabaseResponse("Email campaign failed counter", () =>
        db.rpc("increment_campaign_counter", {
          p_campaign_id: job.campaign_id,
          p_field: "failed_count",
          p_delta: 1,
        })
      );
      tally(job.campaign_id).failed++;
      totalFailed++;
      continue;
    }

    let providerAccepted = false;
    try {
      const result = await tpl.sender({
        recipientEmail: job.recipient_email,
        recipientUserId: job.recipient_user_id,
        payload: job.template_payload,
        campaignId: job.campaign_id,
      });

      if (result.status === "suppression_skipped") {
        await requireDatabaseResponse(
          "Email campaign suppression finalization",
          () =>
            db
              .from("email_jobs")
              .update({ status: "skipped_suppressed" })
              .eq("id", job.id)
        );
        await requireDatabaseResponse(
          "Email campaign suppression counter",
          () =>
            db.rpc("increment_campaign_counter", {
              p_campaign_id: job.campaign_id,
              p_field: "suppressed_skipped_count",
              p_delta: 1,
            })
        );
        tally(job.campaign_id).skipped++;
        totalSkipped++;
      } else if (result.status === "paused_skipped") {
        // Killswitch fired between the campaign-pause batch read and this
        // dispatch (eg. global pause flipped on, or a bucket pause matched
        // this kind). Pause is reversible — leave the job pending so it's
        // reconsidered next minute. The email_log row already records the
        // paused_skipped attempt with the resolving scope.
        await requireDatabaseResponse("Email campaign pause defer", () =>
          db.from("email_jobs").update({ status: "pending" }).eq("id", job.id)
        );
      } else {
        providerAccepted = true;
        await requireDatabaseResponse("Email campaign send finalization", () =>
          db
            .from("email_jobs")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              sg_message_id: result.messageId,
            })
            .eq("id", job.id)
        );
        await requireDatabaseResponse("Email campaign sent counter", () =>
          db.rpc("increment_campaign_counter", {
            p_campaign_id: job.campaign_id,
            p_field: "sent_count",
            p_delta: 1,
          })
        );
        tally(job.campaign_id).sent++;
        totalSent++;
      }
    } catch (err) {
      if (providerAccepted || isDatabasePressureError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const newRetry = job.retry_count + 1;
      const finalFail = newRetry >= MAX_RETRIES;
      await requireDatabaseResponse("Email campaign send retry", () =>
        db
          .from("email_jobs")
          .update({
            status: finalFail ? "failed" : "pending",
            retry_count: newRetry,
            last_error: message.slice(0, 1000),
          })
          .eq("id", job.id)
      );
      if (finalFail) {
        await requireDatabaseResponse("Email campaign failed counter", () =>
          db.rpc("increment_campaign_counter", {
            p_campaign_id: job.campaign_id,
            p_field: "failed_count",
            p_delta: 1,
          })
        );
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
    const completed = await requireDatabaseOperation(
      "Email campaign completion",
      () => completeCampaignIfDone(cid, db)
    );
    if (!completed) continue;

    const meta = campaignMap.get(cid);
    if (!meta?.created_by_user_id) continue;

    const { data: u } = await requireDatabaseResponse(
      "Email campaign operator lookup",
      () =>
        db
          .from("users")
          .select("company_id")
          .eq("id", meta.created_by_user_id)
          .maybeSingle()
    );

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

    await requireDatabaseResponse("Email campaign notification insert", () =>
      db
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
        .maybeSingle()
    );
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

  const db = getServiceRoleClient();
  try {
    const controlled = await runWithCronWorkloadControl({
      supabase: db,
      workloadKey: "email-campaign-worker",
      leaseSeconds: 360,
      work: () => runWorkerRequest(request),
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          ok: alreadyRunning,
          ran: false,
          reason: alreadyRunning ? "already_running" : controlled.reason,
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }

    return controlled.value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[email-worker]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
