/**
 * OPS Web - Email Analyze Status Endpoint
 *
 * GET /api/integrations/email/analyze-status?jobId=...
 * Polls the analysis job status for the wizard progress UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

export async function GET(request: NextRequest) {
  // ─── Auth: verify the caller owns the company this job belongs to ──────
  const authUser = await verifyAdminAuth(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  if (job) {
    // Verify the authenticated user belongs to the same company as the job
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user || (user.company_id as string) !== job.company_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

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
