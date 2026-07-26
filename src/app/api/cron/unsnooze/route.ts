/**
 * POST /api/cron/unsnooze (triggered via GET from Vercel cron)
 *
 * Finds email_threads with snoozed_until <= now() and restores them:
 *   - clears snoozed_until in the DB
 *   - re-applies INBOX (Gmail) / moves back to inbox (M365) via provider
 *
 * Runs every 5 minutes (vercel.json). Auth via CRON_SECRET Bearer header.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";

export const maxDuration = 60;

const MAX_THREADS_PER_RUN = 10;

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

  const supabase = getServiceRoleClient();

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "email-unsnooze",
      leaseSeconds: 120,
      work: async () => {
        let due: Array<{ id: string }> | null;
        try {
          const result = await supabase
            .from("email_threads")
            .select("id")
            .not("snoozed_until", "is", null)
            .lte("snoozed_until", new Date().toISOString())
            .is("archived_at", null)
            .order("snoozed_until", { ascending: true })
            .limit(MAX_THREADS_PER_RUN);
          if (result.error) {
            throw new CronDatabaseOperationError(
              `Unsnooze query failed: ${result.error.message}`,
              { cause: result.error }
            );
          }
          due = result.data as Array<{ id: string }> | null;
        } catch (cause) {
          if (cause instanceof CronDatabaseOperationError) throw cause;
          throw new CronDatabaseOperationError("Unsnooze query failed", {
            cause,
          });
        }

        const rows = due ?? [];
        let succeeded = 0;
        let failed = 0;
        for (const row of rows) {
          try {
            await runWithSupabase(supabase, () =>
              EmailThreadService.unsnooze(row.id)
            );
            succeeded += 1;
          } catch (error) {
            if (error instanceof CronDatabaseOperationError) throw error;
            failed += 1;
            console.error(
              "[cron/unsnooze] unsnooze failed for",
              row.id,
              error instanceof Error ? error.message : error
            );
          }
        }
        console.warn(
          `[cron/unsnooze] processed=${rows.length} succeeded=${succeeded} failed=${failed}`
        );
        return {
          ok: true,
          processed: rows.length,
          succeeded,
          failed,
        };
      },
    });

    if (controlled.status === "skipped") {
      const reason =
        controlled.reason === "lease_held"
          ? "already_running"
          : controlled.reason;
      return NextResponse.json(
        {
          ok: controlled.reason === "lease_held",
          ran: false,
          reason,
        },
        { status: controlled.reason === "lease_held" ? 200 : 503 }
      );
    }
    return NextResponse.json(controlled.value);
  } catch (err) {
    console.error("[cron/unsnooze] fatal:", err);
    return NextResponse.json(
      { error: `Cron failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
