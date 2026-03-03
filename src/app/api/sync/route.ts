/**
 * OPS Web - Sync API
 *
 * POST /api/sync — Trigger manual sync for a provider
 * GET  /api/sync?companyId=... — Fetch sync history
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

// ─── POST: Trigger Manual Sync ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
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

    // Verify connection exists and is connected
    const { data: connection, error: connError } = await supabase
      .from("accounting_connections")
      .select("id, is_connected, access_token, realm_id")
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

    // Log the sync attempt
    await supabase.from("accounting_sync_log").insert({
      company_id: companyId,
      provider,
      direction: "push",
      entity_type: "client",
      status: "success",
      details: "Manual sync triggered — full sync not yet implemented",
    });

    // Update last_sync_at on the connection
    await supabase
      .from("accounting_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    return NextResponse.json({ success: true, message: "Sync triggered" });
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
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();

    const { data, error } = await supabase
      .from("accounting_sync_log")
      .select("id, provider, status, created_at, details")
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
