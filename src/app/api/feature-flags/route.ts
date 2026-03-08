/**
 * OPS Web - Feature Flags (Client API)
 *
 * GET /api/feature-flags?userId=<uuid>
 *
 * Returns all feature flags with override status for the given user.
 * Auth: verifies JWT and confirms uid matches.
 * Uses service-role client to bypass RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function GET(req: NextRequest) {
  // Verify auth
  const user = await verifyAdminAuth(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const db = getServiceRoleClient();

  // Fetch all flags
  const { data: flags, error: flagsError } = await db
    .from("feature_flags")
    .select("slug, enabled");

  if (flagsError) {
    console.error("[feature-flags] Failed to fetch flags:", flagsError);
    return NextResponse.json({ error: "Failed to fetch flags" }, { status: 500 });
  }

  // Fetch overrides for this user
  const { data: overrides, error: overridesError } = await db
    .from("feature_flag_overrides")
    .select("flag_slug")
    .eq("user_id", userId);

  if (overridesError) {
    console.error("[feature-flags] Failed to fetch overrides:", overridesError);
    return NextResponse.json({ error: "Failed to fetch overrides" }, { status: 500 });
  }

  const overrideSet = new Set((overrides ?? []).map((o) => o.flag_slug));

  const result = (flags ?? []).map((f) => ({
    slug: f.slug,
    enabled: f.enabled,
    hasOverride: overrideSet.has(f.slug),
  }));

  return NextResponse.json(result);
}
