import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { CustomerIdentityStoreError } from "@/lib/customer-identity/errors";
import {
  listMembershipsForClient,
  type MembershipEvidenceKind,
  type MembershipState,
} from "@/lib/customer-identity/rpc";

/**
 * Staff "Portal access" (design §5.4, invariants I2 and I7).
 *
 * Shared spine for the three routes under `/api/clients/[id]/portal-access`:
 * Firebase staff auth → active `users` row → granular permission (never a
 * role name) → the client must belong to the caller's company. Only then does
 * a route reach the customer identity system RPCs, which run with the
 * service role over `private` tables (design D8).
 *
 * The route-facing membership shape carries the membership id, the state,
 * the evidence kind, a masked email and the last-seen stamp — never a client,
 * company or identity id, and never a full mailbox (design I4).
 */

export const PORTAL_ACCESS_UNAVAILABLE = "portal_access_unavailable" as const;

/** Reason recorded on the membership when staff revoke from the dossier. */
export const STAFF_REVOKE_REASON = "staff_revoked" as const;

export type ClientPortalAccessPermission = "clients.view" | "clients.edit";

export interface ClientPortalMembership {
  readonly membershipId: string;
  readonly state: MembershipState;
  readonly evidenceKind: MembershipEvidenceKind;
  readonly maskedEmail: string;
  readonly lastSeenAt: string | null;
}

export interface ClientPortalActor {
  readonly userId: string;
  readonly companyId: string;
  readonly clientId: string;
  readonly supabase: SupabaseClient;
}

export type ClientPortalAuthorization =
  | { readonly ok: true; readonly actor: ClientPortalActor }
  | { readonly ok: false; readonly response: NextResponse };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function deny(status: 401 | 403 | 404 | 500, error: string): ClientPortalAuthorization {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/**
 * Resolve and authorize the staff caller for one client. A client id that is
 * not a uuid cannot name a row, so it is reported exactly like a client from
 * another company: not found.
 */
export async function authorizeClientPortalAccess(
  request: NextRequest,
  clientId: string,
  permission: ClientPortalAccessPermission
): Promise<ClientPortalAuthorization> {
  const auth = await verifyAdminAuth(request);
  if (!auth) return deny(401, "Unauthorized");

  // The lookup only returns the columns it is asked for; `is_active` must be
  // requested explicitly or the gate below can never pass.
  const user = await findUserByAuth(auth.uid, auth.email, "id, company_id, is_active");
  const userId = typeof user?.id === "string" ? user.id : "";
  const companyId = typeof user?.company_id === "string" ? user.company_id : "";
  if (!userId || !companyId || user?.is_active !== true) {
    return deny(403, "Forbidden");
  }

  const allowed = await checkPermissionById(userId, permission);
  if (!allowed) return deny(403, "Forbidden");

  if (!isUuid(clientId)) return deny(404, "Not found");

  const supabase = getServiceRoleClient();
  // Tenancy: the client id comes from the URL; it must never widen the
  // caller's scope past their own company.
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (clientError) return deny(500, "Client lookup failed");
  if (!clientRow) return deny(404, "Not found");

  return { ok: true, actor: { userId, companyId, clientId, supabase } };
}

/** Lists the client's memberships in the route-facing shape. Throws on store failure. */
export async function listClientPortalMemberships(
  actor: ClientPortalActor
): Promise<readonly ClientPortalMembership[]> {
  const rows = await listMembershipsForClient(actor.supabase, {
    companyId: actor.companyId,
    clientId: actor.clientId,
  });
  return rows.map((row) => ({
    membershipId: row.membership_id,
    state: row.state,
    evidenceKind: row.evidence_kind,
    maskedEmail: row.contact_email_masked,
    lastSeenAt: row.last_seen_at,
  }));
}

/**
 * True when the membership is one of this client's. Confirm and revoke take
 * a membership id from the URL; binding it to the client in the same URL
 * keeps one route from acting on another client's membership.
 */
export async function clientOwnsMembership(
  actor: ClientPortalActor,
  membershipId: string
): Promise<boolean> {
  const memberships = await listClientPortalMemberships(actor);
  return memberships.some((membership) => membership.membershipId === membershipId);
}

export function portalAccessUnavailable(): NextResponse {
  return NextResponse.json({ error: PORTAL_ACCESS_UNAVAILABLE }, { status: 503 });
}

function storeErrorCode(error: unknown): string | null {
  if (!(error instanceof CustomerIdentityStoreError)) return null;
  const cause = error.cause;
  if (typeof cause !== "object" || cause === null) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Maps a failed confirm / revoke to a response. The RPCs re-check authority
 * themselves (active member of the membership's company holding
 * `clients.edit`) and raise `42501` when it is missing — answered with the
 * same generic 403 as the route's own gate. `P0002` is a membership the store
 * no longer knows; `22023` is one that can no longer change (merged, revoked,
 * or a bad argument). Anything else is a store failure and fails closed.
 */
export function membershipActionFailure(error: unknown): NextResponse {
  switch (storeErrorCode(error)) {
    case "42501":
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    case "P0002":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "22023":
      return NextResponse.json({ error: "Conflict" }, { status: 409 });
    default:
      return portalAccessUnavailable();
  }
}
