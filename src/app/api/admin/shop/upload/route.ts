/**
 * POST /api/admin/shop/upload
 *
 * Upload a product image to S3 (ops-app-files-prod/shop/ prefix).
 * Admin-only. Returns { url: string } with the public S3 URL.
 */
import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";

const BUCKET = "ops-app-files-prod";
const REGION = "us-west-2";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function getS3(): S3Client {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  });
}

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
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() || "jpg";
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const key = `shop/${timestamp}-${random}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  await getS3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    })
  );

  const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

  return NextResponse.json({ url });
});
