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

    // Flat response — matches ImportStatusResponse shape in use-gmail-import.ts
    return NextResponse.json({
      status: job.status,
      totalEmails: job.total_emails,
      processedEmails: job.processed,
      matchedLeads: job.matched,
      needsReview: job.needs_review,
      clientsCreated: job.clients_created ?? 0,
      leadsCreated: job.leads_created ?? 0,
      error: job.error_message,
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
