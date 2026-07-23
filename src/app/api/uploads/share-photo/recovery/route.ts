/**
 * Acknowledges an exhausted durable share-photo job by creating one dismissible
 * notification for the uploader. Invalid legacy identifiers are deliberately
 * allowed only as opaque recovery evidence; they never become database routing
 * authority.
 */

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { resolveSharePhotoAuth } from "@/lib/uploads/share-photo-auth";
import {
  boundedRecoveryIdentifier,
  canonicalUuid,
} from "@/lib/uploads/share-photo-contract";
import { canEditSharePhotoProject } from "@/lib/uploads/share-photo-permission";
import { rateLimit } from "@/lib/utils/ratelimit";

export const runtime = "nodejs";

const RATE_LIMIT_PER_MINUTE = 60;
const TITLE = "Photo upload needs attention";
const GENERIC_BODY =
  "A shared photo could not be attached. Share it again to an active project.";

interface ProjectRow {
  id: string;
  company_id: string;
  title: string;
  deleted_at: string | null;
}

function recoveryIdentity(userId: string, jobId: string): string {
  const uuid = canonicalUuid(jobId);
  if (uuid) return uuid;
  return createHash("sha256").update(`${userId}\0${jobId}`).digest("hex");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await resolveSharePhotoAuth(req);
    if (auth instanceof NextResponse) return auth;

    const limited = await rateLimit({
      key: `share-photo-recovery:${auth.uid}`,
      limit: RATE_LIMIT_PER_MINUTE,
      windowSec: 60,
    });
    if (limited.exceeded) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: { "Retry-After": String(limited.retryAfterSec) },
        }
      );
    }

    const projectEvidence = boundedRecoveryIdentifier(
      req.nextUrl.searchParams.get("projectId")
    );
    const jobEvidence = boundedRecoveryIdentifier(
      req.nextUrl.searchParams.get("jobId")
    );
    if (!projectEvidence || !jobEvidence) {
      return NextResponse.json(
        { error: "Invalid recovery identifiers" },
        { status: 400 }
      );
    }

    let linkedProject: ProjectRow | null = null;
    const projectId = canonicalUuid(projectEvidence);
    if (projectId) {
      const { data, error } = await getServiceRoleClient()
        .from("projects")
        .select("id, company_id, title, deleted_at")
        .eq("id", projectId)
        .maybeSingle();
      if (error) {
        console.error(
          "[uploads/share-photo/recovery] project lookup failed:",
          error.message
        );
        return NextResponse.json(
          { error: "Failed to validate recovery target" },
          { status: 500 }
        );
      }

      const project = data as ProjectRow | null;
      if (project && project.company_id !== auth.companyId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (
        project &&
        !project.deleted_at &&
        (await canEditSharePhotoProject(auth.userId, project.id))
      ) {
        linkedProject = project;
      }
    }

    const body = linkedProject
      ? `Open ${linkedProject.title} and share the photo again.`
      : GENERIC_BODY;
    const { error } = await getServiceRoleClient().rpc(
      "create_notification_if_new_with_status",
      {
        p_user_id: auth.userId,
        p_company_id: auth.companyId,
        p_type: "system",
        p_title: TITLE,
        p_body: body,
        p_persistent: false,
        p_action_url: linkedProject
          ? `/dashboard?openProject=${linkedProject.id}&mode=view`
          : undefined,
        p_action_label: linkedProject ? "VIEW PROJECT" : undefined,
        p_project_id: linkedProject?.id,
        p_deep_link_type: linkedProject ? "projectNotes" : undefined,
        p_dedupe_key: `share-photo:recovery:${recoveryIdentity(
          auth.userId,
          jobEvidence
        )}`,
      }
    );
    if (error) {
      console.error(
        "[uploads/share-photo/recovery] notification failed:",
        error.message
      );
      return NextResponse.json(
        { error: "Failed to record recovery notice" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[uploads/share-photo/recovery] Error:", error);
    return NextResponse.json(
      { error: "Failed to record recovery notice" },
      { status: 500 }
    );
  }
}
