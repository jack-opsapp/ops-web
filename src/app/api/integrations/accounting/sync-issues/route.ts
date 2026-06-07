import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getQuickBooksProviderEnvironment } from "@/lib/api/services/quickbooks-config";

export async function GET(request: NextRequest) {
  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
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
    const providerEnvironment = getQuickBooksProviderEnvironment();
    const { data: connection, error: connectionError } = await supabase
      .from("accounting_connections")
      .select("id")
      .eq("company_id", companyId)
      .eq("provider", "quickbooks")
      .eq("provider_environment", providerEnvironment)
      .eq("is_connected", true)
      .maybeSingle();

    if (connectionError) {
      return NextResponse.json({ error: "Failed to load QuickBooks connection" }, { status: 500 });
    }

    if (!connection?.id) {
      return NextResponse.json({ issues: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data, error } = await supabase
      .from("accounting_sync_queue")
      .select("id, entity_type, entity_id, external_id, operation, status, last_error, updated_at")
      .eq("company_id", companyId)
      .eq("provider", "quickbooks")
      .eq("connection_id", connection.id)
      .in("status", ["blocked", "needs_review"])
      .order("updated_at", { ascending: false })
      .limit(10);

    if (error) {
      return NextResponse.json({ error: "Failed to load sync issues" }, { status: 500 });
    }

    return NextResponse.json(
      {
        issues: (data ?? []).map((row) => ({
          id: row.id,
          entityType: row.entity_type,
          entityId: row.entity_id,
          externalId: row.external_id,
          operation: row.operation,
          status: row.status,
          lastError: row.last_error,
          updatedAt: row.updated_at,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[accounting-sync-issues] GET error:", error);
    return NextResponse.json({ error: "Failed to load sync issues" }, { status: 500 });
  }
}
