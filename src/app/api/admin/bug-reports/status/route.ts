import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail, updateBugReportStatus, updateBugReportPriority } from "@/lib/admin/admin-queries";

export async function POST(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, status, priority } = body;

  if (!id || (!status && !priority)) {
    return NextResponse.json({ error: "Missing id and status/priority" }, { status: 400 });
  }

  try {
    if (status) await updateBugReportStatus(id, status);
    if (priority) await updateBugReportPriority(id, priority);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
