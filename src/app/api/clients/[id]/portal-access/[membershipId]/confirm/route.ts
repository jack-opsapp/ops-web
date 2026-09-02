/**
 * POST /api/clients/[id]/portal-access/[membershipId]/confirm
 *
 * Staff confirmation promotes a membership to full history (design I2:
 * `active_full`, evidence `staff_confirmed`). Gate: `clients.edit`; the
 * client must be the caller's, and the membership must be that client's.
 * Body: none. Response: `{ state }` as reported by the system RPC.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  authorizeClientPortalAccess,
  clientOwnsMembership,
  isUuid,
  membershipActionFailure,
} from "@/lib/clients/portal-access";
import { confirmMembership } from "@/lib/customer-identity/rpc";

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
    const state = await confirmMembership(authorization.actor.supabase, {
      membershipId,
      staffUserId: authorization.actor.userId,
    });
    return NextResponse.json({ state });
  } catch (error) {
    return membershipActionFailure(error);
  }
}
