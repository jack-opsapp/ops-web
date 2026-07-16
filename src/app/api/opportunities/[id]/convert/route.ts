/**
 * POST /api/opportunities/[id]/convert
 *
 * Converts a won opportunity into a linked project (Lead Lifecycle P6). Winning
 * a deal AUTOMATICALLY converts it: the pipeline "Mark as Won" flow calls this
 * as the one atomic stage+conversion write. Idempotent — re-winning / re-running
 * never creates a second project.
 *
 * The opportunity STAYS at stage='won' (not archived) — it is the preserved
 * sales record, linked to the new project via project_ref.
 *
 * Body: {
 *   actualValue?: number,        // final deal value
 *   expectedStage?: string,      // snapshot guard
 *   expectedAssignmentVersion: number, // dialog assignment snapshot guard
 *   notesSeed?: string,          // approval-queue scope seed
 *   titleOverride?: string,      // operator-typed name (rename) → hand-set
 *   linkToProjectId?: string,    // link an existing project instead of creating
 * }
 *
 * When `linkToProjectId` is present the route LINKS the deal to that existing
 * project (no new project is created); otherwise it creates a new one.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import {
  ProjectConversionError,
  ProjectConversionService,
} from "@/lib/api/services/project-conversion-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: opportunityId } = await params;

  const auth = await verifyAdminAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(auth.uid, undefined);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  const companyId = user.company_id as string;
  if (!companyId) {
    return NextResponse.json({ error: "User has no company" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // The required assignment snapshot check below rejects an absent body.
  }

  const actualValue =
    typeof body.actualValue === "number" ? body.actualValue : null;
  const expectedStage =
    typeof body.expectedStage === "string" ? body.expectedStage : null;
  const notesSeed = typeof body.notesSeed === "string" ? body.notesSeed : null;
  const titleOverride =
    typeof body.titleOverride === "string" ? body.titleOverride : null;
  const linkToProjectId =
    typeof body.linkToProjectId === "string" ? body.linkToProjectId : null;
  const expectedAssignmentVersion = body.expectedAssignmentVersion;
  if (
    !Number.isSafeInteger(expectedAssignmentVersion) ||
    (expectedAssignmentVersion as number) < 0
  ) {
    return NextResponse.json(
      { error: "A valid assignment snapshot is required" },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();
  setSupabaseOverride(db);

  try {
    // Link-existing branch: adopt the chosen project (no new one is created),
    // still winning the deal. Create branch: mint + auto-name a new project.
    const result = linkToProjectId
      ? await ProjectConversionService.linkOpportunityToExistingProject({
          opportunityId,
          companyId,
          decidedBy: user.id as string,
          sourcePath: "won_dialog",
          expectedAssignmentVersion: expectedAssignmentVersion as number,
          evidence: { surface: "web_won_dialog" },
          actualValue,
          expectedStage,
          notesSeed,
          linkToProjectId,
        })
      : await ProjectConversionService.convertOpportunityToProject({
          opportunityId,
          companyId,
          decidedBy: user.id as string,
          sourcePath: "won_dialog",
          expectedAssignmentVersion: expectedAssignmentVersion as number,
          evidence: { surface: "web_won_dialog" },
          actualValue,
          expectedStage,
          notesSeed,
          titleOverride,
        });

    return NextResponse.json({
      ok: true,
      ...result,
      projectId: result.projectAccessible ? result.projectId : null,
    });
  } catch (err) {
    if (err instanceof ProjectConversionError) {
      if (err.kind === "conflict") {
        return NextResponse.json(
          {
            error: "Opportunity changed before conversion completed",
            guardReason: err.guardReason,
            assignedTo: err.assignedTo ?? null,
            assignmentVersion: err.assignmentVersion,
          },
          { status: 409 }
        );
      }
      if (err.kind === "access_denied") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (err.kind === "not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[OpportunityConvert] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
