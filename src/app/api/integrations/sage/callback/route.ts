import { NextRequest, NextResponse } from "next/server";
import { findConflictingActiveProvider } from "@/lib/api/services/accounting-connection-guard";
import {
  getAllowedSageBusinessIds,
  getSageCredentials,
  type SageProviderEnvironment,
} from "@/lib/api/services/sage-config";
import {
  digestSageOAuthState,
  discoverEligibleSageBusinesses,
  exchangeSageAuthorizationCode,
  sageBusinessIdLookup,
} from "@/lib/api/services/sage-oauth-service";
import { decryptToken, encryptToken } from "@/lib/api/services/token-cipher";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";

type ReturnSurface = "books" | "settings";

interface ConsumedAttempt {
  actor_user_id: string;
  company_id: string;
  pkce_verifier: string;
  provider: string;
  provider_environment: SageProviderEnvironment;
  return_surface: ReturnSurface;
}

function destination(surface: ReturnSurface, params: Record<string, string>) {
  const url = new URL(
    surface === "settings" ? "/settings" : "/books",
    getAppUrl()
  );
  if (surface === "settings") url.searchParams.set("section", "accounting");
  else url.searchParams.set("segment", "sync");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function errorRedirect(surface: ReturnSurface, message: string) {
  return NextResponse.redirect(
    destination(surface, { status: "error", message })
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim();
  const state = searchParams.get("state")?.trim();
  if (!state) return errorRedirect("books", "missing_params");

  const supabase = getServiceRoleClient();
  const { data: consumed, error: consumeError } = await supabase.rpc(
    "consume_accounting_oauth_attempt",
    { p_state_digest: digestSageOAuthState(state) }
  );
  const attempt = (consumed?.[0] ?? null) as ConsumedAttempt | null;
  if (consumeError || !attempt || attempt.provider !== "sage") {
    return errorRedirect("books", "invalid_state");
  }
  const surface = attempt.return_surface === "settings" ? "settings" : "books";

  if (searchParams.get("error")) {
    return errorRedirect(surface, "authorization_denied");
  }
  if (!code) return errorRedirect(surface, "missing_params");

  try {
    const credentials = getSageCredentials(attempt.provider_environment);
    const conflict = await findConflictingActiveProvider(
      supabase,
      attempt.company_id,
      "sage"
    );
    if (conflict) return errorRedirect(surface, "provider_conflict");

    const { data: connection, error: connectionError } = await supabase
      .from("accounting_connections")
      .select("id")
      .eq("company_id", attempt.company_id)
      .eq("provider", "sage")
      .eq("provider_environment", attempt.provider_environment)
      .single();
    if (connectionError || !connection) {
      return errorRedirect(surface, "connection_missing");
    }

    const verifier = decryptToken(attempt.pkce_verifier);
    if (!verifier) return errorRedirect(surface, "invalid_state");
    const grant = await exchangeSageAuthorizationCode({
      code,
      verifier,
      credentials,
    });
    const businesses = await discoverEligibleSageBusinesses({
      accessToken: grant.accessToken,
      environment: attempt.provider_environment,
      allowedSandboxBusinessIds: getAllowedSageBusinessIds(
        attempt.provider_environment
      ),
    });
    if (businesses.length === 0) {
      return errorRedirect(surface, "no_eligible_business");
    }

    const tokenExpiresAt = new Date(
      Date.now() + grant.expiresInSeconds * 1000
    ).toISOString();
    if (businesses.length === 1) {
      const business = businesses[0];
      const { error: updateError } = await supabase
        .from("accounting_connections")
        .update({
          access_token: encryptToken(grant.accessToken),
          refresh_token: encryptToken(grant.refreshToken),
          token_expires_at: tokenExpiresAt,
          sage_business_id: encryptToken(business.id),
          sage_business_id_lookup: sageBusinessIdLookup(business.id),
          sage_business_name: business.name,
          is_connected: true,
          sync_enabled: false,
          sync_direction: "pull_only",
          propagate_deletes: false,
          webhook_verifier_token: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id)
        .eq("company_id", attempt.company_id)
        .eq("provider", "sage")
        .eq("provider_environment", attempt.provider_environment);
      if (updateError) return errorRedirect(surface, "storage_failed");
      return NextResponse.redirect(destination(surface, { connected: "sage" }));
    }

    const selectionExpiry = Math.min(
      Date.now() + 4 * 60 * 1000,
      new Date(tokenExpiresAt).getTime() - 10_000
    );
    if (selectionExpiry <= Date.now()) {
      return errorRedirect(surface, "grant_expired");
    }
    const { data: selection, error: selectionError } = await supabase
      .from("sage_business_selection_sessions")
      .insert({
        connection_id: connection.id,
        actor_user_id: attempt.actor_user_id,
        company_id: attempt.company_id,
        provider_environment: attempt.provider_environment,
        access_token: encryptToken(grant.accessToken),
        refresh_token: encryptToken(grant.refreshToken),
        token_expires_at: tokenExpiresAt,
        eligible_businesses: businesses,
        expires_at: new Date(selectionExpiry).toISOString(),
      })
      .select("id")
      .single();
    if (selectionError || !selection) {
      return errorRedirect(surface, "storage_failed");
    }
    return NextResponse.redirect(
      destination(surface, { sageSelection: selection.id })
    );
  } catch {
    // Never log provider bodies, authorization codes, tokens, or PKCE material.
    console.error("Sage OAuth callback failed");
    return errorRedirect(surface, "unexpected_error");
  }
}
