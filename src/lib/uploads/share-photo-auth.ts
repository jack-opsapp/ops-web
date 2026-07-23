import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

export interface SharePhotoAuthContext {
  uid: string;
  userId: string;
  companyId: string;
}

export async function resolveSharePhotoAuth(
  req: NextRequest
): Promise<SharePhotoAuthContext | NextResponse> {
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1]?.trim();
  if (!idToken) {
    return NextResponse.json(
      { error: "Missing Authorization bearer token" },
      { status: 401 }
    );
  }

  let verified: Awaited<ReturnType<typeof verifyAuthToken>>;
  try {
    verified = await verifyAuthToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  const user = await findUserByAuth(
    verified.uid,
    undefined,
    "id, company_id, is_active"
  );
  const userId = typeof user?.id === "string" ? user.id : null;
  const companyId =
    typeof user?.company_id === "string" ? user.company_id : null;
  if (!userId || !companyId || user?.is_active !== true) {
    return NextResponse.json(
      { error: "User has no company association" },
      { status: 403 }
    );
  }

  return {
    uid: verified.uid,
    userId,
    companyId,
  };
}
