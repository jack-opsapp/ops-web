/**
 * Shared auth helpers for agent API routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getCompanyManagerUserIds } from "@/lib/api/services/company-managers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export interface AuthenticatedUser {
  id: string;
  companyId: string;
  role: string;
  isManager: boolean;
  firstName: string | null;
  lastName: string | null;
}

export async function authenticateRequest(
  request: NextRequest
): Promise<AuthenticatedUser | NextResponse> {
  const firebaseUser = await verifyAdminAuth(request);
  if (!firebaseUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(
    firebaseUser.uid,
    undefined,
    "id, company_id, role, is_active, first_name, last_name"
  );
  if (!user || user.is_active !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const managerIds = await getCompanyManagerUserIds(
    getServiceRoleClient(),
    user.company_id as string
  );

  return {
    id: user.id as string,
    companyId: user.company_id as string,
    role: (user.role as string) ?? "unassigned",
    isManager: managerIds.includes(user.id as string),
    firstName: (user.first_name as string | null) ?? null,
    lastName: (user.last_name as string | null) ?? null,
  };
}

export function isErrorResponse(
  result: AuthenticatedUser | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}

/** Guard for financial actions — only admin/owner can approve invoices */
export function requireAdminOrOwner(
  auth: AuthenticatedUser
): NextResponse | null {
  if (auth.isManager) return null;
  return NextResponse.json(
    { error: "Admin or owner access required for this action" },
    { status: 403 }
  );
}
