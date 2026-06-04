/**
 * GET /api/opportunities/[id]/preflight
 *
 * Read-only conversion preflight for the Won dialog: surfaces an already-linked
 * project, likely-duplicate candidates (same normalized address), the client's
 * other projects, and the auto-name preview — so the operator can "link instead
 * of create" before anything is written.
 *
 * The browser Supabase client runs as the anon role and cannot call the
 * SECURITY DEFINER `get_conversion_preflight` RPC directly, so this service-role
 * route is the only path. Gated on the granular `pipeline.manage` permission
 * (never a role filter) — the same gate as the convert route.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ProjectConversionService } from "@/lib/api/services/project-conversion-service";

export async function GET(
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

  // Granular permission — never filter by role. Same gate as the convert route.
  const allowed = await checkPermissionById(
    user.id as string,
    "pipeline.manage"
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const companyId = user.company_id as string;
  if (!companyId) {
    return NextResponse.json({ error: "User has no company" }, { status: 400 });
  }

  const db = getServiceRoleClient();
  setSupabaseOverride(db);

  try {
    const preflight = await ProjectConversionService.getConversionPreflight(
      opportunityId,
      companyId
    );
    return NextResponse.json(preflight);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[OpportunityPreflight] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
