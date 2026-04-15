/**
 * POST /api/bug-reports/screenshot
 *
 * Uploads a bug report screenshot to the private `bug-reports` bucket on the
 * user's behalf. Client code cannot write to storage directly because the
 * ops-web Supabase client authenticates via a Firebase JWT, and the storage
 * RLS policy on `bug-reports` requires the Postgres `authenticated` role,
 * which the Firebase bridge does not produce for storage requests.
 *
 * Security: verifies the caller's Firebase ID token and only allows writes
 * into the caller's own company prefix, so one company cannot clobber
 * another's screenshots.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const MAX_SIZE = 8 * 1024 * 1024; // 8MB
const ALLOWED_TYPES = ["image/png", "image/jpeg"] as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const idToken = authHeader.replace(/^Bearer\s+/i, "");

    if (!idToken) {
      return NextResponse.json({ error: "Missing Authorization bearer token" }, { status: 401 });
    }

    // Verify the caller.
    let uid: string;
    try {
      const verified = await verifyAuthToken(idToken);
      uid = verified.uid;
    } catch {
      return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const reportId = formData.get("reportId") as string | null;
    const companyId = formData.get("companyId") as string | null;

    if (!file || !reportId || !companyId) {
      return NextResponse.json(
        { error: "Missing file, reportId, or companyId" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
      return NextResponse.json({ error: `Invalid file type: ${file.type}` }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Screenshot too large (max 8MB)" }, { status: 400 });
    }

    // Validate the caller actually belongs to this company and the report
    // row was just created by them. This stops someone from using their own
    // token to write into a different company's storage prefix.
    const supabase = getServiceRoleClient();
    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("id, company_id")
      .or(`auth_id.eq.${uid},firebase_uid.eq.${uid}`)
      .maybeSingle();

    if (userErr || !userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (userRow.company_id !== companyId) {
      return NextResponse.json({ error: "Company mismatch" }, { status: 403 });
    }

    const { data: reportRow, error: reportErr } = await supabase
      .from("bug_reports")
      .select("id, company_id, reporter_id")
      .eq("id", reportId)
      .maybeSingle();

    if (reportErr || !reportRow) {
      return NextResponse.json({ error: "Bug report not found" }, { status: 404 });
    }
    if (reportRow.company_id !== companyId || reportRow.reporter_id !== userRow.id) {
      return NextResponse.json({ error: "Not the reporter" }, { status: 403 });
    }

    const ext = file.type === "image/jpeg" ? "jpg" : "png";
    const path = `${companyId}/${reportId}/screenshot.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await supabase.storage
      .from("bug-reports")
      .upload(path, buffer, { contentType: file.type, upsert: true });

    if (uploadErr) {
      console.error("[bug-reports/screenshot] Upload failed:", uploadErr.message);
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    // Persist the path on the row so the admin view can resolve it later.
    const { error: updateErr } = await supabase
      .from("bug_reports")
      .update({ screenshot_url: path, updated_at: new Date().toISOString() })
      .eq("id", reportId);

    if (updateErr) {
      console.error("[bug-reports/screenshot] Failed to persist path:", updateErr.message);
    }

    return NextResponse.json({ success: true, path });
  } catch (err) {
    console.error("[api/bug-reports/screenshot] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
