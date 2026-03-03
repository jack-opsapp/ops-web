/**
 * POST /api/setup/initialize-workspace
 *
 * Client-callable safety-net that seeds company defaults (task types,
 * inventory units, company settings) via the idempotent DB function.
 * Called during the launch animation as a parallel fire-and-forget.
 * The primary call happens server-side in /api/setup/progress when
 * the company row is first created — this is a redundant backup.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface InitWorkspaceBody {
  token: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as InitWorkspaceBody;
    const { token } = body;

    if (!token) {
      return NextResponse.json(
        { error: "Missing required field: token" },
        { status: 400 }
      );
    }

    const verifiedUser = await verifyAuthToken(token);
    const authUid = verifiedUser.uid;

    const db = getServiceRoleClient();

    // Look up user → company
    const { data: userRow, error: userLookupError } = await db
      .from("users")
      .select("company_id")
      .eq("auth_id", authUid)
      .is("deleted_at", null)
      .maybeSingle();

    if (userLookupError || !userRow?.company_id) {
      return NextResponse.json(
        { error: "User or company not found" },
        { status: 404 }
      );
    }

    const companyId = userRow.company_id as string;

    // Idempotent — safe to call even if already seeded
    const { error: rpcError } = await db.rpc("initialize_company_defaults", {
      p_company_id: companyId,
    });

    if (rpcError) {
      console.error("[api/setup/initialize-workspace] RPC error:", rpcError);
      return NextResponse.json(
        { error: "Failed to initialize workspace defaults" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/setup/initialize-workspace] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
