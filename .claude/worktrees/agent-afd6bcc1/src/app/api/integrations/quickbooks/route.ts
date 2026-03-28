/**
 * OPS Web - QuickBooks OAuth Initiation & Disconnect
 *
 * POST /api/integrations/quickbooks  — Generate Intuit OAuth URL
 * DELETE /api/integrations/quickbooks — Disconnect & revoke tokens
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import crypto from "crypto";

const QB_CLIENT_ID = process.env.QB_CLIENT_ID?.trim();
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET?.trim();
const QB_ENVIRONMENT = process.env.QB_ENVIRONMENT?.trim() ?? "sandbox";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.trim() ?? "http://localhost:3000";
const QB_REDIRECT_URI =
  process.env.QB_REDIRECT_URI?.trim() ?? `${BASE_URL}/api/integrations/quickbooks/callback`;

const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const INTUIT_REVOKE_URL =
  "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

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

    if (!QB_CLIENT_ID) {
      return NextResponse.json(
        {
          error:
            "QuickBooks integration not configured. QB_CLIENT_ID is missing.",
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
        provider: "quickbooks",
        webhook_verifier_token: stateToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,provider" }
    );

    const params = new URLSearchParams({
      client_id: QB_CLIENT_ID,
      redirect_uri: QB_REDIRECT_URI,
      response_type: "code",
      scope: "com.intuit.quickbooks.accounting",
      state: stateToken,
    });

    const authUrl = `${INTUIT_AUTH_URL}?${params.toString()}`;

    return NextResponse.json({ authUrl });
  } catch (err) {
    console.error("QuickBooks OAuth initiation error:", err);
    return NextResponse.json(
      { error: "Failed to initiate QuickBooks OAuth" },
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
      .select("access_token, refresh_token")
      .eq("company_id", companyId)
      .eq("provider", "quickbooks")
      .single();

    // Attempt to revoke token at Intuit
    if (connection?.access_token && QB_CLIENT_ID && QB_CLIENT_SECRET) {
      try {
        await fetch(INTUIT_REVOKE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString("base64")}`,
          },
          body: JSON.stringify({ token: connection.access_token }),
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
        realm_id: null,
        is_connected: false,
        sync_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("provider", "quickbooks");

    if (error) {
      console.error("Failed to disconnect QuickBooks:", error.message);
      return NextResponse.json(
        { error: "Failed to disconnect" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("QuickBooks disconnect error:", err);
    return NextResponse.json(
      { error: "Failed to disconnect QuickBooks" },
      { status: 500 }
    );
  }
}
