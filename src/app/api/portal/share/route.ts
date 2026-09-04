/**
 * POST /api/portal/share — retired.
 *
 * The legacy magic-link portal auth is retired, not migrated (design D7,
 * specs/2026-09-01-public-api-customer-identity-design.md). This route once
 * minted seven-day multi-use portal links and emailed them; it now answers
 * 410 for every caller without verifying a token, reading a body, or
 * touching the database. The customer identity broker under /api/customer
 * replaces it; the portal tables are dropped in P3.
 */

import { NextResponse, type NextRequest } from "next/server";

const PORTAL_SHARE_RETIRED = Object.freeze({
  error: "portal_link_sharing_retired",
});

// The request is deliberately never read: no token, no body, no branding.
export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(PORTAL_SHARE_RETIRED, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}
