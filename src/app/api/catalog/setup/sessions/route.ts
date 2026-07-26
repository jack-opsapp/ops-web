import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { startOrResumeGuidedSetupSession } from "@/lib/catalog-setup/phase-c/session-service";

interface StartSessionBody {
  token?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as StartSessionBody;
    if (typeof body.token !== "string" || !body.token) {
      return NextResponse.json(
        { error: "Missing required field: token" },
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

    const agentAvailable = Boolean(process.env.OPENAI_API_KEY?.trim());
    if (!agentAvailable) {
      return NextResponse.json({
        session: null,
        resumed: false,
        agentAvailable: false,
      });
    }

    const result = await startOrResumeGuidedSetupSession({
      token: body.token,
      companyId,
      operatorId,
    });
    return NextResponse.json({
      ...result,
      agentAvailable: true,
    });
  } catch (error) {
    console.error("[api/catalog/setup/sessions] Error:", error);
    if (error instanceof Error && error.message.toLowerCase().includes("token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
