/**
 * POST /api/opportunities/[id]/convert
 *
 * Converts a won opportunity into a linked project (Lead Lifecycle P6). Winning
 * a deal AUTOMATICALLY converts it: the pipeline "Mark as Won" flow calls this
 * after the won stage move succeeds. Idempotent — re-winning / re-running never
 * creates a second project (the guarded RPC short-circuits when project_ref is
 * already set).
 *
 * The opportunity STAYS at stage='won' (not archived) — it is the preserved
 * sales record, linked to the new project via project_ref.
 *
 * Body: {
 *   actualValue?: number,        // final deal value
 *   expectedStage?: string,      // snapshot guard
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
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ProjectConversionService } from "@/lib/api/services/project-conversion-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: opportunityId } = await params;

  const auth = await verifyAdminAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(auth.uid, auth.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // Granular permission — never filter by role. Converting an opportunity
  // mutates pipeline + project records, so it is gated on pipeline.manage
  // (the same permission the merge route uses).
  const allowed = await checkPermissionById(
    user.id as string,
    "pipeline.manage"
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const companyId = user.company_id as string;
  if (!companyId) {
    return NextResponse.json(
      { error: "User has no company" },
      { status: 400 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // No body is fine — conversion still proceeds with defaults.
  }

  const actualValue =
    typeof body.actualValue === "number" ? body.actualValue : null;
  const expectedStage =
    typeof body.expectedStage === "string" ? body.expectedStage : null;
  const notesSeed =
    typeof body.notesSeed === "string" ? body.notesSeed : null;
  const titleOverride =
    typeof body.titleOverride === "string" ? body.titleOverride : null;
  const linkToProjectId =
    typeof body.linkToProjectId === "string" ? body.linkToProjectId : null;

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
          actualValue,
          expectedStage,
          notesSeed,
          titleOverride,
        });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[OpportunityConvert] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
