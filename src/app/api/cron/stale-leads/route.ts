/**
 * GET /api/cron/stale-leads (triggered hourly by Vercel cron)
 *
 * Scans for threads in categories that support auto_follow_up where:
 *   - archived_at IS NULL
 *   - snoozed_until IS NULL (or past)
 *   - last_message_at older than STALE_DAYS
 *   - latest_direction = 'outbound' (we replied, they didn't)
 *
 * For each match, invokes PhaseCAutonomyRouter.route — the router consults
 * the per-category autonomy level. Only categories flipped to
 * `auto_follow_up` (LEAD or CLIENT) will actually schedule a nudge; other
 * configs are a safe no-op.
 *
 * Auth via CRON_SECRET Bearer header. Bounded batch of 100 per run.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { mapEmailThreadFromDb } from "@/lib/types/email-thread";
import { PhaseCAutonomyRouter } from "@/lib/api/services/phase-c-autonomy-router";

export const maxDuration = 120;

const MAX_THREADS_PER_RUN = 100;
const STALE_DAYS = 7;

/**
 * Only run the router for categories where auto_follow_up is a valid setting.
 * Other categories will either not have the setting or will no-op — scoping
 * the query here saves a lot of wasted work.
 */
const FOLLOW_UP_CATEGORIES = ["CUSTOMER"] as const;

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
  const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();

  try {
    const { data: rows, error } = await supabase
      .from("email_threads")
      .select("*")
      .in("primary_category", FOLLOW_UP_CATEGORIES as readonly string[])
      .is("archived_at", null)
      .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`)
      .eq("latest_direction", "outbound")
      .lt("last_message_at", cutoff)
      .order("last_message_at", { ascending: true })
      .limit(MAX_THREADS_PER_RUN);

    if (error) {
      return NextResponse.json(
        { error: `Query failed: ${error.message}` },
        { status: 500 }
      );
    }

    const threads = (rows ?? []).map((r) => mapEmailThreadFromDb(r as Record<string, unknown>));

    let scheduled = 0;
    let skipped = 0;
    let failed = 0;

    for (const thread of threads) {
      try {
        const result = await runWithSupabase(supabase, () =>
          PhaseCAutonomyRouter.route(thread)
        );
        if (result.outcome === "auto_follow_up_scheduled") scheduled += 1;
        else if (result.outcome === "error") failed += 1;
        else skipped += 1;
      } catch (err) {
        failed += 1;
        console.error(
          "[cron/stale-leads] router failed for",
          thread.id,
          err instanceof Error ? err.message : err
        );
      }
    }

    console.log(
      `[cron/stale-leads] processed=${threads.length} scheduled=${scheduled} skipped=${skipped} failed=${failed}`
    );

    return NextResponse.json({
      ok: true,
      processed: threads.length,
      scheduled,
      skipped,
      failed,
    });
  } catch (err) {
    console.error("[cron/stale-leads] fatal:", err);
    return NextResponse.json(
      { error: `Cron failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
