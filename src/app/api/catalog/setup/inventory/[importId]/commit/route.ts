import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface CommitBody {
  token?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ importId: string }> },
): Promise<NextResponse> {
  try {
    const { importId } = await params;
    const body = (await req.json()) as CommitBody;
    if (typeof body.token !== "string" || !body.token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
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
    const [canRun, canManageInventory] = await Promise.all([
      checkPermissionById(operatorId, "catalog.run_setup"),
      checkPermissionById(operatorId, "inventory.manage"),
    ]);
    if (!canRun || !canManageInventory) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const client = getAccessTokenClient(body.token);
    const { data, error } = await client.rpc(
      "catalog_inventory_import_commit",
      { p_import_id: importId },
    );
    if (error) {
      console.error(
        "[api/catalog/setup/inventory/commit] RPC failed:",
        error,
      );
      return NextResponse.json(
        { ok: false, error: "Inventory could not be added" },
        { status: 422 },
      );
    }
    const result = record(data);
    if (result.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          status: result.status ?? "attention",
          blockers: Array.isArray(result.blockers)
            ? result.blockers
            : [{ code: "inventory_commit_failed" }],
        },
        { status: 422 },
      );
    }

    const committed = Number(result.committed ?? 0);
    if (result.replayed !== true) {
      const serviceDb = getServiceRoleClient();
      void serviceDb.from("notifications").insert({
        user_id: operatorId,
        company_id: companyId,
        type: "system_alert",
        title: "Inventory added",
        body: `${committed} ${committed === 1 ? "stock record" : "stock records"} added from your list.`,
        is_read: false,
        persistent: false,
        action_url: "/catalog?segment=stock",
        action_label: "OPEN INVENTORY",
      });
    }

    return NextResponse.json({
      ok: true,
      status: "complete",
      committed,
      replayed: result.replayed === true,
    });
  } catch (error) {
    console.error("[api/catalog/setup/inventory/commit] Error:", error);
    if (error instanceof Error && error.message.toLowerCase().includes("token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
