/**
 * OPS Web — Accounting sync-mode setting
 *
 * POST /api/integrations/accounting/sync-mode
 * Body: { companyId, provider, syncDirection: "pull_only" | "bidirectional",
 *         propagateDeletes?: boolean }
 *
 * Sets a connection's sync direction (read-only ↔ full CRUD) and the
 * delete-propagation preference. Service-role write — the web client reads
 * accounting_connections as the anon role but cannot write it (RLS). Gated by
 * the accounting.manage_connections permission.
 *
 * Selecting "bidirectional" (full CRUD) allows provider writes only when the
 * hard gate ACCOUNTING_WRITE_ENABLED=true is also set. `writesEnabled` is
 * returned so the UI can explain the gated state.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getQuickBooksProviderEnvironment } from "@/lib/api/services/quickbooks-config";

const VALID_DIRECTIONS = new Set(["pull_only", "bidirectional"]);

export async function POST(request: NextRequest) {
  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const companyId = body.companyId as string | undefined;
    const provider = body.provider as string | undefined;
    const syncDirection = body.syncDirection as string | undefined;
    const propagateDeletes = body.propagateDeletes;

    if (!companyId || !provider || !syncDirection) {
      return NextResponse.json(
        { error: "companyId, provider and syncDirection are required" },
        { status: 400 }
      );
    }
    if (!VALID_DIRECTIONS.has(syncDirection)) {
      return NextResponse.json(
        { error: 'syncDirection must be "pull_only" or "bidirectional"' },
        { status: 400 }
      );
    }
    if (propagateDeletes !== undefined && typeof propagateDeletes !== "boolean") {
      return NextResponse.json({ error: "propagateDeletes must be a boolean" }, { status: 400 });
    }

    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if ((user.company_id as string) !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const allowed = await checkPermissionById(user.id as string, "accounting.manage_connections");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();
    const providerEnvironment =
      provider === "quickbooks" ? getQuickBooksProviderEnvironment() : "production";

    const patch: Record<string, unknown> = {
      sync_direction: syncDirection,
      updated_at: new Date().toISOString(),
    };
    if (typeof propagateDeletes === "boolean") {
      patch.propagate_deletes = propagateDeletes;
    }
    // Read-only can never propagate deletes — there are no writes at all.
    if (syncDirection === "pull_only") {
      patch.propagate_deletes = false;
    }

    const { data, error } = await supabase
      .from("accounting_connections")
      .update(patch)
      .eq("company_id", companyId)
      .eq("provider", provider)
      .eq("provider_environment", providerEnvironment)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Failed to update sync mode: ${error.message}` },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: `No ${provider} connection found` }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      syncDirection,
      propagateDeletes: patch.propagate_deletes ?? false,
      writesEnabled: process.env.ACCOUNTING_WRITE_ENABLED === "true",
    });
  } catch (err) {
    console.error("sync-mode update error:", err);
    return NextResponse.json({ error: "Failed to update sync mode" }, { status: 500 });
  }
}
