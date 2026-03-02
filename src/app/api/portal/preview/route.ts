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
import { getServiceRoleClient } from "@/lib/supabase/server-client";

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

    // Verify the authenticated user belongs to the requested company
    const supabase = getServiceRoleClient();
    const { data: userData } = await supabase
      .from("users")
      .select("company_id")
      .eq("firebase_uid", admin.uid)
      .maybeSingle();

    if (userData && userData.company_id !== companyId) {
      // User found but belongs to a different company
      return NextResponse.json(
        { error: "You do not have access to this company" },
        { status: 403 }
      );
    }

    if (!userData) {
      // firebase_uid not in users table — verify the company exists as fallback
      console.warn(
        `[portal/preview] No user row for firebase_uid=${admin.uid}, falling back to company check`
      );
      const { data: companyRow } = await supabase
        .from("companies")
        .select("id")
        .eq("id", companyId)
        .maybeSingle();

      if (!companyRow) {
        return NextResponse.json(
          { error: "Company not found" },
          { status: 404 }
        );
      }
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
