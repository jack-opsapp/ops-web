/**
 * POST /api/admin/blog/upload
 *
 * Upload a blog image to OPS storage. Default backend is S3
 * (`ops-app-files-prod/blog/`). STORAGE_BACKEND=supabase routes the
 * write to the legacy Supabase Storage `images/blog/` prefix instead
 * — kept as a one-redeploy rollback for the Phase 1 cutover.
 *
 * Admin-only. Returns { url: string } with the public URL.
 */
import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  getS3Client,
  S3_BUCKET,
  buildPublicS3Url,
  getStorageBackend,
} from "@/lib/s3/client";
import {
  sanitizeFilename,
  inferExtension,
  buildUniqueSuffix,
} from "@/lib/s3/path-auth";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Invalid file type: ${file.type}. Allowed: JPEG, PNG, WebP` },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large (max 10MB)" },
      { status: 400 }
    );
  }

  const cleanFilename = sanitizeFilename(file.name);
  const ext = inferExtension(cleanFilename, "jpg");
  const key = `blog/${buildUniqueSuffix()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (getStorageBackend() === "s3") {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      })
    );
    return NextResponse.json({ url: buildPublicS3Url(key) });
  }

  // Legacy Supabase path retained for STORAGE_BACKEND=supabase rollback.
  const supabase = getServiceRoleClient();
  const { error: uploadError } = await supabase.storage
    .from("images")
    .upload(key, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[blog/upload] Supabase upload failed:", uploadError.message);
    return NextResponse.json(
      { error: uploadError.message },
      { status: 500 }
    );
  }

  const { data: urlData } = supabase.storage.from("images").getPublicUrl(key);
  return NextResponse.json({ url: urlData.publicUrl });
});
