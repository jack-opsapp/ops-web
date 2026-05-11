/**
 * OPS Web — Image Upload API Route
 *
 * Three flows, distinguished by the request `Content-Type`:
 *   1. Presign (iOS):     application/x-www-form-urlencoded
 *      params: filename, contentType, folder
 *      → returns { uploadUrl, publicUrl } for client-side PUT to S3
 *   2. Presign (Web):     application/json
 *      body:   { filename, contentType, folder }
 *      → returns { uploadUrl, publicUrl } for client-side PUT to S3
 *   3. Direct upload:     multipart/form-data
 *      fields: file, folder?
 *      → uploads immediately, returns { url, publicUrl }
 *
 * Phase 1 storage migration (Supabase Storage → S3):
 *   - Default backend is `s3` (writes into `ops-app-files-prod`).
 *   - Setting STORAGE_BACKEND=supabase in env reverts to the legacy
 *     Supabase Storage code path (rollback without redeploying code).
 *   - PR #28's training_data/ JSON carve-out is preserved on both
 *     backends so iOS deck-scanner cleanup-edit log uploads keep
 *     working through the cutover.
 *
 * Security tightening shipped with this rewrite:
 *   - `Authorization: Bearer <token>` is now required (Supabase iOS or
 *     Firebase web). Anonymous calls are rejected.
 *   - The caller's `company_id` is looked up from the `users` table and
 *     enforced as a path segment in the resolved S3 key — see
 *     `src/lib/s3/path-auth.ts`. A folder that names a *different*
 *     company UUID is refused.
 *   - Filenames are sanitized to strip path-traversal segments and
 *     non-portable characters before they flow into the S3 key.
 *   - The presigned PUT URL pins `Content-Type` so a `.jpg` presign
 *     cannot be used to upload an `.html` payload.
 *   - Per-uid sliding-window rate limit (30 presigns / minute) backed
 *     by Vercel KV (Upstash Redis), with in-memory fallback in dev.
 */

import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  getS3Client,
  S3_BUCKET,
  buildPublicS3Url,
  getStorageBackend,
} from "@/lib/s3/client";
import {
  authorizeFolder,
  sanitizeFilename,
  inferExtension,
  buildUniqueSuffix,
} from "@/lib/s3/path-auth";
import { rateLimit } from "@/lib/utils/ratelimit";

// ─── Constants ──────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

// Folder prefixes allowed to upload non-image content via presign.
// Currently scoped to deck-scanner cleanup-edit JSON logs (see iOS
// `CleanupEditLogger.uploadPending()` — branch `claude/deck-scanner-rebuild`,
// commit 9dffeb7) which ship base64-embedded crops + cleanup metadata to
// `training_data/deck_scanner/{company_id}/{user_id}/{yyyy-mm-dd}/{entry_id}.json`
// for the upcoming deck-scanner ML model training set.
//
// Rules for additions to this list:
//   1. Must be an internal write path the iOS/web app fully controls — no
//      user-supplied folder values reach this carve-out.
//   2. Pair with an explicit content-type allowlist (`TRAINING_DATA_TYPES`).
//   3. Per-object size is hard-capped at the route level (10 MB) AND at
//      the bucket level (S3 IAM policy on the dedicated upload user).
const TRAINING_DATA_PREFIXES = ["training_data/"] as const;
const TRAINING_DATA_TYPES = ["application/json"] as const;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB — matches the legacy bucket cap.
const PRESIGN_EXPIRY_SECONDS = 7200; // 2 hours — matches Supabase upload-URL expiry.
const RATE_LIMIT_PER_MINUTE = 30;

function isTrainingDataPath(folder: string): boolean {
  return TRAINING_DATA_PREFIXES.some((prefix) => folder.startsWith(prefix));
}

function isAllowedContentType(contentType: string, folder: string): boolean {
  if ((ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
    return true;
  }
  if (
    isTrainingDataPath(folder) &&
    (TRAINING_DATA_TYPES as readonly string[]).includes(contentType)
  ) {
    return true;
  }
  return false;
}

function defaultExtensionFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/heic") return "heic";
  if (contentType === "application/json") return "json";
  return "jpg";
}

interface AuthContext {
  uid: string;
  companyId: string;
}

/**
 * Resolve the caller's auth token into a uid + their company_id. Both
 * branches of the auth bridge (Supabase JWT for iOS, Firebase JWT for
 * web) flow through `verifyAuthToken`, and the `users` table holds
 * either form of uid in `auth_id` or `firebase_uid`.
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

async function checkRateLimit(uid: string): Promise<NextResponse | null> {
  const result = await rateLimit({
    key: `presign:${uid}`,
    limit: RATE_LIMIT_PER_MINUTE,
    windowSec: 60,
  });
  if (result.exceeded) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": String(result.retryAfterSec) },
      }
    );
  }
  return null;
}

// ─── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      return await handlePresign(req, await readUrlencodedBody(req));
    }
    if (contentType.includes("application/json")) {
      return await handlePresign(req, await readJsonBody(req));
    }
    // multipart/form-data and anything else falls to the direct upload
    // path — the original behavior for `image-service.ts` callers.
    return await handleDirectUpload(req);
  } catch (err) {
    console.error("[uploads/presign] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── Body parsers ───────────────────────────────────────────────────────────

interface PresignBody {
  filename: string | null;
  contentType: string | null;
  folder: string | null;
}

async function readUrlencodedBody(req: NextRequest): Promise<PresignBody> {
  const text = await req.text();
  const params = new URLSearchParams(text);
  return {
    filename: params.get("filename"),
    contentType: params.get("contentType"),
    folder: params.get("folder"),
  };
}

async function readJsonBody(req: NextRequest): Promise<PresignBody> {
  const json = (await req.json()) as Record<string, unknown>;
  return {
    filename: typeof json.filename === "string" ? json.filename : null,
    contentType:
      typeof json.contentType === "string" ? json.contentType : null,
    folder: typeof json.folder === "string" ? json.folder : null,
  };
}

// ─── Presign flow (iOS + Web JSON) ──────────────────────────────────────────

async function handlePresign(
  req: NextRequest,
  body: PresignBody
): Promise<NextResponse> {
  const { filename, contentType: fileContentType, folder: rawFolder } = body;

  if (!filename || !fileContentType) {
    return NextResponse.json(
      { error: "Missing filename or contentType" },
      { status: 400 }
    );
  }

  const auth = await resolveAuth(req);
  if (auth instanceof NextResponse) return auth;

  const limited = await checkRateLimit(auth.uid);
  if (limited) return limited;

  const folderInput = rawFolder ?? "uploads";
  if (!isAllowedContentType(fileContentType, folderInput)) {
    return NextResponse.json(
      { error: `Invalid content type: ${fileContentType}` },
      { status: 400 }
    );
  }

  const folderResult = authorizeFolder(folderInput, auth.companyId);
  if (!folderResult.ok) {
    return NextResponse.json({ error: folderResult.reason }, { status: 403 });
  }

  const cleanFilename = sanitizeFilename(filename);
  const ext = inferExtension(cleanFilename, defaultExtensionFor(fileContentType));
  const key = `${folderResult.folder}/${buildUniqueSuffix()}.${ext}`;

  if (getStorageBackend() === "supabase") {
    return handlePresignSupabase(key, fileContentType);
  }
  return handlePresignS3(key, fileContentType);
}

async function handlePresignS3(
  key: string,
  fileContentType: string
): Promise<NextResponse> {
  // `ContentType` is included in the signed-headers set so the client
  // PUT must declare the same value — preventing a JPEG presign from
  // being reused to upload arbitrary HTML/JS.
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: fileContentType,
  });

  const uploadUrl = await getSignedUrl(getS3Client(), command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
    signableHeaders: new Set(["content-type"]),
  });

  return NextResponse.json({
    uploadUrl,
    publicUrl: buildPublicS3Url(key),
  });
}

async function handlePresignSupabase(
  key: string,
  _fileContentType: string
): Promise<NextResponse> {
  // Legacy code path retained for STORAGE_BACKEND=supabase rollback.
  // Removed in Phase 3.
  const supabase = getServiceRoleClient();

  const { data: signedData, error: signError } = await supabase.storage
    .from("images")
    .createSignedUploadUrl(key);

  if (signError || !signedData) {
    console.error(
      "[uploads/presign] Supabase signed URL failed:",
      signError?.message
    );
    return NextResponse.json(
      { error: signError?.message || "Failed to create signed URL" },
      { status: 500 }
    );
  }

  const { data: urlData } = supabase.storage.from("images").getPublicUrl(key);

  return NextResponse.json({
    uploadUrl: signedData.signedUrl,
    publicUrl: urlData.publicUrl,
  });
}

// ─── Direct upload flow (web `uploadImage()`) ───────────────────────────────

async function handleDirectUpload(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveAuth(req);
  if (auth instanceof NextResponse) return auth;

  const limited = await checkRateLimit(auth.uid);
  if (limited) return limited;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const rawFolder = (formData.get("folder") as string | null) ?? "uploads";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!isAllowedContentType(file.type, rawFolder)) {
    return NextResponse.json(
      { error: `Invalid file type: ${file.type}` },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large (max 10MB)" },
      { status: 400 }
    );
  }

  const folderResult = authorizeFolder(rawFolder, auth.companyId);
  if (!folderResult.ok) {
    return NextResponse.json({ error: folderResult.reason }, { status: 403 });
  }

  const cleanFilename = sanitizeFilename(file.name);
  const ext = inferExtension(cleanFilename, defaultExtensionFor(file.type));
  const key = `${folderResult.folder}/${buildUniqueSuffix()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  if (getStorageBackend() === "supabase") {
    return handleDirectUploadSupabase(key, buffer, file.type);
  }
  return handleDirectUploadS3(key, buffer, file.type);
}

async function handleDirectUploadS3(
  key: string,
  buffer: Buffer,
  fileContentType: string
): Promise<NextResponse> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: fileContentType,
    })
  );

  const url = buildPublicS3Url(key);
  return NextResponse.json({ url, publicUrl: url });
}

async function handleDirectUploadSupabase(
  key: string,
  buffer: Buffer,
  fileContentType: string
): Promise<NextResponse> {
  const supabase = getServiceRoleClient();

  const { error: uploadError } = await supabase.storage
    .from("images")
    .upload(key, buffer, {
      contentType: fileContentType,
      upsert: false,
    });

  if (uploadError) {
    console.error(
      "[uploads/presign] Supabase upload failed:",
      uploadError.message
    );
    return NextResponse.json(
      { error: uploadError.message },
      { status: 500 }
    );
  }

  const { data: urlData } = supabase.storage.from("images").getPublicUrl(key);

  return NextResponse.json({
    url: urlData.publicUrl,
    publicUrl: urlData.publicUrl,
  });
}
