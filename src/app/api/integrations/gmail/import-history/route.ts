/**
 * GET /api/integrations/gmail/import-history?companyId=...&limit=3
 *
 * Returns the most recent import/sync jobs for a company.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const limit = Math.min(
      Number(request.nextUrl.searchParams.get("limit") ?? 3),
      10
    );

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("gmail_import_jobs")
      .select(
        "id, status, total_emails, processed, matched, needs_review, clients_created, leads_created, error_message, created_at, updated_at"
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: `Failed to fetch import history: ${error.message}` },
        { status: 500 }
      );
    }

    const jobs = (data ?? []).map((job) => ({
      id: job.id,
      status: job.status,
      totalEmails: job.total_emails,
      processed: job.processed,
      matched: job.matched,
      needsReview: job.needs_review,
      clientsCreated: job.clients_created ?? 0,
      leadsCreated: job.leads_created ?? 0,
      error: job.error_message,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    }));

    return NextResponse.json({ jobs });
  } catch (err) {
    console.error("[gmail-import-history]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
