/**
 * POST /api/bug-reports/screenshot
 *
 * Uploads a bug report screenshot on the user's behalf. Client code
 * cannot write to storage directly because the ops-web Supabase client
 * authenticates via a Firebase JWT, and the legacy storage RLS policy
 * on the `bug-reports` Supabase bucket required the Postgres
 * `authenticated` role — which the Firebase bridge does not produce.
 *
 * Phase 1 storage migration:
 *   - Default backend is `s3`. Screenshots land in
 *     `ops-app-files-prod` under
 *     `bug-reports/{companyId}/{reportId}/screenshot.{ext}`.
 *   - The stored `bug_reports.screenshot_url` value uses an `s3:` URI
 *     scheme prefix (e.g. `s3:bug-reports/<co>/<rid>/screenshot.jpg`)
 *     so the read-side resolver in `BugReportService.getScreenshotUrl`
 *     can tell new S3-backed paths apart from legacy Supabase paths
 *     during the cutover. Legacy values keep their bucket-relative
 *     form (no `s3:` prefix) until Phase 2 backfills them.
 *   - STORAGE_BACKEND=supabase reverts to the legacy private-bucket
 *     write path (no scheme prefix; resolver falls through to Supabase
 *     signing).
 *
 * Security: verifies the caller's auth token (Supabase or Firebase),
 * checks the user actually belongs to the company in the request, and
 * checks the bug report row was created by the same caller.
 */

import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  getS3Client,
  S3_BUCKET,
  getStorageBackend,
} from "@/lib/s3/client";

const MAX_SIZE = 8 * 1024 * 1024; // 8MB
const ALLOWED_TYPES = ["image/png", "image/jpeg"] as const;

/**
 * URI-scheme prefix written into `bug_reports.screenshot_url` for
 * objects that live in S3. The reader (`BugReportService.
 * getScreenshotUrl`) uses this to decide whether to S3-presign or
 * Supabase-presign the path. Phase 2 backfill will rewrite legacy
 * (no-prefix) values to the `s3:` form.
 */
const S3_SCHEME = "s3:";

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

    let storedValue: string;

    if (getStorageBackend() === "s3") {
      // Bug-report screenshots are private. We don't need a bucket-level
      // public-read policy; the read side calls `getSignedUrl` to issue a
      // short-lived GET URL on demand.
      const key = `bug-reports/${path}`;
      try {
        await getS3Client().send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: file.type,
          })
        );
      } catch (err) {
        console.error(
          "[bug-reports/screenshot] S3 upload failed:",
          err instanceof Error ? err.message : err
        );
        return NextResponse.json(
          { error: "Screenshot upload failed" },
          { status: 500 }
        );
      }
      storedValue = `${S3_SCHEME}${key}`;
    } else {
      // Legacy Supabase path retained for STORAGE_BACKEND=supabase rollback.
      const { error: uploadErr } = await supabase.storage
        .from("bug-reports")
        .upload(path, buffer, { contentType: file.type, upsert: true });

      if (uploadErr) {
        console.error("[bug-reports/screenshot] Supabase upload failed:", uploadErr.message);
        return NextResponse.json({ error: uploadErr.message }, { status: 500 });
      }
      storedValue = path;
    }

    // Persist the storage reference on the row so the admin view can
    // resolve it later via `BugReportService.getScreenshotUrl`.
    const { error: updateErr } = await supabase
      .from("bug_reports")
      .update({ screenshot_url: storedValue, updated_at: new Date().toISOString() })
      .eq("id", reportId);

    if (updateErr) {
      console.error("[bug-reports/screenshot] Failed to persist path:", updateErr.message);
    }

    return NextResponse.json({ success: true, path: storedValue });
  } catch (err) {
    console.error("[api/bug-reports/screenshot] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
