/**
 * Retired raw provider client-search endpoint.
 *
 * Client email/domain searches cannot prove a canonical thread-to-opportunity
 * relationship before provider access. Authorized sibling context now lives at
 * /api/inbox/threads/[id]/siblings and starts from an internal OPS thread ID.
 */

import { NextRequest, NextResponse } from "next/server";

import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";

export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json(
      { error: "companyId is required" },
      { status: 400 }
    );
  }

  const actorResolution = await resolveEmailRouteActor(request, {
    claimedCompanyId: companyId,
  });
  if (!actorResolution.ok) return actorResolution.response;

  // Fail closed. This route has no canonical internal-thread anchor and must
  // never search a company or personal mailbox by caller-supplied client data.
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
