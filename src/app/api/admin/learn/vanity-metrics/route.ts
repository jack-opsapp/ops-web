import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { updateLearnVanityMetrics } from "@/lib/admin/admin-queries";

const ADMIN_EMAILS = ["jack@opsapp.co", "canprojack@gmail.com"];

export async function POST(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !ADMIN_EMAILS.includes(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { courseId, metrics } = body;

  if (!courseId || !metrics) {
    return NextResponse.json({ error: "Missing courseId or metrics" }, { status: 400 });
  }

  const result = await updateLearnVanityMetrics(courseId, metrics);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
