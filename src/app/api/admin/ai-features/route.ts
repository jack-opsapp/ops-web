/**
 * OPS Admin - AI Features API
 *
 * GET /api/admin/ai-features → all companies with their AI feature override status
 */

import { NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const maxDuration = 300;

export const GET = withAdmin(async (req) => {
  await requireAdmin(req);

  const db = getAdminSupabase();

  // Get all companies
  const { data: companies, error: companyErr } = await db
    .from("companies")
    .select("id, name")
    .order("name");

  if (companyErr) {
    return NextResponse.json({ error: companyErr.message }, { status: 500 });
  }

  // Get all AI feature overrides
  const { data: overrides, error: overrideErr } = await db
    .from("admin_feature_overrides")
    .select("company_id, feature_key, enabled, enabled_at");

  if (overrideErr) {
    return NextResponse.json({ error: overrideErr.message }, { status: 500 });
  }

  // Build override map: companyId → { feature_key: { enabled, enabled_at } }
  const overrideMap: Record<
    string,
    Record<string, { enabled: boolean; enabledAt: string | null }>
  > = {};
  for (const o of overrides ?? []) {
    const cid = o.company_id as string;
    if (!overrideMap[cid]) overrideMap[cid] = {};
    overrideMap[cid][o.feature_key as string] = {
      enabled: o.enabled as boolean,
      enabledAt: (o.enabled_at as string) || null,
    };
  }

  const result = (companies ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    aiEmailReview: overrideMap[c.id]?.ai_email_review || {
      enabled: false,
      enabledAt: null,
    },
    aiEmailMemory: overrideMap[c.id]?.ai_email_memory || {
      enabled: false,
      enabledAt: null,
    },
  }));

  return NextResponse.json(result);
});
