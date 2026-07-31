/**
 * /api/cron/email/auto-resume
 *
 * Runs every 5 minutes. Reads `email_pause_state` for any rows where
 * `is_paused = true` AND `paused_until < now()`, then calls `autoResume()`
 * on each — which writes an `auto_resume` audit row, clears the pause flag,
 * and resolves any persistent rail notifications for that scope.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { autoResume, type PauseScope } from "@/lib/email/pause";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const supabase = getServiceRoleClient();
  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "email-auto-resume",
      leaseSeconds: 120,
      work: async () => {
        let expired: Array<{ scope: string }> | null;
        try {
          const result = await supabase
            .from("email_pause_state")
            .select("scope")
            .eq("is_paused", true)
            .not("paused_until", "is", null)
            .lt("paused_until", new Date().toISOString())
            .order("paused_until", { ascending: true })
            .limit(25);
          if (result.error) {
            throw new CronDatabaseOperationError(
              `Email auto-resume read failed: ${result.error.message}`,
              { cause: result.error }
            );
          }
          expired = result.data as Array<{ scope: string }> | null;
        } catch (cause) {
          if (cause instanceof CronDatabaseOperationError) throw cause;
          throw new CronDatabaseOperationError(
            "Email auto-resume read failed",
            { cause }
          );
        }

        const resumed: string[] = [];
        const failures: { scope: string; error: string }[] = [];
        for (const row of expired ?? []) {
          try {
            await autoResume(row.scope as PauseScope, {
              abortOnDatabaseError: true,
            });
            resumed.push(row.scope);
          } catch (error) {
            if (error instanceof CronDatabaseOperationError) throw error;
            const message =
              error instanceof Error ? error.message : String(error);
            console.error("[auto-resume]", row.scope, message);
            failures.push({ scope: row.scope, error: message });
          }
        }
        return {
          ok: true,
          checked: (expired ?? []).length,
          resumed,
          failures,
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
  } catch (error) {
    console.error("[auto-resume] fatal:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Email auto-resume failed",
      },
      { status: 500 }
    );
  }
}
