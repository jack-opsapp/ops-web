/**
 * Admin API route auth helper.
 * Verifies token + checks admin table, returns user or throws 401.
 */
import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "./admin-queries";

export async function requireAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user?.email) {
    throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdminEmail(user.email);
  if (!admin) {
    throw NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return user;
}

/** Wrapper for API route handlers — catches thrown NextResponse errors */
export function withAdmin(
  handler: (req: NextRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof NextResponse) return err;
      console.error("[admin-api]", err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
