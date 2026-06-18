/**
 * POST /api/uploads/delete
 *
 * Deletes a single object the caller owns from OPS storage. This replaces
 * the iOS app's legacy *direct* S3 delete (which shipped long-lived AWS
 * credentials inside the binary). The app now sends the stored object URL
 * here and the server performs the delete with its own credentials, so the
 * client holds no AWS keys.
 *
 * Request (mirrors the presign route's two iOS/web body shapes):
 *   - application/x-www-form-urlencoded: `url=<publicUrl>`  (iOS)
 *   - application/json:                  `{ "url": "<publicUrl>" }` (web)
 *   A bare object key may be sent instead of a URL via the same field.
 *
 * Security (mirrors `/api/uploads/presign`):
 *   - `Authorization: Bearer <token>` required (Supabase iOS or Firebase web).
 *   - The object key is resolved from the URL and must be scoped to the
 *     caller's company — either the presign layout (`{companyId}` as a path
 *     segment, e.g. `profiles/{companyId}/…`) or the legacy direct-S3 layout
 *     (`company-{companyId}/…`). Anything else is refused (cross-tenant
 *     delete guard). Only the OPS S3 bucket and the Supabase `images` bucket
 *     are accepted as URL sources — arbitrary URLs are rejected.
 *   - Per-uid sliding-window rate limit (30 deletes / minute).
 *
 * Backend is chosen by the URL itself (an S3 URL → S3 delete, a Supabase
 * Storage URL → Supabase delete) so that objects created under either
 * storage backend — including legacy pre-migration images — are cleaned up
 * correctly regardless of the current STORAGE_BACKEND setting.
 *
 * NOTE (IAM): the dedicated upload IAM user backing `getS3Client()` must be
 * granted `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*` for the S3 path to
 * succeed. Callers treat delete as best-effort, so a missing permission
 * degrades to "old object orphaned" rather than a user-facing failure.
 */

import { NextRequest, NextResponse } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getS3Client, S3_BUCKET, S3_REGION } from "@/lib/s3/client";
import { rateLimit } from "@/lib/utils/ratelimit";

const RATE_LIMIT_PER_MINUTE = 30;

interface AuthContext {
  uid: string;
  companyId: string;
}

/**
 * Resolve the caller's auth token into a uid + their company_id. Identical
 * to the presign route's bridge (Supabase JWT for iOS, Firebase JWT for web).
 */
async function resolveAuth(req: NextRequest): Promise<AuthContext | NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json(
      { error: "Missing Authorization bearer token" },
      { status: 401 }
    );
  }

  let uid: string;
  try {
    const verified = await verifyAuthToken(idToken);
    uid = verified.uid;
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("id, company_id")
    .or(`auth_id.eq.${uid},firebase_uid.eq.${uid}`)
    .maybeSingle();

  if (userErr || !userRow || !userRow.company_id) {
    return NextResponse.json(
      { error: "User has no company association" },
      { status: 403 }
    );
  }

  return { uid, companyId: userRow.company_id as string };
}

type DeleteTarget = { kind: "s3"; key: string } | { kind: "supabase"; key: string };

/**
 * Resolve the request value into a concrete delete target. Only the OPS S3
 * bucket (virtual-hosted or path style) and the Supabase `images` bucket are
 * accepted; everything else returns null so an authenticated caller cannot
 * use this route to delete arbitrary objects. A bare key (no scheme) is
 * treated as an S3 key (the default/forward backend).
 */
function resolveTarget(input: string): DeleteTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (!/^https?:\/\//i.test(trimmed)) {
    return { kind: "s3", key: trimmed.replace(/^\/+/, "") };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");

  // S3 virtual-hosted-style: {bucket}.s3[.region].amazonaws.com/{key}
  if (
    host === `${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com` ||
    host === `${S3_BUCKET}.s3.amazonaws.com`
  ) {
    return path ? { kind: "s3", key: path } : null;
  }

  // S3 path-style: s3[.region].amazonaws.com/{bucket}/{key}
  if (host === `s3.${S3_REGION}.amazonaws.com` || host === "s3.amazonaws.com") {
    const segs = path.split("/");
    if (segs.shift() === S3_BUCKET && segs.length > 0) {
      return { kind: "s3", key: segs.join("/") };
    }
    return null;
  }

  // Supabase Storage public/signed URL for the `images` bucket:
  //   https://<ref>.supabase.co/storage/v1/object/(public|sign)/images/{key}
  if (host.endsWith(".supabase.co")) {
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign)\/images\/(.+)$/
    );
    if (match) {
      return { kind: "supabase", key: decodeURIComponent(match[1]) };
    }
  }

  return null;
}

/**
 * A key is owned by the caller's company when the companyId appears either as
 * a path segment (presign layout: `profiles/{companyId}/…`) or as the legacy
 * `company-{companyId}` prefix (old direct-S3 layout).
 */
function isCompanyScoped(key: string, companyId: string): boolean {
  const cid = companyId.toLowerCase();
  const segments = key.toLowerCase().split("/");
  return segments.includes(cid) || segments[0] === `company-${cid}`;
}

async function readUrl(req: NextRequest): Promise<string | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await req.json()) as Record<string, unknown>;
    if (typeof json.url === "string") return json.url;
    if (typeof json.key === "string") return json.key;
    return null;
  }
  const text = await req.text();
  const params = new URLSearchParams(text);
  return params.get("url") ?? params.get("key");
}

export async function POST(req: NextRequest) {
  try {
    const rawUrl = await readUrl(req);
    if (!rawUrl) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const auth = await resolveAuth(req);
    if (auth instanceof NextResponse) return auth;

    const limit = await rateLimit({
      key: `delete:${auth.uid}`,
      limit: RATE_LIMIT_PER_MINUTE,
      windowSec: 60,
    });
    if (limit.exceeded) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      );
    }

    const target = resolveTarget(rawUrl);
    if (!target) {
      return NextResponse.json(
        { error: "Unrecognized object URL" },
        { status: 400 }
      );
    }
    if (target.key.includes("..") || target.key.length === 0) {
      return NextResponse.json({ error: "Invalid object key" }, { status: 400 });
    }
    if (!isCompanyScoped(target.key, auth.companyId)) {
      return NextResponse.json(
        { error: "Object is not owned by your company" },
        { status: 403 }
      );
    }

    if (target.kind === "supabase") {
      const supabase = getServiceRoleClient();
      const { error } = await supabase.storage.from("images").remove([target.key]);
      if (error) {
        console.error("[uploads/delete] Supabase remove failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: target.key })
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[uploads/delete] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
