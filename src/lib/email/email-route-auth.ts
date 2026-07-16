import { NextRequest, NextResponse } from "next/server";

import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

export interface EmailRouteActor {
  userId: string;
  companyId: string;
}

export interface EmailRouteActorClaims {
  /** Optional legacy body claim. It is checked, never trusted. */
  claimedUserId?: string;
  /** Optional legacy body claim. It is checked, never trusted. */
  claimedCompanyId?: string;
}

export type EmailRouteActorResolution =
  | { ok: true; actor: EmailRouteActor }
  | { ok: false; response: NextResponse };

/**
 * Resolve the canonical OPS actor from the verified token subject.
 *
 * Email equality is intentionally disabled here. A login address, personal
 * mailbox address, and company mailbox address are independent identities.
 * Legacy body actor/company fields remain accepted only as consistency claims
 * so rolling clients fail closed instead of being silently trusted.
 */
export async function resolveEmailRouteActor(
  request: NextRequest,
  claims: EmailRouteActorClaims = {}
): Promise<EmailRouteActorResolution> {
  const firebaseUser = await verifyAdminAuth(request);
  if (!firebaseUser?.uid) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const user = await findUserByAuth(
    firebaseUser.uid,
    undefined,
    "id, company_id, is_active"
  );
  const userId = typeof user?.id === "string" ? user.id : "";
  const companyId = typeof user?.company_id === "string" ? user.company_id : "";
  if (!userId || !companyId || user?.is_active !== true) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  if (
    (claims.claimedUserId !== undefined && claims.claimedUserId !== userId) ||
    (claims.claimedCompanyId !== undefined &&
      claims.claimedCompanyId !== companyId)
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, actor: { userId, companyId } };
}

/** Authorize a browser-initiated service-role email operation for one company. */
export async function requireEmailCompanyAccess(
  request: NextRequest,
  companyId: string,
  permission = "settings.integrations",
  expectedUserId?: string
): Promise<NextResponse | null> {
  const actorResolution = await resolveEmailRouteActor(request, {
    claimedCompanyId: companyId,
    claimedUserId: expectedUserId,
  });
  if (!actorResolution.ok) return actorResolution.response;

  const canManageIntegrations = await checkPermissionById(
    actorResolution.actor.userId,
    permission
  );
  if (!canManageIntegrations) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Authorize only the server-to-server stages of the import pipeline. */
export function requireEmailPipelineSecret(
  request: NextRequest
): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Email pipeline secret is not configured" },
      { status: 500 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function emailPipelineAuthorizationHeaders(): Record<string, string> {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    throw new Error("CRON_SECRET is required for email pipeline dispatch");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
  };
}
