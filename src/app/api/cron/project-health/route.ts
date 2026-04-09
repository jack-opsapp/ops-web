/**
 * POST /api/cron/project-health
 * Vercel cron: runs daily at 8am UTC.
 * Detects overdue tasks and archivable projects for all phase_c companies.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ProjectLifecycleService } from "@/lib/api/services/project-lifecycle-service";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

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
    // Find all companies with active subscriptions
    const { data: companies, error } = await supabase
      .from("companies")
      .select("id")
      .limit(500);

    if (error) throw error;

    const results: Array<{
      companyId: string;
      overdueTasks: number;
      archivableProjects: number;
      error?: string;
    }> = [];

    for (const company of companies ?? []) {
      const companyId = company.id as string;

      // Gate behind phase_c
      const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
        companyId,
        "phase_c"
      );
      if (!enabled) continue;

      try {
        const [overdueTasks, archivableProjects] = await Promise.all([
          ProjectLifecycleService.detectOverdueTasks(companyId),
          ProjectLifecycleService.detectArchivableProjects(companyId),
        ]);

        if (overdueTasks > 0 || archivableProjects > 0) {
          results.push({ companyId, overdueTasks, archivableProjects });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(
          `[project-health] Error for company ${companyId}:`,
          message
        );
        results.push({
          companyId,
          overdueTasks: 0,
          archivableProjects: 0,
          error: message,
        });
      }
    }

    console.log(
      `[project-health] Processed ${results.length} companies with findings`
    );

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[project-health] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
