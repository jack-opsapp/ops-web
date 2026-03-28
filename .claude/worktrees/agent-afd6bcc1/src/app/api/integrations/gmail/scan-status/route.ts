/**
 * OPS Web - Gmail Scan Status
 *
 * GET /api/integrations/gmail/scan-status?jobId=...
 *
 * Returns the current status and progress of a scan job.
 * When status is "complete", the result field contains all scan data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();

  const { data: job, error } = await supabase
    .from("gmail_scan_jobs")
    .select("id, status, progress, result, error_message, created_at, updated_at")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    result: job.status === "complete" ? job.result : undefined,
    error: job.status === "error" ? job.error_message : undefined,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  });
}
