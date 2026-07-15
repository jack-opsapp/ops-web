import { NextRequest, NextResponse } from "next/server";

import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

/** Authorize a browser-initiated service-role email operation for one company. */
export async function requireEmailCompanyAccess(
  request: NextRequest,
  companyId: string,
  permission = "settings.integrations",
  expectedUserId?: string
): Promise<NextResponse | null> {
  const firebaseUser = await verifyAdminAuth(request);
  if (!firebaseUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(
    firebaseUser.uid,
    firebaseUser.email,
    "id, company_id"
  );
  if (
    !user ||
    (user.company_id as string) !== companyId ||
    (expectedUserId !== undefined && (user.id as string) !== expectedUserId)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canManageIntegrations = await checkPermissionById(
    user.id as string,
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
