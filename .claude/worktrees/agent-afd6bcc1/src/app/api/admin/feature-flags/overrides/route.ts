/**
 * OPS Admin - Feature Flag Overrides API
 *
 * GET    /api/admin/feature-flags/overrides?flagSlug=X&q=search  → overrides for a flag + user search
 * POST   /api/admin/feature-flags/overrides                      → { flagSlug, userId } add override
 * DELETE /api/admin/feature-flags/overrides                      → { id } remove override
 */

import { NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

// ─── GET: Overrides for a flag + optional user search ────────────────────────

export const GET = withAdmin(async (req) => {
  await requireAdmin(req);

  const flagSlug = req.nextUrl.searchParams.get("flagSlug");
  const q = req.nextUrl.searchParams.get("q");
  const db = getAdminSupabase();

  // If flagSlug provided, return overrides with user info
  if (flagSlug) {
    const { data: overrides, error } = await db
      .from("feature_flag_overrides")
      .select("id, flag_slug, user_id, created_at")
      .eq("flag_slug", flagSlug)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Enrich with user info
    const userIds = (overrides ?? []).map((o) => o.user_id);
    const users: Record<string, { first_name: string; last_name: string; email: string }> = {};

    if (userIds.length > 0) {
      const { data: userRows } = await db
        .from("users")
        .select("id, first_name, last_name, email")
        .in("id", userIds);

      for (const u of userRows ?? []) {
        users[u.id] = { first_name: u.first_name, last_name: u.last_name, email: u.email };
      }
    }

    const enriched = (overrides ?? []).map((o) => ({
      ...o,
      user: users[o.user_id] ?? { first_name: "Unknown", last_name: "", email: "" },
    }));

    return NextResponse.json({ overrides: enriched });
  }

  // If q provided, search users for adding overrides
  if (q) {
    const searchTerm = `%${q}%`;
    const { data: searchResults, error } = await db
      .from("users")
      .select("id, first_name, last_name, email")
      .or(`first_name.ilike.${searchTerm},last_name.ilike.${searchTerm},email.ilike.${searchTerm}`)
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ users: searchResults ?? [] });
  }

  return NextResponse.json({ error: "flagSlug or q parameter required" }, { status: 400 });
});

// ─── POST: Add override ─────────────────────────────────────────────────────

export const POST = withAdmin(async (req) => {
  await requireAdmin(req);

  const { flagSlug, userId } = await req.json();
  if (!flagSlug || !userId) {
    return NextResponse.json({ error: "flagSlug and userId required" }, { status: 400 });
  }

  const db = getAdminSupabase();
  const { data, error } = await db
    .from("feature_flag_overrides")
    .insert({ flag_slug: flagSlug, user_id: userId })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Override already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
});

// ─── DELETE: Remove override ─────────────────────────────────────────────────

export const DELETE = withAdmin(async (req) => {
  await requireAdmin(req);

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const db = getAdminSupabase();
  const { error } = await db
    .from("feature_flag_overrides")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
