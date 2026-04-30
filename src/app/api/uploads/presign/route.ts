/**
 * OPS Web - Image Upload API Route
 *
 * Two flows:
 * 1. Presign (iOS): application/x-www-form-urlencoded with filename, contentType, folder
 *    → returns { uploadUrl, publicUrl } for client-side PUT
 * 2. Direct upload (Web): multipart/form-data with file
 *    → uploads immediately, returns { url, publicUrl }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];

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
//   2. Pair with an explicit content-type allowlist (see `TRAINING_DATA_TYPES`).
//   3. Per-object size is hard-capped at the bucket level: the `images`
//      Supabase Storage bucket has `file_size_limit = 10485760` (10 MB)
//      set in migration `014_create_storage_bucket.sql`. Any client PUT
//      that exceeds this gets rejected by Supabase Storage with a 413
//      regardless of what the presign endpoint returned. Cleanup-edit
//      entries run well under 5 MB in practice.
const TRAINING_DATA_PREFIXES = ["training_data/"] as const;
const TRAINING_DATA_TYPES = ["application/json"] as const;

function isTrainingDataPath(folder: string): boolean {
  return TRAINING_DATA_PREFIXES.some((prefix) => folder.startsWith(prefix));
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // Flow 1: Presign request (iOS client)
    if (contentType.includes("application/x-www-form-urlencoded")) {
      return handlePresign(req);
    }

    // Flow 2: Direct upload (Web client)
    return handleDirectUpload(req);
  } catch (err) {
    console.error("[uploads/presign] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * iOS presign flow: generate a signed upload URL for the client to PUT to directly
 */
async function handlePresign(req: NextRequest) {
  const body = await req.text();
  const params = new URLSearchParams(body);
  const filename = params.get("filename");
  const fileContentType = params.get("contentType");
  const folder = params.get("folder") || "uploads";

  if (!filename || !fileContentType) {
    return NextResponse.json(
      { error: "Missing filename or contentType" },
      { status: 400 }
    );
  }

  // Content-type validation:
  //   - Image types are allowed for any folder (the original behavior).
  //   - `application/json` is allowed ONLY when the upload targets a
  //     training-data folder (e.g. deck-scanner cleanup-edit logs). This
  //     prevents arbitrary JSON dumping into image folders while letting
  //     the iOS app accumulate ML training data.
  const isImage = (ALLOWED_TYPES as readonly string[]).includes(fileContentType);
  const isTrainingData =
    isTrainingDataPath(folder) &&
    (TRAINING_DATA_TYPES as readonly string[]).includes(fileContentType);

  if (!isImage && !isTrainingData) {
    return NextResponse.json(
      { error: `Invalid content type: ${fileContentType}` },
      { status: 400 }
    );
  }

  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  // Preserve the original filename's extension when present; fall back to
  // a sensible default per content-type so JSON uploads don't end up
  // labelled `.jpg`.
  const inferredExt = filename.includes(".")
    ? filename.split(".").pop()!
    : isTrainingData
      ? "json"
      : "jpg";
  const filePath = `${folder}/${timestamp}-${random}.${inferredExt}`;

  const supabase = getServiceRoleClient();

  const { data: signedData, error: signError } = await supabase.storage
    .from("images")
    .createSignedUploadUrl(filePath);

  if (signError || !signedData) {
    console.error("[uploads/presign] Signed URL creation failed:", signError?.message);
    return NextResponse.json(
      { error: signError?.message || "Failed to create signed URL" },
      { status: 500 }
    );
  }

  const { data: urlData } = supabase.storage
    .from("images")
    .getPublicUrl(filePath);

  return NextResponse.json({
    uploadUrl: signedData.signedUrl,
    publicUrl: urlData.publicUrl,
  });
}

/**
 * Web direct upload flow: receive file and upload to Supabase Storage immediately
 */
async function handleDirectUpload(req: NextRequest) {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const folder = (formData.get("folder") as string) || "uploads";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
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

  const ext = file.name.split(".").pop() || "jpg";
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const filePath = `${folder}/${timestamp}-${random}.${ext}`;

  const supabase = getServiceRoleClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("images")
    .upload(filePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[uploads/presign] Upload failed:", uploadError.message);
    return NextResponse.json(
      { error: uploadError.message },
      { status: 500 }
    );
  }

  const { data: urlData } = supabase.storage
    .from("images")
    .getPublicUrl(filePath);

  return NextResponse.json({ url: urlData.publicUrl, publicUrl: urlData.publicUrl });
}
