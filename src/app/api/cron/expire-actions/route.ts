/**
 * POST /api/cron/expire-actions
 * Vercel cron: runs daily. Expires stale pending agent actions past their expires_at.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const maxDuration = 60;

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

  console.log("[expire-actions] Starting expiry cycle");

  try {
    const { data, error } = await supabase
      .from("agent_actions")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString())
      .select("id");

    if (error) {
      console.error("[expire-actions] Expiry failed:", error.message);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const expired = data?.length ?? 0;
    console.log(`[expire-actions] Expired ${expired} stale actions`);

    return NextResponse.json({ ok: true, expired });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[expire-actions] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
