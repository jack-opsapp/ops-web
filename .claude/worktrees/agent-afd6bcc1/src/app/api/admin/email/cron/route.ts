import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "@/lib/admin/admin-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

async function requireAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) return null;
  return user;
}

/** GET — return active/inactive status for all email cron jobs */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getAdminSupabase();
    const { data, error } = await supabase.rpc("get_email_cron_status");

    if (error) {
      return NextResponse.json(
        { error: "Failed to query cron jobs", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ jobs: data });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch cron status" },
      { status: 500 }
    );
  }
}

/** POST — toggle a cron job active/inactive */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { jobname, active } = await req.json();

    if (typeof active !== "boolean") {
      return NextResponse.json(
        { error: "active must be a boolean" },
        { status: 400 }
      );
    }

    const supabase = getAdminSupabase();
    const { data, error } = await supabase.rpc("toggle_email_cron", {
      p_jobname: jobname,
      p_active: active,
    });

    if (error) {
      return NextResponse.json(
        { error: "Failed to toggle cron job", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, jobname, active, data });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to toggle cron job" },
      { status: 500 }
    );
  }
}
