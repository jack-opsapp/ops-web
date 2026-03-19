/**
 * POST /api/cron/auto-send
 * Vercel cron: runs every 5 min, processes pending auto-send emails.
 *
 * For each pending_auto_sends row where scheduled_send_at <= now:
 * 1. Verify auto-send is still enabled for the connection
 * 2. Send the email via /api/integrations/email/send
 * 3. Update status to sent/failed
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { AutoSendService } from "@/lib/api/services/auto-send-service";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
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
  setSupabaseOverride(supabase);

  try {
    const result = await AutoSendService.processPendingSends();

    console.log(
      `[cron/auto-send] Processed: ${result.sent} sent, ${result.failed} failed`
    );

    if (result.errors.length > 0) {
      console.error("[cron/auto-send] Errors:", result.errors);
    }

    return NextResponse.json({
      ok: true,
      sent: result.sent,
      failed: result.failed,
      errors: result.errors.length,
    });
  } catch (err) {
    console.error("[cron/auto-send]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cron failed" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
