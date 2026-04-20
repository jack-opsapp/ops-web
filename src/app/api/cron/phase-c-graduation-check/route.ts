/**
 * GET /api/cron/phase-c-graduation-check (daily)
 *
 * Walks every active company × every email connection × every primary
 * category. For each (company, user, category) tuple where:
 *   - the mapped profile_type has >= 20 finalized drafts
 *   - AND approval rate >= 0.95
 *   - AND the current autonomy level is still `auto_draft` (not yet graduated)
 * …creates a PERSISTENT notification inviting the user to graduate that
 * category to auto_send.
 *
 * The notification is keyed by title (`NotificationService.create` dedupes on
 * title while the notification remains unread) so re-running the cron is safe.
 *
 * Auth via CRON_SECRET Bearer header.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { PhaseCCategoryAutonomy } from "@/lib/api/services/phase-c-category-autonomy-service";
import { NotificationService } from "@/lib/api/services/notification-service";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import { categoryLabel } from "@/components/ops/inbox/category-chip";

export const maxDuration = 300;

const MAX_CONNECTIONS_PER_RUN = 200;

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
    const { data: connections } = await supabase
      .from("email_connections")
      .select("id, company_id, user_id")
      .eq("status", "active")
      .limit(MAX_CONNECTIONS_PER_RUN);

    const rows =
      (connections as Array<{
        id: string;
        company_id: string;
        user_id: string | null;
      }> | null) ?? [];

    let checked = 0;
    let notified = 0;
    let failed = 0;

    for (const conn of rows) {
      if (!conn.user_id) continue;
      try {
        await runWithSupabase(supabase, async () => {
          const levels = await PhaseCCategoryAutonomy.get(conn.id);

          for (const category of EMAIL_THREAD_CATEGORIES as readonly EmailThreadCategory[]) {
            checked += 1;

            // Only categories where the user is currently at auto_draft are
            // candidates — below auto_draft means they haven't opted in yet,
            // above auto_draft means they've already graduated.
            if (levels[category] !== "auto_draft") continue;

            const status = await PhaseCCategoryAutonomy.isGraduated(
              conn.company_id,
              conn.user_id!,
              category
            );
            if (!status.ready) continue;

            const label = categoryLabel(category);
            await NotificationService.create({
              userId: conn.user_id!,
              companyId: conn.company_id,
              type: "ai_milestone",
              title: `Phase C is ready to auto-respond to ${label}`,
              body: `${Math.round(status.approvalRate * 100)}% approval over ${status.sampleSize} drafts. Open Settings to graduate.`,
              persistent: true,
              actionUrl: "/settings/email-category-autonomy",
              actionLabel: "Graduate",
            });
            notified += 1;
          }
        });
      } catch (err) {
        failed += 1;
        console.error(
          "[cron/phase-c-graduation-check] failed for",
          conn.id,
          err instanceof Error ? err.message : err
        );
      }
    }

    console.log(
      `[cron/phase-c-graduation-check] connections=${rows.length} checked=${checked} notified=${notified} failed=${failed}`
    );

    return NextResponse.json({
      ok: true,
      connections: rows.length,
      checked,
      notified,
      failed,
    });
  } catch (err) {
    console.error("[cron/phase-c-graduation-check] fatal:", err);
    return NextResponse.json(
      { error: `Cron failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
