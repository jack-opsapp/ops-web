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
  let stats = { factsCount: 0, graphEdgesCount: 0, profilesCount: 0 };
  try {
    stats = await MemoryService.getStats(companyId);
  } finally {
    setSupabaseOverride(null);
  }

  const { data: profiles } = await db
    .from("agent_writing_profiles")
    .select("user_id, emails_analyzed, updated_at")
    .eq("company_id", companyId);

  return NextResponse.json({
    company: { id: company.id, name: company.name },
    features: {
      ai_email_review: overrideMap.ai_email_review || {
        enabled: false,
        enabledBy: null,
        enabledAt: null,
      },
      ai_email_memory: overrideMap.ai_email_memory || {
        enabled: false,
        enabledBy: null,
        enabledAt: null,
      },
    },
    memory: {
      facts: stats.factsCount,
      graphEdges: stats.graphEdgesCount,
      profiles: stats.profilesCount,
      writingProfiles: (profiles ?? []).map((p) => ({
        userId: p.user_id,
        emailsAnalyzed: p.emails_analyzed,
        lastUpdated: p.updated_at,
      })),
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
  const db = getAdminSupabase();

  const validFeatures = ["ai_email_review", "ai_email_memory"];
  const updates: Array<{ feature: string; enabled: boolean }> = [];

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

  for (const u of updates) {
    const { error } = await db.from("admin_feature_overrides").upsert(
      {
        company_id: companyId,
        feature_key: u.feature,
        enabled: u.enabled,
        enabled_by: admin.email || null,
        enabled_at: u.enabled ? new Date().toISOString() : null,
      },
      { onConflict: "company_id,feature_key" }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, updated: updates });
}
