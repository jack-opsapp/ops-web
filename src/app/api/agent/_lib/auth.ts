/**
 * Shared auth helpers for agent API routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

export interface AuthenticatedUser {
  id: string;
  companyId: string;
  role: string;
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
    firebaseUser.email,
    "id, company_id, role"
  );
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return {
    id: user.id as string,
    companyId: user.company_id as string,
    role: (user.role as string) ?? "unassigned",
  };
}

export function isErrorResponse(
  result: AuthenticatedUser | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}

/** Guard for financial actions — only admin/owner can approve invoices */
export function requireAdminOrOwner(auth: AuthenticatedUser): NextResponse | null {
  if (["admin", "owner"].includes(auth.role)) return null;
  return NextResponse.json(
    { error: "Admin or owner access required for this action" },
    { status: 403 }
  );
}
