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

    type HealthResult = {
      companyId: string;
      overdueTasks: number;
      archivableProjects: number;
      error?: string;
    };

    // Filter to phase_c companies first
    const phaseCCompanyIds: string[] = [];
    for (const company of companies ?? []) {
      const companyId = company.id as string;
      const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
        companyId,
        "phase_c"
      );
      if (enabled) phaseCCompanyIds.push(companyId);
    }

    // Process in parallel chunks of 5 to avoid timeout
    const CHUNK_SIZE = 5;
    const results: HealthResult[] = [];

    for (let i = 0; i < phaseCCompanyIds.length; i += CHUNK_SIZE) {
      const chunk = phaseCCompanyIds.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (companyId): Promise<HealthResult> => {
          const [overdueTasks, archivableProjects] = await Promise.all([
            ProjectLifecycleService.detectOverdueTasks(companyId),
            ProjectLifecycleService.detectArchivableProjects(companyId),
          ]);
          return { companyId, overdueTasks, archivableProjects };
        })
      );

      for (let j = 0; j < chunkResults.length; j++) {
        const r = chunkResults[j];
        if (r.status === "fulfilled") {
          if (r.value.overdueTasks > 0 || r.value.archivableProjects > 0) {
            results.push(r.value);
          }
        } else {
          const message =
            r.reason instanceof Error ? r.reason.message : "Unknown error";
          console.error(
            `[project-health] Error for company ${chunk[j]}:`,
            message
          );
          results.push({
            companyId: chunk[j],
            overdueTasks: 0,
            archivableProjects: 0,
            error: message,
          });
        }
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
