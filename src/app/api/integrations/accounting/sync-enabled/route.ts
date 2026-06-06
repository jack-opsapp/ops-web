/**
 * OPS Web — Accounting sync pause/resume
 *
 * POST /api/integrations/accounting/sync-enabled
 * Body: { companyId, provider, syncEnabled }
 *
 * Service-role write gated by accounting.manage_connections. QuickBooks updates
 * are scoped to the active provider environment so production and sandbox rows
 * can coexist without one toggle mutating both.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getQuickBooksProviderEnvironment } from "@/lib/api/services/quickbooks-config";

export async function POST(request: NextRequest) {
  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const companyId = body.companyId as string | undefined;
    const provider = body.provider as string | undefined;
    const syncEnabled = body.syncEnabled;

    if (!companyId || !provider || typeof syncEnabled !== "boolean") {
      return NextResponse.json(
        { error: "companyId, provider and syncEnabled are required" },
        { status: 400 }
      );
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

    const { data, error } = await supabase
      .from("accounting_connections")
      .update({ sync_enabled: syncEnabled, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("provider", provider)
      .eq("provider_environment", providerEnvironment)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Failed to update sync enabled: ${error.message}` },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: `No ${provider} connection found` }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      syncEnabled,
      providerEnvironment,
    });
  } catch (err) {
    console.error("sync-enabled update error:", err);
    return NextResponse.json({ error: "Failed to update sync enabled" }, { status: 500 });
  }
}
