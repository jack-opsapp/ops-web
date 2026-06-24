/**
 * OPS Web — Share-Extension Photo Upload (server-side store + file)
 *
 * One authenticated request that does EVERYTHING the iOS "Add to OPS" share
 * extension needs, so the phone app never has to wake up to finish a share:
 *
 *   POST /api/uploads/share-photo?projectId=…&jobId=…&takenAt=…
 *     headers: Authorization: Bearer <token>, Content-Type: image/jpeg
 *     body:    the raw image bytes
 *     → stores the image to S3, appends it to projects.project_images,
 *       inserts a project_photos row, posts a completion notification,
 *       and returns { success, url }.
 *
 * The raw-body + query-param shape (vs multipart) is what an iOS BACKGROUND
 * URLSession can upload directly from a file — so the extension can fire the
 * whole photo at this endpoint and iOS finishes the transfer even if OPS never
 * opens. The app's own queue-drain also POSTs here as a backstop. Both paths
 * authenticate (extension: a short-lived bridged token; app: a fresh Firebase
 * token) and pass the SAME `jobId`.
 *
 * Idempotent by design: the S3 key is deterministic from `jobId`
 * (`projects/{companyId}/{projectId}/share-{jobId}.jpg`), so a retried/duplicate
 * POST overwrites the same object and yields the same URL; project_images and
 * project_photos both dedup by URL. The extension's background POST and the app's
 * drain therefore can't produce a duplicate.
 *
 * Security: requires a valid bearer token (Supabase iOS / Firebase web), verifies
 * the target project belongs to the caller's company, and re-checks
 * `projects.edit` server-side — the client gate is never trusted.
 */

import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  getS3Client,
  S3_BUCKET,
  buildPublicS3Url,
  getStorageBackend,
} from "@/lib/s3/client";
import { authorizeFolder } from "@/lib/s3/path-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { rateLimit } from "@/lib/utils/ratelimit";

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB — share photos are downscaled client-side.
const RATE_LIMIT_PER_MINUTE = 120; // a single share can be a burst of photos.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Suppress duplicate completion notifications within this window (one share of
// many photos = many POSTs; the operator wants one "photos added", not twenty).
const NOTIFY_DEDUP_WINDOW_MS = 15 * 60 * 1000;

interface AuthContext {
  uid: string;
  userId: string;
  companyId: string;
}

/** Verify the bearer token and resolve the caller's users.id + company_id. */
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

  return {
    uid,
    userId: userRow.id as string,
    companyId: userRow.company_id as string,
  };
}

/** Writes the image bytes to the active storage backend; returns the public URL. */
async function storePhotoBytes(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  if (getStorageBackend() === "supabase") {
    const supabase = getServiceRoleClient();
    const { error } = await supabase.storage
      .from("images")
      .upload(key, buffer, { contentType, upsert: true });
    if (error) throw new Error(`Supabase storage upload failed: ${error.message}`);
    return supabase.storage.from("images").getPublicUrl(key).data.publicUrl;
  }

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return buildPublicS3Url(key);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await resolveAuth(req);
    if (auth instanceof NextResponse) return auth;

    const limited = await rateLimit({
      key: `share-photo:${auth.uid}`,
      limit: RATE_LIMIT_PER_MINUTE,
      windowSec: 60,
    });
    if (limited.exceeded) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
      );
    }

    // ── Parse + validate (raw body + query params) ────────────────────────────
    const params = req.nextUrl.searchParams;
    const projectId = (params.get("projectId") ?? "").trim();
    const jobId = (params.get("jobId") ?? "").trim();
    const takenAtRaw = params.get("takenAt");
    const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim();

    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
      return NextResponse.json(
        { error: `Invalid content type: ${contentType || "(none)"}` },
        { status: 400 }
      );
    }
    if (!UUID_RE.test(projectId)) {
      return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
    }
    // jobId is the stable idempotency key. Constrain to safe key characters.
    const safeJobId = jobId.replace(/[^A-Za-z0-9-]/g, "");
    if (safeJobId.length === 0) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const buffer = Buffer.from(await req.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }
    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 400 });
    }

    const supabase = getServiceRoleClient();

    // ── Authorize: project belongs to caller's company ────────────────────────
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, company_id, title, project_images")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.company_id !== auth.companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Authorize: caller may edit projects (same gate the picker used) ────────
    const canEdit = await checkPermissionById(auth.userId, "projects.edit");
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Store bytes (deterministic, idempotent key) ───────────────────────────
    const folderResult = authorizeFolder(
      `projects/${auth.companyId}/${projectId}`,
      auth.companyId
    );
    if (!folderResult.ok) {
      return NextResponse.json({ error: folderResult.reason }, { status: 403 });
    }
    const key = `${folderResult.folder}/share-${safeJobId}.jpg`;
    const url = await storePhotoBytes(key, buffer, contentType);

    // ── File it: project_images (text[]) + project_photos, both deduped ───────
    const currentImages: string[] = Array.isArray(project.project_images)
      ? (project.project_images as string[])
      : [];
    if (!currentImages.includes(url)) {
      const { error: updErr } = await supabase
        .from("projects")
        .update({ project_images: [...currentImages, url] })
        .eq("id", projectId);
      if (updErr) {
        console.error("[uploads/share-photo] project_images update failed:", updErr.message);
        return NextResponse.json({ error: "Failed to attach photo" }, { status: 500 });
      }
    }

    const { data: existingPhoto } = await supabase
      .from("project_photos")
      .select("id")
      .eq("project_id", projectId)
      .eq("url", url)
      .maybeSingle();

    if (!existingPhoto) {
      const takenAt =
        takenAtRaw && !Number.isNaN(Date.parse(takenAtRaw))
          ? new Date(takenAtRaw).toISOString()
          : new Date().toISOString();
      const { error: insErr } = await supabase.from("project_photos").insert({
        project_id: projectId,
        company_id: auth.companyId,
        url,
        source: "in_progress",
        uploaded_by: auth.userId,
        is_client_visible: false,
        taken_at: takenAt,
      });
      if (insErr) {
        console.error("[uploads/share-photo] project_photos insert failed:", insErr.message);
        return NextResponse.json({ error: "Failed to record photo" }, { status: 500 });
      }
    }

    // ── Completion notification (deduped per project per 15-min burst) ─────────
    await maybeNotify(auth.userId, auth.companyId, projectId, project.title as string);

    return NextResponse.json({ success: true, url });
  } catch (err) {
    console.error("[uploads/share-photo] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}

/**
 * Posts one "photos added" notification to the uploader per project per burst.
 * A single share of N photos is N POSTs; without this the operator would get N
 * notifications. Best-effort — a failure never fails the upload.
 */
async function maybeNotify(
  userId: string,
  companyId: string,
  projectId: string,
  projectTitle: string
): Promise<void> {
  try {
    const supabase = getServiceRoleClient();
    const since = new Date(Date.now() - NOTIFY_DEDUP_WINDOW_MS).toISOString();
    const { data: recent } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .eq("type", "photo_uploaded")
      .eq("is_read", false)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();

    if (recent) return; // already told them recently

    await supabase.from("notifications").insert({
      user_id: userId,
      company_id: companyId,
      type: "photo_uploaded",
      title: "Photos added",
      body: `New photos on ${projectTitle}`,
      project_id: projectId,
      deep_link_type: "projectNotes",
      action_url: `/dashboard?openProject=${projectId}&mode=view`,
      action_label: "View",
    });
  } catch (err) {
    console.error("[uploads/share-photo] notification failed:", err);
  }
}
