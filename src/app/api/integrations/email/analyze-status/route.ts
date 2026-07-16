/**
 * OPS Web - Email Analyze Status Endpoint
 *
 * GET /api/integrations/email/analyze-status?jobId=...
 * Polls the analysis job status for the wizard progress UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { authorizeEmailAnalysisJobContinuation } from "@/lib/email/email-analysis-job-access";
import {
  authorizeEmailConnectionOperationForActor,
  emailConnectionOwnerId,
} from "@/lib/email/email-connection-operation-access";

export async function GET(request: NextRequest) {
  // ─── Auth: verify the caller owns the company this job belongs to ──────
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();
  const access = await authorizeEmailAnalysisJobContinuation({
    supabase,
    jobId,
  });
  if (access.allowed && access.actorUserId !== actorResolution.actor.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!access.allowed && access.reason === "requester_snapshot_missing") {
    const { data: legacyJob, error: legacyJobError } = await supabase
      .from("gmail_scan_jobs")
      .select("company_id, connection_id, connection_owner_user_id")
      .eq("id", jobId)
      .maybeSingle();
    if (legacyJobError || !legacyJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const connectionAccess = await authorizeEmailConnectionOperationForActor({
      actor: actorResolution.actor,
      connectionId: String(legacyJob.connection_id),
      requireUsable: true,
      supabase,
    });
    const currentConnection = connectionAccess.allowed
      ? connectionAccess.connections[0]
      : undefined;
    const currentOwner = currentConnection
      ? emailConnectionOwnerId(currentConnection)
      : undefined;
    const ownerSnapshot = legacyJob.connection_owner_user_id
      ? String(legacyJob.connection_owner_user_id)
      : null;
    if (
      !connectionAccess.allowed ||
      String(legacyJob.company_id) !== actorResolution.actor.companyId ||
      currentOwner !== ownerSnapshot
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (!access.allowed) {
    return NextResponse.json(
      {
        error:
          access.reason === "job_not_found" ? "Job not found" : "Forbidden",
      },
      { status: access.reason === "job_not_found" ? 404 : 403 }
    );
  }

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
