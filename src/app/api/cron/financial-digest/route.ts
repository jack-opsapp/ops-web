/**
 * GET /api/cron/financial-digest
 * Vercel cron: runs weekly on Monday at 7am UTC.
 * Generates financial intelligence digests for phase_c companies.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { FinancialIntelligenceService } from "@/lib/api/services/financial-intelligence-service";
import {
  runBoundedPhaseCCompanyFanout,
  type CronCompanyFanoutRetryState,
} from "@/lib/api/services/cron-company-fanout-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { getCompanyManagerUserIds } from "@/lib/api/services/company-managers";

export const maxDuration = 300;

const WORKLOAD_KEY = "financial-digest";
const COMPANY_LIMIT = 3;

type DigestResult = {
  companyId: string;
  digestProposed: boolean;
  disposition: "success" | "not_actionable" | "retryable";
  reason?: "no_admin_user";
  error?: string;
};

function reportableDigestResults(results: DigestResult[]): DigestResult[] {
  return results.filter(
    (result) =>
      result.digestProposed ||
      result.disposition === "not_actionable" ||
      result.error
  );
}

class FinancialDigestRunError extends Error {
  readonly results: DigestResult[];
  readonly retry: CronCompanyFanoutRetryState;

  constructor(
    results: DigestResult[],
    retry: CronCompanyFanoutRetryState,
    cause?: unknown
  ) {
    const failedCount = results.filter(
      (result) => result.disposition === "retryable"
    ).length;
    super(
      `Financial digest failed for ${failedCount} of ${results.length} companies`,
      cause === undefined ? undefined : { cause }
    );
    this.name = "FinancialDigestRunError";
    this.results = reportableDigestResults(results);
    this.retry = retry;
  }
}

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
      work: async (lease) => {
        const fanout = await runBoundedPhaseCCompanyFanout<DigestResult>({
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
                disposition: "not_actionable",
                reason: "no_admin_user",
              };
            }

            const actionId =
              await FinancialIntelligenceService.generateFinancialDigest(
                companyId,
                adminUserId
              );
            return {
              companyId,
              digestProposed: Boolean(actionId),
              disposition: "success",
            };
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
              disposition: "retryable",
              error: message,
            };
          },
          retryPolicy: {
            maxAttempts: 3,
            classifyResult: (result) =>
              result.disposition === "not_actionable"
                ? "permanent"
                : result.disposition,
          },
        });

        if (fanout.retry?.status === "scheduled") {
          throw new FinancialDigestRunError(
            fanout.results,
            fanout.retry,
            fanout.failureCause
          );
        }

        return fanout;
      },
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
    const errors = results.filter((r) => r.disposition === "retryable");
    const nonActionable = results.filter(
      (r) => r.disposition === "not_actionable"
    ).length;

    return NextResponse.json({
      ok: controlled.value.retry?.status !== "exhausted",
      companiesProcessed: controlled.value.companyIds.length,
      digestsProposed: totalProposed,
      errors: errors.length,
      nonActionable,
      retry: controlled.value.retry,
      details: reportableDigestResults(results),
    });
  } catch (err) {
    if (err instanceof FinancialDigestRunError) {
      console.error("[cron/financial-digest]", err.message);
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          retry: err.retry,
          results: err.results,
        },
        { status: 500 }
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/financial-digest]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
