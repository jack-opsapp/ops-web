/**
 * OPS Admin - AI Features for a specific company
 *
 * GET   /api/admin/ai-features/[companyId] → AI feature status + memory stats
 * PATCH /api/admin/ai-features/[companyId] → toggle AI features on/off
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "@/lib/admin/admin-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { MemoryService } from "@/lib/api/services/memory-service";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

export const maxDuration = 300;

async function verifyAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return null;
  }
  return user;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const admin = await verifyAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { companyId } = await params;
  const db = getAdminSupabase();

  const { data: company } = await db
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .single();

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const { data: overrides } = await db
    .from("admin_feature_overrides")
    .select("feature_key, enabled, enabled_by, enabled_at")
    .eq("company_id", companyId);

  const overrideMap: Record<
    string,
    { enabled: boolean; enabledBy: string | null; enabledAt: string | null }
  > = {};
  for (const o of overrides ?? []) {
    overrideMap[o.feature_key as string] = {
      enabled: o.enabled as boolean,
      enabledBy: (o.enabled_by as string) || null,
      enabledAt: (o.enabled_at as string) || null,
    };
  }

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);
  let stats: Awaited<ReturnType<typeof MemoryService.getStats>>;
  try {
    stats = await MemoryService.getStats(companyId);
  } catch {
    stats = {
      factsCount: 0, graphEdgesCount: 0, profilesCount: 0,
      entitiesByType: {}, factsByCategory: {}, profilesByType: [],
    };
  } finally {
    setSupabaseOverride(null);
  }

  return NextResponse.json({
    company: { id: company.id, name: company.name },
    features: {
      phase_c: overrideMap.phase_c || { enabled: false, enabledBy: null, enabledAt: null },
    },
    memory: {
      facts: stats.factsCount,
      graphEdges: stats.graphEdgesCount,
      profiles: stats.profilesCount,
      entitiesByType: stats.entitiesByType,
      factsByCategory: stats.factsByCategory,
      writingProfiles: stats.profilesByType,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const admin = await verifyAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { companyId } = await params;
  const body = await req.json();

  const validFeatures: Array<"phase_c"> = ["phase_c"];
  const updates: Array<{ feature: "phase_c"; enabled: boolean }> = [];

  for (const feature of validFeatures) {
    if (feature in body) {
      updates.push({ feature, enabled: !!body[feature] });
    }
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { error: "No valid features to update" },
      { status: 400 }
    );
  }

  // Pin the service-role client so service-layer queries (and any
  // secondary side effects like the comms-wizard-ready notification fire
  // from setOverride) run with full DB access instead of falling through
  // to the anon client.
  setSupabaseOverride(getServiceRoleClient());

  try {
    // Route through AdminFeatureOverrideService.setOverride so the
    // disabled→enabled transition fires the guidance notification that
    // tells the company's admins to run the AI Setup wizard. A raw
    // db.upsert (the prior implementation) silently skipped that
    // side effect — and that's exactly why admin-toggled phase_c
    // customers never saw any onboarding prompt.
    for (const u of updates) {
      try {
        await AdminFeatureOverrideService.setOverride(
          companyId,
          u.feature,
          u.enabled,
          // setOverride stamps enabled_by with this value. Admin routes
          // authenticate via Firebase so we pass the email rather than a
          // real uuid — the column is TEXT in prod so either works for
          // audit purposes.
          admin.email || "admin"
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }
  } finally {
    setSupabaseOverride(null);
  }

  return NextResponse.json({ ok: true, updated: updates });
}
