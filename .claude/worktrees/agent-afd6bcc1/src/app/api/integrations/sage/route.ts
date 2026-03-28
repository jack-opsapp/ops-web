/**
 * OPS Web - Sage Accounting OAuth Initiation & Disconnect
 *
 * POST /api/integrations/sage  — Generate Sage OAuth URL
 * DELETE /api/integrations/sage — Disconnect & revoke tokens
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import crypto from "crypto";

const SAGE_CLIENT_ID = process.env.SAGE_CLIENT_ID?.trim();
const SAGE_CLIENT_SECRET = process.env.SAGE_CLIENT_SECRET?.trim();
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.trim() ?? "http://localhost:3000";
const SAGE_REDIRECT_URI =
  process.env.SAGE_REDIRECT_URI?.trim() ?? `${BASE_URL}/api/integrations/sage/callback`;

const SAGE_AUTH_URL =
  "https://www.sageone.com/oauth2/auth/central?filter=apiv3.1";
const SAGE_REVOKE_URL = "https://oauth.accounting.sage.com/revoke";

// ─── POST: Initiate OAuth ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const companyId = body.companyId as string | undefined;

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    if (!SAGE_CLIENT_ID) {
      return NextResponse.json(
        {
          error:
            "Sage integration not configured. SAGE_CLIENT_ID is missing.",
        },
        { status: 500 }
      );
    }

    // Generate CSRF state token: companyId:randomHex
    const stateToken = `${companyId}:${crypto.randomBytes(16).toString("hex")}`;

    // Store state token temporarily in the connection row for CSRF validation
    const supabase = getServiceRoleClient();
    await supabase.from("accounting_connections").upsert(
      {
        company_id: companyId,
        provider: "sage",
        webhook_verifier_token: stateToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,provider" }
    );

    const params = new URLSearchParams({
      client_id: SAGE_CLIENT_ID,
      redirect_uri: SAGE_REDIRECT_URI,
      response_type: "code",
      scope: "full_access",
      state: stateToken,
    });

    const authUrl = `${SAGE_AUTH_URL}&${params.toString()}`;

    return NextResponse.json({ authUrl });
  } catch (err) {
    console.error("Sage OAuth initiation error:", err);
    return NextResponse.json(
      { error: "Failed to initiate Sage OAuth" },
      { status: 500 }
    );
  }
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

    // Fetch current connection to revoke token
    const { data: connection } = await supabase
      .from("accounting_connections")
      .select("refresh_token")
      .eq("company_id", companyId)
      .eq("provider", "sage")
      .single();

    // Attempt to revoke refresh token at Sage
    if (connection?.refresh_token && SAGE_CLIENT_ID && SAGE_CLIENT_SECRET) {
      try {
        await fetch(SAGE_REVOKE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: connection.refresh_token,
            client_id: SAGE_CLIENT_ID,
            client_secret: SAGE_CLIENT_SECRET,
          }),
        });
      } catch {
        // Non-critical — continue with local disconnect
      }
    }

    // Clear tokens and mark disconnected
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
