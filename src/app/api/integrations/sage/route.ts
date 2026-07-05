/**
 * OPS Web - Sage Accounting OAuth Initiation & Disconnect
 *
 * POST /api/integrations/sage  — Generate Sage OAuth URL
 * DELETE /api/integrations/sage — Disconnect & revoke tokens
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";
import { decryptToken } from "@/lib/api/services/token-cipher";
import {
  findConflictingActiveProvider,
  providerLabel,
} from "@/lib/api/services/accounting-connection-guard";
import crypto from "crypto";

const SAGE_CLIENT_ID = process.env.SAGE_CLIENT_ID?.trim();
const SAGE_CLIENT_SECRET = process.env.SAGE_CLIENT_SECRET?.trim();
const SAGE_REDIRECT_URI =
  process.env.SAGE_REDIRECT_URI?.trim() ?? `${getAppUrl()}/api/integrations/sage/callback`;

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

    const supabase = getServiceRoleClient();

    // One accounting provider per company: refuse to start a Sage connect if a
    // DIFFERENT provider is already active (server-side half of the single-entry
    // invariant; mirrors the QuickBooks initiate guard).
    const conflict = await findConflictingActiveProvider(
      supabase,
      companyId,
      "sage"
    );
    if (conflict) {
      return NextResponse.json(
        {
          error: `Disconnect ${providerLabel(conflict)} before connecting Sage — a company runs one accounting system at a time.`,
          conflictingProvider: conflict,
        },
        { status: 409 }
      );
    }

    // Generate CSRF state token: companyId:randomHex
    const stateToken = `${companyId}:${crypto.randomBytes(16).toString("hex")}`;

    // Store state token temporarily in the connection row for CSRF validation
    await supabase.from("accounting_connections").upsert(
      {
        company_id: companyId,
        provider: "sage",
        provider_environment: "production",
        webhook_verifier_token: stateToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,provider,provider_environment" }
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
      .eq("provider_environment", "production")
      .single();

    // Attempt to revoke refresh token at Sage. The stored value is encrypted
    // at rest — decrypt before sending to the revoke endpoint.
    const sageRefreshToken = decryptToken(connection?.refresh_token);
    if (sageRefreshToken && SAGE_CLIENT_ID && SAGE_CLIENT_SECRET) {
      try {
        await fetch(SAGE_REVOKE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: sageRefreshToken,
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
      .eq("provider", "sage")
      .eq("provider_environment", "production");

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
