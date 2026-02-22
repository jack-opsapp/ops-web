import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { getCompanyDetail, getCompanyUsageTimeline } from "@/lib/admin/admin-queries";
import { listAllAuthUsers } from "@/lib/firebase/admin-sdk";

const ADMIN_EMAIL = "jack@opsapp.co";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyAdminAuth(req);
  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const [detail, usageTimeline, authUsers] = await Promise.all([
      getCompanyDetail(id),
      getCompanyUsageTimeline(id, 12),
      listAllAuthUsers(),
    ]);

    if (!detail) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // Match auth users to company users by email
    const authByEmail: Record<string, { lastSignIn: string | null }> = {};
    for (const u of authUsers) {
      if (u.email) {
        authByEmail[u.email] = {
          lastSignIn: u.metadata.lastSignInTime ?? null,
        };
      }
    }

    const usersWithAuth = detail.users.map((u) => ({
      ...u,
      lastSignIn: authByEmail[u.email ?? ""]?.lastSignIn ?? null,
    }));

    // Pipeline data
    const { getAdminSupabase } = await import("@/lib/supabase/admin-client");
    const db = getAdminSupabase();
    const [
      { data: pipelineData },
      { data: estimateData },
      { data: invoiceData },
      { data: paymentData },
    ] = await Promise.all([
      db.from("pipeline_references").select("id, stage, value, created_at")
        .eq("company_id", id).is("deleted_at", null),
      db.from("estimates").select("id, status, total_amount, created_at")
        .eq("company_id", id).is("deleted_at", null),
      db.from("invoices").select("id, status, total_amount, created_at")
        .eq("company_id", id).is("deleted_at", null),
      db.from("payments").select("id, amount, created_at")
        .eq("company_id", id).is("deleted_at", null)
        .order("created_at", { ascending: false }).limit(10),
    ]);

    return NextResponse.json({
      ...detail,
      usersWithAuth,
      usageTimeline,
      pipeline: pipelineData ?? [],
      estimates: estimateData ?? [],
      invoices: invoiceData ?? [],
      recentPayments: paymentData ?? [],
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fetch failed" },
      { status: 500 }
    );
  }
}
