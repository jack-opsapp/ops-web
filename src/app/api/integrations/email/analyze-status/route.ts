/**
 * OPS Web - Email Analyze Status Endpoint
 *
 * GET /api/integrations/email/analyze-status?jobId=...
 * Polls the analysis job status for the wizard progress UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();
  const { data: job } = await supabase
    .from("gmail_scan_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const hasResult = job.status === "complete" || job.status === "import_complete";
  const hasError = job.status === "error" || job.status === "import_error";

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    result: hasResult ? job.result : undefined,
    error: hasError ? job.error_message : undefined,
  });
}
