/**
 * GET /api/cron/pmf/weekly-digest
 *
 * Vercel cron: `0 15 * * 1` — 07:00 PT Mondays.
 *
 * Superset of the daily digest: current PMF state, days-to-GATE-B, ISO
 * week number, plus retention cohorts from the `pmf_retention_cohorts`
 * RPC (D30/D60/D90 by first-paid month cohort). Dispatched through
 * `sendPmfNotification` with `kind: 'weekly_digest'` (email-only).
 *
 * The RPC migration landed in
 * `supabase/migrations/20260422120001_pmf_retention_cohorts_rpc.sql`.
 * When the RPC returns `null` (no rows / migration not yet applied in
 * that env), we pass an empty array — the email template renders
 * `[NO COHORT DATA YET]` gracefully.
 */

import { NextRequest, NextResponse } from "next/server";
import { computePmfState } from "@/lib/admin/pmf-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { sendPmfNotification } from "@/lib/notifications/pmf-send";
import { weeklyDigestEmail as WeeklyDigestEmail } from "@/lib/email/pmf-bridge";
import { daysUntilGate, isoWeekNumber } from "@/lib/pmf/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DASHBOARD_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co"}/admin/pmf`;

/** Shape returned by `public.pmf_retention_cohorts()` — matches the email template prop. */
interface RetentionCohortRow {
  cohort_month: string;
  size: number;
  d30: number;
  d60: number;
  d90: number;
}

function databaseFailure(
  operation: string,
  cause: unknown
): CronDatabaseOperationError {
  if (cause instanceof CronDatabaseOperationError) return cause;
  const detail =
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
      ? cause.message
      : "unknown database error";
  return new CronDatabaseOperationError(`${operation} failed: ${detail}`, {
    cause,
  });
}

async function executeDatabaseOperation<T>(
  operation: string,
  pending: PromiseLike<T>
): Promise<T> {
  try {
    return await pending;
  } catch (cause) {
    throw databaseFailure(operation, cause);
  }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getAdminSupabase();

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase: sb,
      workloadKey: "pmf-weekly-digest",
      leaseSeconds: 90,
      work: async () => {
        // Fetch state + retention cohorts in parallel — independent work.
        const [state, cohortsResult] = await Promise.all([
          computePmfState().catch((cause) => {
            throw databaseFailure("weekly PMF state computation", cause);
          }),
          executeDatabaseOperation(
            "pmf_retention_cohorts",
            sb.rpc("pmf_retention_cohorts" as never)
          ),
        ]);

        if (cohortsResult.error) {
          throw databaseFailure("pmf_retention_cohorts", cohortsResult.error);
        }

        // The RPC's typed return is `never` (not in supabase-js generated
        // types), so bridge through `unknown` to the concrete row type.
        const cohorts: RetentionCohortRow[] =
          (cohortsResult.data as unknown as RetentionCohortRow[] | null) ?? [];

        // Hoist `now` once so the subject and body share the same values even
        // if computation straddled a day boundary.
        const now = new Date();
        const daysToGate = daysUntilGate(now);
        const weekNumber = isoWeekNumber(now);
        const today = now.toISOString().slice(0, 10);

        // Keep provider errors untagged so they fail this run without opening
        // the database-pressure circuit.
        await sendPmfNotification({
          kind: "weekly_digest",
          trigger: `weekly_${today}`,
          emailSubject: `OPS :: PMF WEEKLY · W${weekNumber} · ${daysToGate} DAYS`,
          emailReact: WeeklyDigestEmail({
            state,
            daysToGate,
            weekNumber,
            dashboardUrl: DASHBOARD_URL,
            retentionCohorts: cohorts,
          }),
        });

        return NextResponse.json({ ok: true });
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "weekly digest failed";
    console.error("[pmf-weekly-digest] failed:", message, err);
    return NextResponse.json(
      { error: "weekly digest failed" },
      { status: 500 }
    );
  }
}
