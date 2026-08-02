import { NextRequest, NextResponse } from "next/server";
import {
  CronDatabaseOperationError,
  CronWorkloadLeaseLostError,
  runWithCronWorkloadControl,
  type CronWorkloadLease,
} from "@/lib/api/services/cron-workload-control-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { eraseSiteVisitPrefix } from "@/lib/s3/site-visit-prefix-erasure";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMPANY_BATCH_SIZE = 25;
const WORKLOAD_KEY = "site-visit-storage-erasure";

async function runSiteVisitErasure(
  db: ReturnType<typeof getServiceRoleClient>,
  lease: CronWorkloadLease
) {
  const companies: Array<{
    id: string;
    deleted_at: string | null;
  }> = [];
  for (let offset = 0; ; offset += COMPANY_BATCH_SIZE) {
    if (lease.signal.aborted) {
      throw new CronWorkloadLeaseLostError(
        "site-visit storage erasure lost its workload lease"
      );
    }
    const { data, error } = await db
      .from("companies")
      .select("id, deleted_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + COMPANY_BATCH_SIZE - 1);

    if (error) {
      throw new CronDatabaseOperationError(
        `Site-visit erasure company scan failed: ${error.message}`,
        { cause: error }
      );
    }

    const page = (data ?? []) as Array<{
      id: string;
      deleted_at: string | null;
    }>;
    companies.push(...page);
    if (page.length < COMPANY_BATCH_SIZE) break;
  }

  const eligible = companies.filter(
    (company): company is { id: string; deleted_at: string } =>
      typeof company.id === "string" && company.deleted_at !== null
  );
  const failures: Array<{ companyId: string; error: string }> = [];
  let erasedCompanies = 0;
  let deletedObjects = 0;

  for (const company of eligible) {
    if (lease.signal.aborted) {
      throw new CronWorkloadLeaseLostError(
        "site-visit storage erasure lost its workload lease"
      );
    }
    try {
      const result = await eraseSiteVisitPrefix(company.id);
      erasedCompanies += 1;
      deletedObjects += result.deleted;
    } catch (cause) {
      failures.push({
        companyId: company.id,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return {
    ok: failures.length === 0,
    scanned: companies.length,
    eligible: eligible.length,
    erasedCompanies,
    deletedObjects,
    failures,
  };
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceRoleClient();
  try {
    const controlled = await runWithCronWorkloadControl({
      supabase: db,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: 360,
      work: (lease) => runSiteVisitErasure(db, lease),
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

    const result = controlled.value;
    if (result.failures.length > 0) {
      console.error(
        "[cron/storage/site-visit-erasure]",
        JSON.stringify(result)
      );
    } else {
      console.warn(
        "[cron/storage/site-visit-erasure]",
        JSON.stringify(result)
      );
    }
    return NextResponse.json(result, {
      status: result.failures.length > 0 ? 500 : 200,
    });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "site-visit erasure failed";
    console.error("[cron/storage/site-visit-erasure]", message, cause);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
