import { NextRequest, NextResponse } from "next/server";

import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

export interface SupplierBillActorContext {
  actorUserId: string;
  companyId: string;
  idToken: string;
}

export async function resolveSupplierBillActor(
  request: NextRequest
): Promise<SupplierBillActorContext | NextResponse> {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1]?.trim();
  if (!idToken) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  let verified: Awaited<ReturnType<typeof verifyAuthToken>>;
  try {
    verified = await verifyAuthToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Authentication expired." },
      { status: 401 }
    );
  }

  const user = await findUserByAuth(
    verified.uid,
    verified.email,
    "id, company_id, is_active"
  );
  if (
    typeof user?.id !== "string" ||
    typeof user.company_id !== "string" ||
    user.is_active !== true
  ) {
    return NextResponse.json(
      { error: "Accounting access denied." },
      { status: 403 }
    );
  }

  return {
    actorUserId: user.id,
    companyId: user.company_id,
    idToken,
  };
}
