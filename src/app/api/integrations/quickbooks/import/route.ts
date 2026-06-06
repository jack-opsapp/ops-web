/**
 * OPS Web — QuickBooks Read-Only Import
 *
 * POST /api/integrations/quickbooks/import        — start run + pull + stage + compute matches → { runId }
 * GET  /api/integrations/quickbooks/import?runId= — return the QboImportReview aggregate
 *
 * Auth mirrors /api/sync: Firebase/Supabase JWT → company-access check →
 * accounting.manage_connections permission. Read-only: issues ONLY GET calls
 * to QuickBooks; nothing is written to Intuit.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { QuickBooksImportService } from "@/lib/api/services/quickbooks-import-service";
import { getQuickBooksProviderEnvironment } from "@/lib/api/services/quickbooks-config";

const PROVIDER = "quickbooks";

// ─── POST: start run + pull + stage + compute matches ───────────────────────

export async function POST(request: NextRequest) {
  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const companyId = (body as { companyId?: string }).companyId;
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
    const { data: connection, error: connError } = await supabase
      .from("accounting_connections")
      .select("id, is_connected")
      .eq("company_id", companyId)
      .eq("provider", PROVIDER)
      .eq("provider_environment", providerEnvironment)
      .single();

    if (connError || !connection) {
      return NextResponse.json({ error: "No QuickBooks connection found" }, { status: 404 });
    }
    if (!connection.is_connected) {
      return NextResponse.json({ error: "QuickBooks is not connected" }, { status: 400 });
    }

    const service = new QuickBooksImportService(supabase);
    try {
      const run = await service.startImportRun(companyId);
      await service.pullAndStage(run.id);
      await service.computeCustomerMatches(run.id);
      return NextResponse.json({ runId: run.id });
    } catch {
      // Do not log the caught error — its message can carry the raw QuickBooks
      // error body (the pull service interpolates the upstream response text).
      console.error("[qbo-import] pull/stage step failed");
      return NextResponse.json(
        { error: "Import failed" },
        { status: 500 }
      );
    }
  } catch {
    console.error("[qbo-import] POST error");
    return NextResponse.json({ error: "Failed to start import" }, { status: 500 });
  }
}

// ─── GET: review aggregate ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const allowed = await checkPermissionById(user.id as string, "accounting.manage_connections");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();
    const service = new QuickBooksImportService(supabase);

    // Scope check: the run must belong to the caller's company.
    // QboImportRun is the A0-owned canonical type and exposes `companyId` (camelCase).
    const review = await service.getImportReview(runId);
    if (review.run && review.run.companyId !== (user.company_id as string)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Staged QuickBooks customer/financial data — never cache it anywhere
    // (browser, CDN, shared proxy). Always re-fetch from the origin.
    return NextResponse.json(review, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    console.error("[qbo-import] GET error");
    return NextResponse.json({ error: "Failed to load import review" }, { status: 500 });
  }
}
