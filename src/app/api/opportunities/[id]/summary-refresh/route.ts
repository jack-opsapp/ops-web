import { NextRequest, NextResponse } from "next/server";

import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { refreshLeadSummariesForOpportunities } from "@/lib/api/services/lead-summary-service";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}
/**
 * A burst of consecutive activity writes must cost ONE model call, not N. A
 * summary refreshed inside this window is still current enough; the write is
 * coalesced onto the durable queue and drained by the recurring cron.
 */
const DEBOUNCE_WINDOW_MS = 90_000;

function rpcErrorStatus(code: string | undefined): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22P02" || code === "22023") return 400;
  return 500;
}

/**
 * Eager Phase C refresh after a human activity write. The actor/company scope
 * comes only from the verified bearer token and the guarded database RPC.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await verifyAuthToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: opportunityId } = await params;
  if (!UUID_PATTERN.test(opportunityId)) {
    return NextResponse.json({ error: "Invalid opportunity" }, { status: 400 });
  }

  const actorDb = getAccessTokenClient(token);
  const { data: companyId, error: authorizationError } = await actorDb.rpc(
    "authorize_lead_summary_refresh",
    { p_opportunity_id: opportunityId }
  );
  if (authorizationError || typeof companyId !== "string") {
    const status = rpcErrorStatus(authorizationError?.code);
    if (status === 500) {
      console.error("[lead-summary] Refresh authorization failed", {
        code: authorizationError?.code ?? "invalid_result",
      });
    }
    return NextResponse.json(
      { error: status === 500 ? "Unable to refresh summary" : "Refresh not allowed" },
      { status }
    );
  }

  const serviceDb = getServiceRoleClient();

  // Debounce: a summary written moments ago is still current. Coalesce this
  // request onto the durable queue instead of paying for a second model call.
  const { data: existing } = await serviceDb
    .from("opportunities")
    .select("ai_summary_updated_at")
    .eq("id", opportunityId)
    .eq("company_id", companyId)
    .maybeSingle();
  const lastWrittenAt = Date.parse(
    (existing as { ai_summary_updated_at?: string | null } | null)
      ?.ai_summary_updated_at ?? ""
  );
  if (
    Number.isFinite(lastWrittenAt) &&
    Date.now() - lastWrittenAt < DEBOUNCE_WINDOW_MS
  ) {
    const { error: queueError } = await serviceDb
      .from("lead_summary_refresh_requests")
      .upsert(
        {
          opportunity_id: opportunityId,
          company_id: companyId,
          requested_at: new Date().toISOString(),
        },
        { onConflict: "opportunity_id" }
      );
    if (queueError) {
      console.error("[lead-summary] Debounced enqueue failed", {
        code: queueError.code ?? "unknown",
      });
      return NextResponse.json(
        { error: "Unable to refresh summary" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { ok: true, refreshed: false, reason: "debounced" },
      { status: 202 }
    );
  }

  try {
    const result = await refreshLeadSummariesForOpportunities({
      supabase: serviceDb,
      companyId,
      opportunityIds: [opportunityId],
    });

    if (result.skippedFeatureDisabled) {
      return NextResponse.json(
        { ok: true, refreshed: false, reason: "feature_disabled" },
        { status: 202 }
      );
    }
    if (result.failed.length > 0 || result.deferred.length > 0) {
      return NextResponse.json(
        { error: "Summary refresh deferred" },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true, refreshed: result.written === 1 });
  } catch (error) {
    console.error("[lead-summary] Activity refresh failed", error);
    return NextResponse.json(
      { error: "Unable to refresh summary" },
      { status: 503 }
    );
  }
}
