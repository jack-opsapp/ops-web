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
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  const nowIso = new Date().toISOString();

  const { data: expired, error } = await supabase
    .from("email_pause_state")
    .select("scope")
    .eq("is_paused", true)
    .not("paused_until", "is", null)
    .lt("paused_until", nowIso);

  if (error) {
    console.error("[auto-resume] read failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const resumed: string[] = [];
  const failures: { scope: string; error: string }[] = [];

  for (const row of expired ?? []) {
    try {
      await autoResume(row.scope as PauseScope);
      resumed.push(row.scope);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[auto-resume]", row.scope, msg);
      failures.push({ scope: row.scope, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: (expired ?? []).length,
    resumed,
    failures,
  });
}
