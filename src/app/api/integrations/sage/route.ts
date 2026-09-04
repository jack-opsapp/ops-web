import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  findConflictingActiveProvider,
  providerLabel,
} from "@/lib/api/services/accounting-connection-guard";
import {
  SAGE_AUTHORIZE_URL,
  SAGE_REVOKE_URL,
  getSageCredentials,
  getSageProviderEnvironment,
  type SageProviderEnvironment,
} from "@/lib/api/services/sage-config";
import {
  createSageOAuthSecrets,
  digestSageOAuthState,
} from "@/lib/api/services/sage-oauth-service";
import { decryptToken, encryptToken } from "@/lib/api/services/token-cipher";

type ReturnSurface = "books" | "settings";
type Authorization =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

function parseEnvironment(value: unknown): SageProviderEnvironment | null {
  if (value === undefined || value === null || value === "") {
    return getSageProviderEnvironment();
  }
  return value === "production" || value === "sandbox" ? value : null;
}

function parseReturnSurface(value: unknown): ReturnSurface | null {
  if (value === undefined || value === null || value === "") return "books";
  return value === "books" || value === "settings" ? value : null;
}

async function authorize(
  request: NextRequest,
  companyId: string
): Promise<Authorization> {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const user = await findUserByAuth(
    authUser.uid,
    authUser.email,
    "id, company_id"
  );
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "User not found" }, { status: 404 }),
    };
  }
  if ((user.company_id as string) !== companyId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  const allowed = await checkPermissionById(
    user.id as string,
    "accounting.manage_connections"
  );
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id as string };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const companyId =
      typeof body.companyId === "string" ? body.companyId.trim() : "";
    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }
    const authorization = await authorize(request, companyId);
    if (!authorization.ok) return authorization.response;

    const providerEnvironment = parseEnvironment(body.providerEnvironment);
    if (!providerEnvironment) {
      return NextResponse.json(
        { error: 'providerEnvironment must be "production" or "sandbox"' },
        { status: 400 }
      );
    }
    const returnSurface = parseReturnSurface(body.returnSurface);
    if (!returnSurface) {
      return NextResponse.json(
        { error: 'returnSurface must be "books" or "settings"' },
        { status: 400 }
      );
    }

    const credentials = getSageCredentials(providerEnvironment);
    const supabase = getServiceRoleClient();
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

    const { data: connection, error: connectionError } = await supabase
      .from("accounting_connections")
      .upsert(
        {
          company_id: companyId,
          provider: "sage",
          provider_environment: providerEnvironment,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,provider,provider_environment" }
      )
      .select("id")
      .single();
    if (connectionError || !connection) {
      throw new Error("Failed to prepare Sage connection");
    }

    const secrets = createSageOAuthSecrets();
    const { error: attemptError } = await supabase
      .from("accounting_oauth_attempts")
      .insert({
        state_digest: digestSageOAuthState(secrets.state),
        actor_user_id: authorization.userId,
        company_id: companyId,
        provider: "sage",
        provider_environment: providerEnvironment,
        pkce_verifier: encryptToken(secrets.verifier),
        return_surface: returnSurface,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
    if (attemptError) throw new Error("Failed to persist Sage OAuth attempt");

    const params = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: credentials.redirectUri,
      response_type: "code",
      scope: "full_access",
      state: secrets.state,
      code_challenge: secrets.challenge,
      code_challenge_method: "S256",
    });
    return NextResponse.json({ authUrl: `${SAGE_AUTHORIZE_URL}&${params}` });
  } catch {
    console.error("Sage OAuth initiation failed");
    return NextResponse.json(
      { error: "Failed to initiate Sage connection" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const companyId =
      typeof body.companyId === "string" ? body.companyId.trim() : "";
    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }
    const authorization = await authorize(request, companyId);
    if (!authorization.ok) return authorization.response;

    const providerEnvironment = parseEnvironment(body.providerEnvironment);
    if (!providerEnvironment) {
      return NextResponse.json(
        { error: 'providerEnvironment must be "production" or "sandbox"' },
        { status: 400 }
      );
    }
    const supabase = getServiceRoleClient();
    const { data: connection } = await supabase
      .from("accounting_connections")
      .select("refresh_token")
      .eq("company_id", companyId)
      .eq("provider", "sage")
      .eq("provider_environment", providerEnvironment)
      .single();

    const refreshToken = decryptToken(connection?.refresh_token);
    if (refreshToken) {
      try {
        const credentials = getSageCredentials(providerEnvironment);
        await fetch(SAGE_REVOKE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: refreshToken,
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
          }),
        });
      } catch {
        // Local revocation remains authoritative when Sage is unavailable.
      }
    }

    const { data, error } = await supabase
      .from("accounting_connections")
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        sage_business_id: null,
        sage_business_id_lookup: null,
        sage_business_name: null,
        webhook_verifier_token: null,
        is_connected: false,
        sync_enabled: false,
        sync_direction: "pull_only",
        propagate_deletes: false,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("provider", "sage")
      .eq("provider_environment", providerEnvironment)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("Sage local disconnect failed");
      return NextResponse.json(
        { error: "Failed to disconnect Sage" },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: `No Sage ${providerEnvironment} connection found` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, providerEnvironment });
  } catch {
    console.error("Sage disconnect failed");
    return NextResponse.json(
      { error: "Failed to disconnect Sage" },
      { status: 500 }
    );
  }
}
