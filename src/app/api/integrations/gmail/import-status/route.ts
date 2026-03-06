/**
 * OPS Web - Gmail Import Status
 *
 * GET /api/integrations/gmail/import-status?jobId=...
 * Returns the current status of a historical email import job.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const jobId = request.nextUrl.searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId query parameter is required" },
        { status: 400 }
      );
    }

    const { data: job, error } = await supabase
      .from("gmail_import_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (error || !job) {
      return NextResponse.json(
        { error: "Import job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        companyId: job.company_id,
        connectionId: job.connection_id,
        status: job.status,
        importAfter: job.import_after,
        totalEmails: job.total_emails,
        processed: job.processed,
        matched: job.matched,
        unmatched: job.unmatched,
        needsReview: job.needs_review,
        errorMessage: job.error_message,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      },
    });
  } catch (err) {
    console.error("[gmail-import-status]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
