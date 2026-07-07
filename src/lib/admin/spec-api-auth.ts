import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { isSpecOperator } from "@/lib/admin/spec-permissions";

export interface SpecApiOperatorContext {
  userId: string;
}

export async function requireSpecOperatorApi(req: NextRequest): Promise<SpecApiOperatorContext> {
  const fbUser = await verifyAdminAuth(req);
  if (!fbUser?.email) {
    throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const opsUser = await findUserByAuth(fbUser.uid, fbUser.email, "id");
  if (!opsUser || typeof opsUser.id !== "string") {
    throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ok = await isSpecOperator(opsUser.id);
  if (!ok) {
    throw NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { userId: opsUser.id };
}

export function withSpecOperatorApi<TRest extends unknown[]>(
  handler: (
    req: NextRequest,
    operator: SpecApiOperatorContext,
    ...rest: TRest
  ) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ...rest: TRest) => {
    try {
      const operator = await requireSpecOperatorApi(req);
      return await handler(req, operator, ...rest);
    } catch (err) {
      if (err instanceof NextResponse) return err;
      console.error("[spec-admin-api]", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
