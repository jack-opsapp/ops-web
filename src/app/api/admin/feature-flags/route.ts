/**
 * OPS Admin - Feature Flags API
 *
 * GET   /api/admin/feature-flags             → all flags + override count per flag
 * PATCH /api/admin/feature-flags             → partial update (enabled, routes, permissions, label, description)
 * POST  /api/admin/feature-flags             → create new flag
 */

import { NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

// ─── GET: List all flags with override counts ────────────────────────────────

export const GET = withAdmin(async (req) => {
  await requireAdmin(req);

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
});

// ─── PATCH: Toggle master switch or update routes/permissions ────────────────

export const PATCH = withAdmin(async (req) => {
  await requireAdmin(req);

  const body = await req.json();
  const { slug } = body;
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  // Build update payload from whichever fields were provided
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (Array.isArray(body.routes)) patch.routes = body.routes;
  if (Array.isArray(body.permissions)) patch.permissions = body.permissions;
  if (typeof body.label === "string") patch.label = body.label;
  if (typeof body.description === "string") patch.description = body.description;

  const db = getAdminSupabase();
  const { error } = await db
    .from("feature_flags")
    .update(patch)
    .eq("slug", slug);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});

// ─── POST: Create new flag ───────────────────────────────────────────────────

export const POST = withAdmin(async (req) => {
  await requireAdmin(req);

  const { slug, label, description, routes, permissions } = await req.json();
  if (!slug || !label) {
    return NextResponse.json({ error: "slug and label required" }, { status: 400 });
  }

  const db = getAdminSupabase();
  const { data, error } = await db
    .from("feature_flags")
    .insert({
      slug,
      label,
      description: description ?? null,
      enabled: false,
      routes: routes ?? [],
      permissions: permissions ?? [],
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
});
