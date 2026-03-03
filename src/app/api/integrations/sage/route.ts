/**
 * OPS Web - Sage Integration (Placeholder)
 *
 * POST /api/integrations/sage  — Initiate Sage OAuth (not yet implemented)
 * DELETE /api/integrations/sage — Disconnect Sage
 *
 * Sage integration is deferred per design doc. These routes return
 * user-friendly errors until Sage OAuth credentials are configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

// ─── POST: Initiate OAuth ──────────────────────────────────────────────────────

export async function POST() {
  return NextResponse.json(
    {
      error: "Sage integration is coming soon. Please use QuickBooks for now.",
      comingSoon: true,
    },
    { status: 501 }
  );
}

// ─── DELETE: Disconnect ────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const companyId = body.companyId as string | undefined;

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();

    const { error } = await supabase
      .from("accounting_connections")
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        is_connected: false,
        sync_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("provider", "sage");

    if (error) {
      console.error("Failed to disconnect Sage:", error.message);
      return NextResponse.json(
        { error: "Failed to disconnect" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Sage disconnect error:", err);
    return NextResponse.json(
      { error: "Failed to disconnect Sage" },
      { status: 500 }
    );
  }
}
