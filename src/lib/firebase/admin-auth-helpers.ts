/**
 * OPS Web - Admin Auth Guard
 *
 * Shared helper for admin API routes that require Firebase JWT + dev_permission.
 * Extracted from the migrate-bubble route auth pattern.
 *
 * NEVER import this from client-side code.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyFirebaseToken } from "./admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface AuthResult {
  userId: string;
  email: string;
}

/**
 * Verify the request has a valid Firebase JWT and the user has dev_permission in Supabase.
 * Returns the user info on success, or a NextResponse error (401/403) on failure.
 */
export async function requireDevPermission(
  req: NextRequest
): Promise<AuthResult | NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json(
      { error: "Missing authorization token" },
      { status: 401 }
    );
  }

  const token = authHeader.replace("Bearer ", "");
  let verifiedUser;
  try {
    verifiedUser = await verifyFirebaseToken(token);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 }
    );
  }

  if (!verifiedUser.email) {
    return NextResponse.json(
      { error: "Token missing email claim" },
      { status: 401 }
    );
  }

  const supabase = getServiceRoleClient();
  const { data: userRow } = await supabase
    .from("users")
    .select("id, dev_permission")
    .eq("email", verifiedUser.email)
    .maybeSingle();

  if (!userRow?.dev_permission) {
    return NextResponse.json(
      { error: "Forbidden: dev_permission required" },
      { status: 403 }
    );
  }

  return { userId: userRow.id, email: verifiedUser.email };
}
