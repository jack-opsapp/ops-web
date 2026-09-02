/**
 * POST /api/clients/[id]/portal-access/[membershipId]/revoke
 *
 * Staff revoke a customer's membership to this client (design I7: companies
 * can revoke). Gate: `clients.edit`; the client must be the caller's, and the
 * membership must be that client's. Body: none — the reason is fixed to
 * `staff_revoked` so the audit trail names the actor class, never free text.
 * Response: `{ revoked }` as reported by the system RPC.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  authorizeClientPortalAccess,
  clientOwnsMembership,
  isUuid,
  membershipActionFailure,
  STAFF_REVOKE_REASON,
} from "@/lib/clients/portal-access";
import { revokeMembership } from "@/lib/customer-identity/rpc";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; membershipId: string }> }
) {
  const { id: clientId, membershipId } = await params;

  const authorization = await authorizeClientPortalAccess(request, clientId, "clients.edit");
  if (!authorization.ok) return authorization.response;

  if (!isUuid(membershipId)) {
    return NextResponse.json({ error: "Invalid membership" }, { status: 400 });
  }

  try {
    if (!(await clientOwnsMembership(authorization.actor, membershipId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const revoked = await revokeMembership(authorization.actor.supabase, {
      membershipId,
      staffUserId: authorization.actor.userId,
      reason: STAFF_REVOKE_REASON,
    });
    return NextResponse.json({ revoked });
  } catch (error) {
    return membershipActionFailure(error);
  }
}
