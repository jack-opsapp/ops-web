/**
 * OPS Admin - Feature Flags API
 *
 * GET   /api/admin/feature-flags             → all flags + override count per flag
 * PATCH /api/admin/feature-flags             → { slug, enabled } toggle master switch
 * POST  /api/admin/feature-flags             → { slug, label, description } create new flag
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "@/lib/admin/admin-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

async function requireAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user?.email || !(await isAdminEmail(user.email))) return null;
  return user;
}

// ─── GET: List all flags with override counts ────────────────────────────────

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminSupabase();

  const { data: flags, error: flagsError } = await db
    .from("feature_flags")
    .select("*")
    .order("created_at", { ascending: true });

  if (flagsError) {
    return NextResponse.json({ error: flagsError.message }, { status: 500 });
  }

  // Count overrides per flag
  const { data: overrideCounts, error: countError } = await db
    .from("feature_flag_overrides")
    .select("flag_slug");

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  const countMap: Record<string, number> = {};
  for (const row of overrideCounts ?? []) {
    countMap[row.flag_slug] = (countMap[row.flag_slug] ?? 0) + 1;
  }

  const result = (flags ?? []).map((f) => ({
    ...f,
    overrideCount: countMap[f.slug] ?? 0,
  }));

  return NextResponse.json(result);
}

// ─── PATCH: Toggle master switch ─────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug, enabled } = await req.json();
  if (!slug || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "slug and enabled required" }, { status: 400 });
  }

  const db = getAdminSupabase();
  const { error } = await db
    .from("feature_flags")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("slug", slug);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ─── POST: Create new flag ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug, label, description } = await req.json();
  if (!slug || !label) {
    return NextResponse.json({ error: "slug and label required" }, { status: 400 });
  }

  const db = getAdminSupabase();
  const { data, error } = await db
    .from("feature_flags")
    .insert({ slug, label, description: description ?? null, enabled: false })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
