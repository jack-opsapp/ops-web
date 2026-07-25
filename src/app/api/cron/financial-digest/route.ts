/**
 * GET /api/cron/financial-digest
 * Vercel cron: runs weekly on Monday at 7am UTC.
 * Generates financial intelligence digests for phase_c companies.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { FinancialIntelligenceService } from "@/lib/api/services/financial-intelligence-service";
import { runBoundedPhaseCCompanyFanout } from "@/lib/api/services/cron-company-fanout-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { getCompanyManagerUserIds } from "@/lib/api/services/company-managers";

export const maxDuration = 300;

const WORKLOAD_KEY = "financial-digest";
const COMPANY_LIMIT = 3;

type DigestResult = {
  companyId: string;
  digestProposed: boolean;
  error?: string;
};

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
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: 360,
      work: (lease) =>
        runBoundedPhaseCCompanyFanout<DigestResult>({
          supabase,
          workloadKey: WORKLOAD_KEY,
          lease,
          companyLimit: COMPANY_LIMIT,
          processCompany: async (companyId) => {
            const adminUserId = (
              await getCompanyManagerUserIds(supabase, companyId)
            )[0];
            if (!adminUserId) {
              return {
                companyId,
                digestProposed: false,
                error: "No admin user found",
              };
            }

            const actionId =
              await FinancialIntelligenceService.generateFinancialDigest(
                companyId,
                adminUserId
              );
            return { companyId, digestProposed: Boolean(actionId) };
          },
          onCompanyError: (companyId, error) => {
            const message =
              error instanceof Error ? error.message : "Unknown error";
            console.error(
              `[cron/financial-digest] Company ${companyId}:`,
              message
            );
            return {
              companyId,
              digestProposed: false,
              error: message,
            };
          },
        }),
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          ok: alreadyRunning,
          ran: false,
          reason: alreadyRunning ? "already_running" : controlled.reason,
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }

    const results = controlled.value.results;
    const totalProposed = results.filter((r) => r.digestProposed).length;
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      companiesProcessed: controlled.value.companyIds.length,
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
