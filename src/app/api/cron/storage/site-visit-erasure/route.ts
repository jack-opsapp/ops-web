import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { eraseSiteVisitPrefix } from "@/lib/s3/site-visit-prefix-erasure";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMPANY_BATCH_SIZE = 25;

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
  const companies: Array<{
    id: string;
    deleted_at: string | null;
  }> = [];
  for (let offset = 0; ; offset += COMPANY_BATCH_SIZE) {
    const { data, error } = await db
      .from("companies")
      .select("id, deleted_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + COMPANY_BATCH_SIZE - 1);

    if (error) {
      return NextResponse.json(
        { ok: false, error: `Company scan failed: ${error.message}` },
        { status: 500 }
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

  const result = {
    ok: failures.length === 0,
    scanned: companies.length,
    eligible: eligible.length,
    erasedCompanies,
    deletedObjects,
    failures,
  };
  if (failures.length > 0) {
    console.error("[cron/storage/site-visit-erasure]", JSON.stringify(result));
  } else {
    console.warn("[cron/storage/site-visit-erasure]", JSON.stringify(result));
  }
  return NextResponse.json(result, { status: failures.length > 0 ? 500 : 200 });
}
