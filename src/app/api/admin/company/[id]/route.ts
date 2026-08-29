import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail, getCompanyDetail, getCompanyUsageTimeline } from "@/lib/admin/admin-queries";
import { listAllAuthUsers } from "@/lib/firebase/admin-sdk";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
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
    const read = async <T extends { error: { message?: string } | null }>(
      operation: string,
      pending: PromiseLike<T>
    ): Promise<T> => {
      const result = await pending;
      if (result.error) throw new Error(`Admin company query failed [${operation}]: ${result.error.message ?? "unknown error"}`);
      return result;
    };

    const [
      { data: pipelineData },
      { data: estimateData },
      { data: invoiceData },
      { data: paymentData },
    ] = await Promise.all([
      read("opportunities", db.from("opportunities").select("id, stage, estimated_value, created_at")
        .eq("company_id", id).is("deleted_at", null).is("archived_at", null)),
      read("estimates", db.from("estimates").select("id, status, total, created_at")
        .eq("company_id", id).is("deleted_at", null)),
      read("invoices", db.from("invoices").select("id, status, total, created_at")
        .eq("company_id", id).is("deleted_at", null)),
      read("payments", db.from("payments").select("id, amount, created_at")
        .eq("company_id", id).is("voided_at", null)
        .order("created_at", { ascending: false }).limit(10)),
    ]);

    return NextResponse.json({
      ...detail,
      usersWithAuth,
      usageTimeline,
      pipeline: (pipelineData ?? []).map((p) => ({
        id: p.id, stage: p.stage, value: p.estimated_value ?? 0, created_at: p.created_at,
      })),
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
