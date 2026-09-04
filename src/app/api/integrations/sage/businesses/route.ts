import { NextRequest, NextResponse } from "next/server";
import { findConflictingActiveProvider } from "@/lib/api/services/accounting-connection-guard";
import {
  getAllowedSageBusinessIds,
  getSageCredentials,
  type SageProviderEnvironment,
} from "@/lib/api/services/sage-config";
import {
  discoverEligibleSageBusinesses,
  refreshSageOAuthGrant,
  sageBusinessIdLookup,
  type SageBusinessChoice,
} from "@/lib/api/services/sage-oauth-service";
import { decryptToken, encryptToken } from "@/lib/api/services/token-cipher";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface SelectionSession {
  access_token: string;
  actor_user_id: string;
  company_id: string;
  connection_id: string;
  eligible_businesses: unknown;
  expires_at?: string;
  provider_environment: SageProviderEnvironment;
  refresh_token: string;
  token_expires_at: string;
}
type Authorization =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

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
  if (
    !(await checkPermissionById(
      user.id as string,
      "accounting.manage_connections"
    ))
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id as string };
}

function choices(value: unknown): SageBusinessChoice[] | null {
  if (!Array.isArray(value)) return null;
  const result: SageBusinessChoice[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const id = (item as { id?: unknown }).id;
    const name = (item as { name?: unknown }).name;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      return null;
    }
    result.push({ id: id.trim(), name: name.trim() });
  }
  return result;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId")?.trim() ?? "";
  const sessionId = searchParams.get("sessionId")?.trim() ?? "";
  if (!companyId || !sessionId) {
    return NextResponse.json(
      { error: "companyId and sessionId are required" },
      { status: 400 }
    );
  }
  const authorization = await authorize(request, companyId);
  if (!authorization.ok) return authorization.response;

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sage_business_selection_sessions")
    .select(
      "eligible_businesses, expires_at, provider_environment, consumed_at"
    )
    .eq("id", sessionId)
    .eq("actor_user_id", authorization.userId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: "Failed to load Sage businesses" },
      { status: 500 }
    );
  }
  if (
    !data ||
    data.consumed_at ||
    new Date(data.expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json(
      { error: "Sage business selection expired" },
      { status: 410 }
    );
  }
  const eligible = choices(data.eligible_businesses);
  if (!eligible) {
    return NextResponse.json(
      { error: "Sage business selection is invalid" },
      { status: 500 }
    );
  }
  return NextResponse.json({
    businesses: eligible,
    providerEnvironment: data.provider_environment,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const companyId =
      typeof body.companyId === "string" ? body.companyId.trim() : "";
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";
    if (!companyId || !sessionId || !businessId) {
      return NextResponse.json(
        { error: "companyId, sessionId, and businessId are required" },
        { status: 400 }
      );
    }
    const authorization = await authorize(request, companyId);
    if (!authorization.ok) return authorization.response;

    const supabase = getServiceRoleClient();
    const { data: consumed, error: consumeError } = await supabase.rpc(
      "consume_sage_business_selection_session",
      {
        p_session_id: sessionId,
        p_actor_user_id: authorization.userId,
        p_company_id: companyId,
      }
    );
    const session = (consumed?.[0] ?? null) as SelectionSession | null;
    if (consumeError || !session) {
      return NextResponse.json(
        { error: "Sage business selection expired" },
        { status: 410 }
      );
    }

    const credentials = getSageCredentials(session.provider_environment);
    let accessToken = decryptToken(session.access_token);
    let refreshToken = decryptToken(session.refresh_token);
    if (!accessToken || !refreshToken) {
      return NextResponse.json(
        { error: "Sage grant is unavailable" },
        { status: 410 }
      );
    }
    let expiresAt = new Date(session.token_expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000) {
      const refreshed = await refreshSageOAuthGrant({
        refreshToken,
        credentials,
      });
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      expiresAt = Date.now() + refreshed.expiresInSeconds * 1000;
    }

    const eligible = await discoverEligibleSageBusinesses({
      accessToken,
      environment: session.provider_environment,
      allowedSandboxBusinessIds: getAllowedSageBusinessIds(
        session.provider_environment
      ),
    });
    const business = eligible.find((candidate) => candidate.id === businessId);
    if (!business) {
      return NextResponse.json(
        { error: "That Sage business is no longer available" },
        { status: 409 }
      );
    }
    const conflict = await findConflictingActiveProvider(
      supabase,
      companyId,
      "sage"
    );
    if (conflict) {
      return NextResponse.json(
        { error: "Another accounting provider is already connected" },
        { status: 409 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("accounting_connections")
      .update({
        access_token: encryptToken(accessToken),
        refresh_token: encryptToken(refreshToken),
        token_expires_at: new Date(expiresAt).toISOString(),
        sage_business_id: encryptToken(business.id),
        sage_business_id_lookup: sageBusinessIdLookup(business.id),
        sage_business_name: business.name,
        is_connected: true,
        sync_enabled: false,
        sync_direction: "pull_only",
        propagate_deletes: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.connection_id)
      .eq("company_id", companyId)
      .eq("provider", "sage")
      .eq("provider_environment", session.provider_environment)
      .select("id")
      .maybeSingle();
    if (updateError) {
      return NextResponse.json(
        { error: "Failed to connect Sage business" },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: "Sage connection no longer exists" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      providerEnvironment: session.provider_environment,
      businessName: business.name,
    });
  } catch {
    console.error("Sage business selection failed");
    return NextResponse.json(
      { error: "Failed to connect Sage business" },
      { status: 500 }
    );
  }
}
