/**
 * POST /api/data/export
 *
 * Exports all company data as a JSON file download.
 * Requires Firebase auth token. Only company members can export.
 *
 * Body: { idToken: string, companyId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

async function fetchTable(
  db: ReturnType<typeof getServiceRoleClient>,
  table: string,
  companyId: string,
  companyField = "company_id"
) {
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq(companyField, companyId)
    .is("deleted_at", null);

  if (error) {
    console.error(`[data/export] Failed to fetch ${table}:`, error.message);
    return [];
  }
  return data ?? [];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { idToken, companyId } = await req.json();

    if (!idToken || !companyId) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, companyId" },
        { status: 400 }
      );
    }

    // Verify auth
    const firebaseUser = await verifyAuthToken(idToken);

    const db = getServiceRoleClient();

    // Verify user belongs to company
    const { data: user } = await db
      .from("users")
      .select("id, company_id")
      .eq("auth_id", firebaseUser.uid)
      .is("deleted_at", null)
      .maybeSingle();

    if (!user || user.company_id !== companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Fetch company
    const { data: company } = await db
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .is("deleted_at", null)
      .single();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // Fetch all entity data in parallel
    const [
      users,
      projects,
      tasks,
      clients,
      estimates,
      invoices,
      payments,
      opportunities,
      calendarEvents,
      products,
      taskTypes,
    ] = await Promise.all([
      fetchTable(db, "users", companyId),
      fetchTable(db, "projects", companyId),
      fetchTable(db, "tasks", companyId),
      fetchTable(db, "clients", companyId),
      fetchTable(db, "estimates", companyId),
      fetchTable(db, "invoices", companyId),
      fetchTable(db, "payments", companyId),
      fetchTable(db, "opportunities", companyId),
      fetchTable(db, "calendar_events", companyId),
      fetchTable(db, "products", companyId),
      fetchTable(db, "task_types_v2", companyId),
    ]);

    // Fetch line items for estimates and invoices
    const estimateIds = estimates.map((e: { id: string }) => e.id);
    const invoiceIds = invoices.map((i: { id: string }) => i.id);

    let estimateLineItems: unknown[] = [];
    let invoiceLineItems: unknown[] = [];

    if (estimateIds.length > 0) {
      const { data } = await db
        .from("estimate_line_items")
        .select("*")
        .in("estimate_id", estimateIds)
        .is("deleted_at", null);
      estimateLineItems = data ?? [];
    }

    if (invoiceIds.length > 0) {
      const { data } = await db
        .from("invoice_line_items")
        .select("*")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null);
      invoiceLineItems = data ?? [];
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      company,
      users,
      projects,
      tasks,
      clients,
      estimates,
      estimateLineItems,
      invoices,
      invoiceLineItems,
      payments,
      opportunities,
      calendarEvents,
      products,
      taskTypes,
    };

    const json = JSON.stringify(exportData, null, 2);

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="ops-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    console.error("[data/export] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}
