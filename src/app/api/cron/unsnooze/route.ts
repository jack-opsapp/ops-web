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

export const maxDuration = 60;

const MAX_THREADS_PER_RUN = 100;

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
    // Find due threads
    const { data: due, error } = await supabase
      .from("email_threads")
      .select("id")
      .not("snoozed_until", "is", null)
      .lte("snoozed_until", new Date().toISOString())
      .is("archived_at", null)
      .limit(MAX_THREADS_PER_RUN);

    if (error) {
      return NextResponse.json(
        { error: `Query failed: ${error.message}` },
        { status: 500 }
      );
    }

    const rows = (due ?? []) as Array<{ id: string }>;

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, processed: 0 });
    }

    let succeeded = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        await runWithSupabase(supabase, () =>
          EmailThreadService.unsnooze(row.id)
        );
        succeeded += 1;
      } catch (err) {
        failed += 1;
        console.error(
          "[cron/unsnooze] unsnooze failed for",
          row.id,
          err instanceof Error ? err.message : err
        );
      }
    }

    console.log(
      `[cron/unsnooze] processed=${rows.length} succeeded=${succeeded} failed=${failed}`
    );

    return NextResponse.json({
      ok: true,
      processed: rows.length,
      succeeded,
      failed,
    });
  } catch (err) {
    console.error("[cron/unsnooze] fatal:", err);
    return NextResponse.json(
      { error: `Cron failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
