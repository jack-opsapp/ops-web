/**
 * GET /api/cron/financial-digest
 * Vercel cron: runs weekly on Monday at 7am UTC.
 * Generates financial intelligence digests for phase_c companies.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { FinancialIntelligenceService } from "@/lib/api/services/financial-intelligence-service";
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
        const firstAdmin = adminIdsStr.split(",").map((s: string) => s.trim()).filter(Boolean)[0];
        if (firstAdmin) companyAdminMap.set(companyId, firstAdmin);
      }
    }

    type DigestResult = {
      companyId: string;
      digestProposed: boolean;
      error?: string;
    };

    // Process in parallel batches of 10
    const CHUNK_SIZE = 10;
    const results: DigestResult[] = [];

    for (let i = 0; i < phaseCCompanyIds.length; i += CHUNK_SIZE) {
      const chunk = phaseCCompanyIds.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (companyId): Promise<DigestResult> => {
          const adminUserId = companyAdminMap.get(companyId);
          if (!adminUserId) {
            return { companyId, digestProposed: false, error: "No admin user found" };
          }

          const actionId = await FinancialIntelligenceService.generateFinancialDigest(
            companyId,
            adminUserId
          );

          return { companyId, digestProposed: !!actionId };
        })
      );

      for (let j = 0; j < chunkResults.length; j++) {
        const r = chunkResults[j];
        if (r.status === "fulfilled") {
          results.push(r.value);
        } else {
          console.error(`[cron/financial-digest] Company ${chunk[j]}:`, r.reason?.message ?? "Unknown error");
          results.push({
            companyId: chunk[j],
            digestProposed: false,
            error: r.reason?.message ?? "Unknown error",
          });
        }
      }
    }

    const totalProposed = results.filter((r) => r.digestProposed).length;
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      companiesProcessed: phaseCCompanyIds.length,
      digestsProposed: totalProposed,
      errors: errors.length,
      details: results.filter((r) => r.digestProposed || r.error),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/financial-digest]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
