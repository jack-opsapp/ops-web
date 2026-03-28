/**
 * OPS Web - Portal API Helpers
 *
 * Shared utilities for portal API routes: session validation,
 * standard error responses.
 */

import { NextRequest, NextResponse } from "next/server";
import { PortalAuthService } from "./services/portal-auth-service";
import type { PortalSession } from "@/lib/types/portal";

/**
 * Validate the portal session from the request cookie.
 * Returns the session if valid, or a 401 NextResponse if not.
 */
export async function requirePortalSession(
  req: NextRequest
): Promise<PortalSession | NextResponse> {
  const cookieValue = req.cookies.get("ops-portal-session")?.value;

  if (!cookieValue) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  const session = await PortalAuthService.getSessionFromCookie(cookieValue);

  if (!session) {
    return NextResponse.json(
      { error: "Session expired" },
      { status: 401 }
    );
  }

  return session;
}

/**
 * Type guard to check if the result is a NextResponse (error) or a valid session.
 */
export function isErrorResponse(
  result: PortalSession | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}

/**
 * Standard error response for portal API routes.
 */
export function portalError(message: string, status: number = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
