/**
 * OPS Web - Email Connection Endpoint
 *
 * GET /api/integrations/email/connection?id=...
 * Returns a single connection's public data (no tokens).
 * Used by the wizard to check persisted wizard state on reopen.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);
  try {
    const connection = await EmailService.getConnection(id);
    if (!connection) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Return only safe fields — never expose tokens to the client
    return NextResponse.json({
      id: connection.id,
      email: connection.email,
      provider: connection.provider,
      status: connection.status,
      syncFilters: connection.syncFilters,
      syncEnabled: connection.syncEnabled,
    });
  } finally {
    setSupabaseOverride(null);
  }
}

/**
 * PATCH /api/integrations/email/connection
 * Merges the provided syncFilters into the existing connection syncFilters.
 * Used by the wizard to persist review state mid-flow.
 */
export async function PATCH(request: NextRequest) {
  let body: { connectionId?: string; syncFilters?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { connectionId, syncFilters } = body;
  if (!connectionId || !syncFilters) {
    return NextResponse.json(
      { error: "connectionId and syncFilters required" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);
  try {
    // Read existing filters so we merge rather than overwrite
    const existing = await EmailService.getConnection(connectionId);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const mergedFilters = {
      ...((existing.syncFilters as Record<string, unknown>) || {}),
      ...syncFilters,
    };

    await EmailService.updateConnection(connectionId, {
      syncFilters: mergedFilters,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[connection PATCH] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
