/**
 * GET /api/clients/[id]/portal-access
 *
 * Lists the customer memberships attached to one client for the dossier's
 * "Portal access" block (design §5.4). Read gate: `clients.view`; the client
 * must belong to the caller's company. Rows carry a masked email only.
 *
 * 503 `portal_access_unavailable` when the membership store cannot answer —
 * including before the P1-1 migration lands — so the block can say so
 * plainly instead of pretending the client has no portal access.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  authorizeClientPortalAccess,
  listClientPortalMemberships,
  portalAccessUnavailable,
} from "@/lib/clients/portal-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;

  const authorization = await authorizeClientPortalAccess(request, clientId, "clients.view");
  if (!authorization.ok) return authorization.response;

  try {
    const memberships = await listClientPortalMemberships(authorization.actor);
    return NextResponse.json({ memberships });
  } catch {
    return portalAccessUnavailable();
  }
}
