/**
 * /api/dashboard-preferences
 *
 * Server-side handler for user dashboard preferences.
 * Uses service-role client to bypass RLS (client-side Supabase queries
 * fail because Firebase JWTs aren't recognized by Supabase RLS policies).
 *
 * GET  ?user_id=...&company_id=...  — upsert default row if missing, return prefs
 * PATCH body { user_id, company_id, ...updates }  — partial update
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

// ─── GET — fetch (or create default) preferences ────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await verifyAdminAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = req.nextUrl.searchParams.get("user_id");
  const companyId = req.nextUrl.searchParams.get("company_id");

  if (!userId || !companyId) {
    return NextResponse.json(
      { error: "Missing user_id or company_id" },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();

  // Try to read existing row first
  const { data: existing } = await db
    .from("user_dashboard_preferences")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(existing);
  }

  // No row — create defaults
  const { data: created, error } = await db
    .from("user_dashboard_preferences")
    .insert({ user_id: userId, company_id: companyId })
    .select()
    .single();

  if (error) {
    console.error("[api/dashboard-preferences] INSERT failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(created);
}

// ─── PATCH — partial update ─────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const auth = await verifyAdminAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { user_id, company_id, ...updates } = body;

  if (!user_id || !company_id) {
    return NextResponse.json(
      { error: "Missing user_id or company_id" },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();

  // Ensure the row exists before updating
  const { data: existing } = await db
    .from("user_dashboard_preferences")
    .select("id")
    .eq("user_id", user_id)
    .eq("company_id", company_id)
    .maybeSingle();

  if (!existing) {
    // Create the row first with the provided updates
    const { data: created, error: insertError } = await db
      .from("user_dashboard_preferences")
      .insert({ user_id, company_id, ...updates, updated_at: new Date().toISOString() })
      .select()
      .single();

    if (insertError) {
      console.error("[api/dashboard-preferences] PATCH-INSERT failed:", insertError.message);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json(created);
  }

  const { data: updated, error } = await db
    .from("user_dashboard_preferences")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", user_id)
    .eq("company_id", company_id)
    .select()
    .single();

  if (error) {
    console.error("[api/dashboard-preferences] UPDATE failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
