/**
 * POST /api/portal/preview
 *
 * Admin-only route that creates a short-lived preview portal token.
 * Authenticated via Firebase/Supabase auth (dashboard user).
 *
 * Body: { companyId: string }
 * Returns: { token: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { PortalAuthService } from "@/lib/api/services/portal-auth-service";

export async function POST(req: NextRequest) {
  try {
    const admin = await verifyAdminAuth(req);

    if (!admin) {
      return NextResponse.json(
        { error: "Unauthorized - valid admin authentication required" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { companyId } = body as { companyId?: string };

    if (!companyId) {
      return NextResponse.json(
        { error: "Missing required field: companyId" },
        { status: 400 }
      );
    }

    const portalToken = await PortalAuthService.createPreviewToken(companyId);

    return NextResponse.json({ token: portalToken.token });
  } catch (error) {
    console.error("[portal/preview] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create preview token",
      },
      { status: 500 }
    );
  }
}
