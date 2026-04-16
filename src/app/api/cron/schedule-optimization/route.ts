/**
 * GET /api/cron/schedule-optimization
 * Vercel cron: runs daily at 5am UTC (before crews start their day).
 * Analyzes schedules for today and tomorrow, proposing optimizations
 * for phase_c companies.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ScheduleOptimizationService } from "@/lib/api/services/schedule-optimization-service";
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
    // Find all companies
    const { data: companies, error } = await supabase
      .from("companies")
      .select("id, admin_ids")
      .limit(500);

    if (error) throw error;

    // Filter to phase_c companies
    const allCompanyIds = (companies ?? []).map((c) => c.id as string);
    const phaseCChecks = await Promise.allSettled(
      allCompanyIds.map(async (companyId) => {
        const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
          companyId,
          "phase_c"
        );
        return { companyId, enabled };
      })
    );
    const phaseCCompanyIds = phaseCChecks
      .filter(
        (r): r is PromiseFulfilledResult<{ companyId: string; enabled: boolean }> =>
          r.status === "fulfilled" && r.value.enabled
      )
      .map((r) => r.value.companyId);

    // Build company → admin user map
    const companyAdminMap = new Map<string, string>();
    for (const company of companies ?? []) {
      const companyId = company.id as string;
      if (!phaseCCompanyIds.includes(companyId)) continue;

      const adminIdsStr = company.admin_ids as string;
      if (adminIdsStr) {
        const firstAdmin = adminIdsStr
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)[0];
        if (firstAdmin) companyAdminMap.set(companyId, firstAdmin);
      }
    }

    type OptResult = {
      companyId: string;
      today: { proposed: number; conflicts: number; unassigned: number } | null;
      tomorrow: { proposed: number; conflicts: number; unassigned: number } | null;
      error?: string;
    };

    // Process in parallel batches of 10
    const CHUNK_SIZE = 10;
    const results: OptResult[] = [];
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    for (let i = 0; i < phaseCCompanyIds.length; i += CHUNK_SIZE) {
      const chunk = phaseCCompanyIds.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (companyId): Promise<OptResult> => {
          const adminUserId = companyAdminMap.get(companyId);
          if (!adminUserId) {
            console.warn(
              `[cron/schedule-optimization] company ${companyId}: no admin user found`
            );
            return {
              companyId,
              today: null,
              tomorrow: null,
              error: "No admin user found",
            };
          }

          try {
            // Optimize today: catch conflicts and unassigned tasks
            const todayResult =
              await ScheduleOptimizationService.suggestScheduleOptimizations(
                companyId,
                adminUserId,
                today
              );

            // Optimize tomorrow: proactive route planning
            const tomorrowResult =
              await ScheduleOptimizationService.suggestScheduleOptimizations(
                companyId,
                adminUserId,
                tomorrow
              );

            console.log(
              `[cron/schedule-optimization] ${companyId}: ` +
                `today=${todayResult.proposed} (conflicts=${todayResult.conflicts}, unassigned=${todayResult.unassigned}) ` +
                `tomorrow=${tomorrowResult.proposed} (conflicts=${tomorrowResult.conflicts}, unassigned=${tomorrowResult.unassigned})`
            );

            return {
              companyId,
              today: todayResult,
              tomorrow: tomorrowResult,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error(
              `[cron/schedule-optimization] ${companyId} failed:`,
              message
            );
            return {
              companyId,
              today: null,
              tomorrow: null,
              error: message,
            };
          }
        })
      );

      for (let j = 0; j < chunkResults.length; j++) {
        const r = chunkResults[j];
        if (r.status === "fulfilled") {
          results.push(r.value);
        } else {
          const message = r.reason?.message ?? "Unknown error";
          console.error(
            `[cron/schedule-optimization] ${chunk[j]} rejected:`,
            message
          );
          results.push({
            companyId: chunk[j],
            today: null,
            tomorrow: null,
            error: message,
          });
        }
      }
    }

    const totalProposed = results.reduce(
      (sum, r) =>
        sum + (r.today?.proposed ?? 0) + (r.tomorrow?.proposed ?? 0),
      0
    );
    const totalConflicts = results.reduce(
      (sum, r) =>
        sum + (r.today?.conflicts ?? 0) + (r.tomorrow?.conflicts ?? 0),
      0
    );
    const totalUnassigned = results.reduce(
      (sum, r) =>
        sum + (r.today?.unassigned ?? 0) + (r.tomorrow?.unassigned ?? 0),
      0
    );
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      companiesProcessed: phaseCCompanyIds.length,
      optimizationsProposed: totalProposed,
      conflictsFound: totalConflicts,
      unassignedFound: totalUnassigned,
      errors: errors.length,
      details: results.filter(
        (r) =>
          (r.today?.proposed ?? 0) > 0 ||
          (r.tomorrow?.proposed ?? 0) > 0 ||
          r.error
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/schedule-optimization]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
