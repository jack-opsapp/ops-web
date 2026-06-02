/**
 * OPS Web - Feature Flags (Client API)
 *
 * GET /api/feature-flags?userId=<uuid>
 *
 * Returns all feature flags with override status for the authenticated user.
 * Also appends per-company admin_feature_overrides (e.g. inbox_ui) as synthetic
 * flag entries so the client store can gate nav items / routes without a
 * separate RLS-bypassed fetch.
 *
 * Auth: verifies JWT, resolves Supabase user ID server-side.
 * The userId param is validated against the JWT — users can only fetch their own flags.
 * Uses service-role client to bypass RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

export async function GET(req: NextRequest) {
  // Verify auth
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve Supabase user from the JWT — don't trust the query param blindly.
  // Select both id and company_id so we can check per-company admin overrides.
  const requestedUserId = req.nextUrl.searchParams.get("userId");
  let resolvedUserId: string | null = null;
  let resolvedCompanyId: string | null = null;

  if (requestedUserId) {
    // Validate that the requested userId belongs to this auth user
    const supabaseUser = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (supabaseUser && (supabaseUser.id as string) === requestedUserId) {
      resolvedUserId = requestedUserId;
      resolvedCompanyId = (supabaseUser.company_id as string) ?? null;
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    // No userId param — resolve from JWT
    const supabaseUser = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    resolvedUserId = supabaseUser ? (supabaseUser.id as string) : null;
    resolvedCompanyId = supabaseUser ? ((supabaseUser.company_id as string) ?? null) : null;
  }

  if (!resolvedUserId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const db = getServiceRoleClient();

  // Fetch all flags
  const { data: flags, error: flagsError } = await db
    .from("feature_flags")
    .select("slug, enabled, routes, permissions");

  if (flagsError) {
    console.error("[feature-flags] Failed to fetch flags:", flagsError);
    return NextResponse.json({ error: "Failed to fetch flags" }, { status: 500 });
  }

  // Fetch overrides for this user
  const { data: overrides, error: overridesError } = await db
    .from("feature_flag_overrides")
    .select("flag_slug")
    .eq("user_id", resolvedUserId);

  if (overridesError) {
    console.error("[feature-flags] Failed to fetch overrides:", overridesError);
    return NextResponse.json({ error: "Failed to fetch overrides" }, { status: 500 });
  }

  const overrideSet = new Set((overrides ?? []).map((o) => o.flag_slug));

  const result = (flags ?? []).map((f) => ({
    slug: f.slug,
    enabled: f.enabled,
    hasOverride: overrideSet.has(f.slug),
    routes: (f.routes as string[]) ?? [],
    permissions: (f.permissions as string[]) ?? [],
  }));

  // ── Per-company admin_feature_overrides ──────────────────────────────────
  // Synthetic flag entries for features gated at the company level (not the
  // global feature_flags table). Currently: inbox_ui.
  // Fail-closed: if company_id is unknown or the DB call throws, inbox_ui
  // defaults to disabled so the nav item stays hidden.
  if (resolvedCompanyId) {
    let inboxUiEnabled = false;
    try {
      inboxUiEnabled = await AdminFeatureOverrideService.isFeatureEnabled(
        resolvedCompanyId,
        "inbox_ui"
      );
    } catch (err) {
      console.error("[feature-flags] Failed to check inbox_ui override:", err);
    }

    result.push({
      slug: "inbox_ui",
      enabled: inboxUiEnabled,
      hasOverride: false,
      routes: ["/inbox"],
      permissions: [],
    });
  } else {
    // No company_id — push disabled so the store has the key (fail-closed)
    result.push({
      slug: "inbox_ui",
      enabled: false,
      hasOverride: false,
      routes: ["/inbox"],
      permissions: [],
    });
  }

  return NextResponse.json(result);
}
