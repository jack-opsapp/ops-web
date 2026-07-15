/**
 * GET /api/cron/auto-execute-actions
 * Vercel cron: runs every 5 minutes.
 *
 * Processes pending agent_actions whose auto_execute_at has passed. These
 * were created by the various auto-send autonomy levels (appointment
 * confirmations at auto_send_on_confirm/full_auto, appointment reminders at
 * auto_send, etc.) with a cancellable delay. If the user doesn't reject the
 * action before auto_execute_at, this cron approves and executes it.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ApprovalQueueService } from "@/lib/api/services/approval-queue-service";

export const maxDuration = 300;

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
  setSupabaseOverride(supabase);

  try {
    const now = new Date().toISOString();

    // Find pending actions whose auto_execute_at has passed
    const { data: dueActions, error } = await supabase
      .from("agent_actions")
      .select("id, company_id, user_id, action_type")
      .eq("status", "pending")
      .not("auto_execute_at", "is", null)
      .lte("auto_execute_at", now)
      .limit(100);

    if (error) throw error;

    const results: Array<{
      actionId: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const row of dueActions ?? []) {
      const actionId = row.id as string;
      const companyId = row.company_id as string;
      const userId = row.user_id as string;

      try {
        await ApprovalQueueService.approveAction(
          actionId,
          companyId,
          userId,
          undefined,
          { learningAuthority: "autonomous" }
        );
        results.push({ actionId, success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({ actionId, success: false, error: message });
        console.error(
          `[cron/auto-execute-actions] ${actionId} failed:`,
          message
        );
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      ok: true,
      dueCount: dueActions?.length ?? 0,
      succeeded,
      failed,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/auto-execute-actions]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // Clear the module-level override so concurrent requests on the same
    // warm instance don't inherit this cron's service-role client. Without
    // this, a subsequent user-facing API route would implicitly bypass RLS.
    setSupabaseOverride(null);
  }
}
