/**
 * OPS Web - Sync API
 *
 * POST /api/sync — Trigger manual sync for a provider (push + pull)
 * GET  /api/sync?companyId=... — Fetch sync history
 *
 * Both endpoints require authentication (Firebase/Supabase JWT).
 * Sync logic lives in sync-orchestrator.ts to avoid Next.js route export constraints.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { runSyncForConnection } from "@/lib/api/services/sync-orchestrator";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Auth Helper ──────────────────────────────────────────────────────────────

async function verifyRequestAuth(request: NextRequest): Promise<{ uid: string } | null> {
  const user = await verifyAdminAuth(request);
  if (!user) return null;
  return { uid: user.uid };
}

/** Verify the user belongs to the company they're requesting to sync */
async function verifyCompanyAccess(supabase: SupabaseClient, authUid: string, companyId: string): Promise<boolean> {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("auth_id", authUid)
    .eq("company_id", companyId)
    .maybeSingle();
  return !!data;
}

// ─── POST: Trigger Manual Sync ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const authUser = await verifyRequestAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const companyId = body.companyId as string | undefined;
    const provider = body.provider as string | undefined;

    if (!companyId || !provider) {
      return NextResponse.json(
        { error: "companyId and provider are required" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();

    const hasAccess = await verifyCompanyAccess(supabase, authUser.uid, companyId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: connection, error: connError } = await supabase
      .from("accounting_connections")
      .select("id, is_connected, last_sync_at")
      .eq("company_id", companyId)
      .eq("provider", provider)
      .single();

    if (connError || !connection) {
      return NextResponse.json(
        { error: `No ${provider} connection found` },
        { status: 404 }
      );
    }

    if (!connection.is_connected) {
      return NextResponse.json(
        { error: `${provider} is not connected` },
        { status: 400 }
      );
    }

    try {
      const result = await runSyncForConnection(supabase, companyId, provider, connection.id, connection.last_sync_at);
      return NextResponse.json({
        success: result.success,
        status: result.results.some((r) => r.errors.length > 0) ? "partial" : "success",
        message: result.message,
        results: result.results,
      });
    } catch (syncErr) {
      await supabase.from("accounting_sync_log").insert({
        company_id: companyId,
        provider,
        direction: "push",
        entity_type: "client",
        status: "error",
        details: (syncErr as Error).message,
      });

      return NextResponse.json(
        { error: `Sync failed: ${(syncErr as Error).message}` },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Sync trigger error:", err);
    return NextResponse.json(
      { error: "Failed to trigger sync" },
      { status: 500 }
    );
  }
}

// ─── GET: Sync History ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const authUser = await verifyRequestAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();

    const hasAccess = await verifyCompanyAccess(supabase, authUser.uid, companyId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("accounting_sync_log")
      .select("id, provider, direction, entity_type, status, created_at, details")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Failed to fetch sync history:", error.message);
      return NextResponse.json([], { status: 200 });
    }

    const history = (data ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      direction: row.direction,
      entityType: row.entity_type,
      status: row.status,
      timestamp: row.created_at,
      details: row.details,
    }));

    return NextResponse.json(history);
  } catch (err) {
    console.error("Sync history error:", err);
    return NextResponse.json([], { status: 200 });
  }
}
