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
