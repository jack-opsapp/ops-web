/**
 * POST /api/data/delete-account
 *
 * Cascade soft-deletes all company data and cancels Stripe subscriptions.
 * Requires Firebase auth token + admin role + "DELETE" confirmation.
 *
 * Body: { idToken: string, companyId: string, confirmText: string }
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

async function softDeleteTable(
  db: ReturnType<typeof getServiceRoleClient>,
  table: string,
  companyId: string,
  companyField = "company_id"
): Promise<number> {
  const now = new Date().toISOString();

  // First count how many will be affected
  const { count } = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(companyField, companyId)
    .is("deleted_at", null);

  // Then perform the update
  const { error } = await db
    .from(table)
    .update({ deleted_at: now })
    .eq(companyField, companyId)
    .is("deleted_at", null);

  if (error) {
    console.error(`[delete-account] Failed to soft-delete ${table}:`, error.message);
    return 0;
  }
  return count ?? 0;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { idToken, companyId, confirmText } = await req.json();

    if (!idToken || !companyId) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, companyId" },
        { status: 400 }
      );
    }

    if (confirmText !== "DELETE") {
      return NextResponse.json(
        { error: "Please type DELETE to confirm account deletion" },
        { status: 400 }
      );
    }

    // Verify auth
    const firebaseUser = await verifyAuthToken(idToken);
    const db = getServiceRoleClient();

    // Verify user belongs to company and is admin
    const { data: user } = await db
      .from("users")
      .select("id, company_id, is_company_admin")
      .eq("auth_id", firebaseUser.uid)
      .is("deleted_at", null)
      .maybeSingle();

    if (!user || user.company_id !== companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Verify user is admin
    const { data: company } = await db
      .from("companies")
      .select("id, admin_ids, stripe_customer_id")
      .eq("id", companyId)
      .is("deleted_at", null)
      .single();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const adminIds = (company.admin_ids as string[]) ?? [];
    const isAdmin = user.is_company_admin || adminIds.includes(user.id);

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Only company admins can delete the account" },
        { status: 403 }
      );
    }

    // ─── Cascade Soft-Delete ─────────────────────────────────────────────────

    // First, get estimate and invoice IDs for line item deletion
    const { data: estimates } = await db
      .from("estimates")
      .select("id")
      .eq("company_id", companyId)
      .is("deleted_at", null);

    const { data: invoices } = await db
      .from("invoices")
      .select("id")
      .eq("company_id", companyId)
      .is("deleted_at", null);

    const now = new Date().toISOString();
    const deletedCounts: Record<string, number> = {};

    // Soft-delete estimate line items
    const estimateIds = (estimates ?? []).map((e) => e.id);
    if (estimateIds.length > 0) {
      const { error: eliError } = await db
        .from("estimate_line_items")
        .update({ deleted_at: now })
        .in("estimate_id", estimateIds)
        .is("deleted_at", null);
      deletedCounts.estimateLineItems = eliError ? 0 : estimateIds.length;
    }

    // Soft-delete invoice line items
    const invoiceIds = (invoices ?? []).map((i) => i.id);
    if (invoiceIds.length > 0) {
      const { error: iliError } = await db
        .from("invoice_line_items")
        .update({ deleted_at: now })
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null);
      deletedCounts.invoiceLineItems = iliError ? 0 : invoiceIds.length;
    }

    // Soft-delete all company-scoped tables
    const tables = [
      "calendar_events",
      "tasks",
      "estimates",
      "invoices",
      "payments",
      "projects",
      "opportunities",
      "clients",
      "products",
      "task_types_v2",
      "users",
    ];

    for (const table of tables) {
      deletedCounts[table] = await softDeleteTable(db, table, companyId);
    }

    // Soft-delete the company itself
    const { error: companyDeleteError } = await db
      .from("companies")
      .update({ deleted_at: now })
      .eq("id", companyId);

    if (companyDeleteError) {
      console.error("[delete-account] Failed to soft-delete company:", companyDeleteError.message);
    }
    deletedCounts.companies = companyDeleteError ? 0 : 1;

    // ─── Cancel Stripe Subscriptions ─────────────────────────────────────────

    if (company.stripe_customer_id) {
      try {
        const stripe = getStripe();
        const subscriptions = await stripe.subscriptions.list({
          customer: company.stripe_customer_id,
          status: "active",
        });

        for (const sub of subscriptions.data) {
          await stripe.subscriptions.cancel(sub.id);
        }

        console.log(
          `[delete-account] Cancelled ${subscriptions.data.length} Stripe subscription(s) for company ${companyId}`
        );
      } catch (stripeError) {
        console.error("[delete-account] Failed to cancel Stripe subscriptions:", stripeError);
        // Don't fail the entire deletion — subscriptions can be cleaned up later
      }
    }

    console.log(`[delete-account] Account deleted for company ${companyId}:`, deletedCounts);

    return NextResponse.json({
      success: true,
      deletedCounts,
    });
  } catch (error) {
    console.error("[delete-account] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Deletion failed" },
      { status: 500 }
    );
  }
}
