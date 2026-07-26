import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import {
  abandonGuidedSetupSession,
  GuidedSetupSessionVersionConflictError,
} from "@/lib/catalog-setup/phase-c/session-service";

interface AbandonBody {
  token?: unknown;
  expectedVersion?: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  try {
    const { sessionId } = await params;
    const body = (await req.json()) as AbandonBody;
    if (typeof body.token !== "string" || !body.token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }
    if (
      !Number.isInteger(body.expectedVersion) ||
      Number(body.expectedVersion) < 0
    ) {
      return NextResponse.json(
        { error: "expectedVersion must be a non-negative integer" },
        { status: 400 },
      );
    }

    const verified = await verifyAuthToken(body.token);
    const userRow = await findUserByAuth(
      verified.uid,
      verified.email,
      "id, company_id",
    );
    if (!userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const operatorId = userRow.id as string;
    const companyId = userRow.company_id as string | null;
    if (!companyId) {
      return NextResponse.json(
        { error: "User has no company" },
        { status: 400 },
      );
    }

    const [canView, canRun] = await Promise.all([
      checkPermissionById(operatorId, "catalog.view"),
      checkPermissionById(operatorId, "catalog.run_setup"),
    ]);
    if (!canView || !canRun) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const session = await abandonGuidedSetupSession({
      token: body.token,
      companyId,
      operatorId,
      sessionId,
      expectedVersion: Number(body.expectedVersion),
    });
    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof GuidedSetupSessionVersionConflictError) {
      return NextResponse.json(
        { error: "Setup changed in another window", code: "version_conflict" },
        { status: 409 },
      );
    }
    console.error("[api/catalog/setup/sessions/abandon] Error:", error);
    if (error instanceof Error && error.message.toLowerCase().includes("token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
