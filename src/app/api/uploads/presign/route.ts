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

  if (!ALLOWED_TYPES.includes(fileContentType)) {
    return NextResponse.json(
      { error: `Invalid content type: ${fileContentType}` },
      { status: 400 }
    );
  }

  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const ext = filename.split(".").pop() || "jpg";
  const filePath = `${folder}/${timestamp}-${random}.${ext}`;

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
