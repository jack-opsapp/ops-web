/**
 * OPS Web - Image Upload via Supabase Storage
 *
 * Accepts a file via FormData, uploads to Supabase Storage bucket,
 * returns the public URL.
 *
 * POST /api/uploads/presign
 * Body: FormData with "file" and optional "folder"
 * Returns: { uploadUrl: string, publicUrl: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
];
const MAX_FILENAME_LENGTH = 200;

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, MAX_FILENAME_LENGTH);
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // Support both FormData (new) and JSON (legacy presign)
    if (contentType.includes("multipart/form-data")) {
      return handleFormDataUpload(req);
    } else {
      return handlePresignUpload(req);
    }
  } catch (error) {
    console.error("[uploads] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}

/**
 * New path: accept file via FormData, upload to Supabase Storage
 */
async function handleFormDataUpload(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const folder = (formData.get("folder") as string) || "uploads";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Invalid file type: ${file.type}. Allowed: ${ALLOWED_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large (max 10MB)" },
      { status: 400 }
    );
  }

  const timestamp = Date.now();
  const randomId = Math.random().toString(36).slice(2, 10);
  const safeName = sanitizeFilename(file.name);
  const path = `${folder}/${timestamp}-${randomId}-${safeName}`;

  const supabase = getServiceRoleClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage
    .from("images")
    .upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    console.error("[uploads] Supabase storage error:", error);
    return NextResponse.json(
      { error: `Upload failed: ${error.message}` },
      { status: 500 }
    );
  }

  const { data: urlData } = supabase.storage
    .from("images")
    .getPublicUrl(path);

  // Return both formats for compatibility
  return NextResponse.json({
    url: urlData.publicUrl,
    uploadUrl: "", // Not needed for direct upload
    publicUrl: urlData.publicUrl,
  });
}

/**
 * Legacy path: JSON body with filename/contentType — now uses Supabase signed upload URLs
 */
async function handlePresignUpload(req: NextRequest) {
  const body = await req.json();
  const { filename, contentType, folder } = body as {
    filename?: string;
    contentType?: string;
    folder?: string;
  };

  if (!filename || !contentType) {
    return NextResponse.json(
      { error: "Missing required fields: filename, contentType" },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json(
      { error: `Invalid content type: ${contentType}` },
      { status: 400 }
    );
  }

  const timestamp = Date.now();
  const randomId = Math.random().toString(36).slice(2, 10);
  const safeName = sanitizeFilename(filename);
  const prefix = folder ? `${folder}/` : "uploads/";
  const path = `${prefix}${timestamp}-${randomId}-${safeName}`;

  const supabase = getServiceRoleClient();

  const { data, error } = await supabase.storage
    .from("images")
    .createSignedUploadUrl(path);

  if (error) {
    console.error("[uploads] Signed URL error:", error);
    return NextResponse.json(
      { error: `Failed to create upload URL: ${error.message}` },
      { status: 500 }
    );
  }

  const { data: urlData } = supabase.storage
    .from("images")
    .getPublicUrl(path);

  return NextResponse.json({
    uploadUrl: data.signedUrl,
    publicUrl: urlData.publicUrl,
  });
}
