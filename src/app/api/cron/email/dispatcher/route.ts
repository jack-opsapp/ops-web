/**
 * /api/cron/email/dispatcher
 *
 * Runs every 20 minutes on an isolated offset. Picks up to N campaigns whose
 * scheduled_for has
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
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const READY_BATCH = 2;

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
  try {
    const controlled = await runWithCronWorkloadControl({
      supabase: db,
      workloadKey: "email-campaign-dispatch",
      leaseSeconds: 360,
      work: async () => {
        const nowIso = new Date().toISOString();

        const { data: ready, error } = await db
          .from("email_campaigns")
          .select("id, name, audience_filter, audience_template_id")
          .eq("send_status", "scheduled")
          .lte("scheduled_for", nowIso)
          .order("scheduled_for", { ascending: true })
          .limit(READY_BATCH);

        if (error) {
          throw new CronDatabaseOperationError(
            `Email campaign read failed: ${error.message}`,
            { cause: error }
          );
        }

        const results: Array<{
          id: string;
          enqueued: number;
          suppressedSkipped: number;
          error?: string;
        }> = [];

        for (const c of ready ?? []) {
          try {
            let filter = (c.audience_filter ?? {}) as Record<string, unknown>;
            if (c.audience_template_id) {
              const { data: tpl, error: templateError } = await db
                .from("email_audience_templates")
                .select("filter")
                .eq("id", c.audience_template_id)
                .maybeSingle();
              if (templateError) {
                throw new CronDatabaseOperationError(
                  `Email audience template lookup failed: ${templateError.message}`,
                  { cause: templateError }
                );
              }
              if (tpl) {
                filter = (tpl.filter ?? {}) as Record<string, unknown>;
                const { error: incErr } = await db.rpc(
                  "increment_audience_template_usage",
                  { p_template_id: c.audience_template_id }
                );
                if (incErr) {
                  throw new CronDatabaseOperationError(
                    `Email audience template usage update failed: ${incErr.message}`,
                    { cause: incErr }
                  );
                }
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
            if (isDatabasePressureError(err)) throw err;
            const message = err instanceof Error ? err.message : String(err);
            console.error(
              `[email-dispatcher] campaign ${c.id} failed:`,
              message
            );
            // Mark campaign failed so it doesn't retry on every scheduled run.
            const { error: markFailedError } = await db
              .from("email_campaigns")
              .update({ send_status: "failed" })
              .eq("id", c.id);
            if (markFailedError) {
              throw new CronDatabaseOperationError(
                `Email campaign failure update failed: ${markFailedError.message}`,
                { cause: markFailedError }
              );
            }
            results.push({
              id: c.id,
              enqueued: 0,
              suppressedSkipped: 0,
              error: message,
            });
          }
        }

        return NextResponse.json({
          ok: true,
          processed: results.length,
          results,
        });
      },
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
    console.error("[email-dispatcher]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
