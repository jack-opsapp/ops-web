/**
 * OPS Web - S3 Presigned URL Generator
 *
 * Generates presigned PUT URLs for direct-to-S3 image uploads.
 * Direct S3 presigned URL generation for image uploads.
 *
 * POST /api/uploads/presign
 * Body: { filename: string, contentType: string, folder?: string }
 * Returns: { uploadUrl: string, publicUrl: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.AWS_S3_BUCKET || "";
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || "";
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || "";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];

const MAX_FILENAME_LENGTH = 200;

function getS3Client(): S3Client {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    },
  });
}

/**
 * Sanitize a filename: remove path traversal, spaces, special chars.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, MAX_FILENAME_LENGTH);
}

export async function POST(req: NextRequest) {
  // Validate env vars
  if (!BUCKET || !ACCESS_KEY || !SECRET_KEY) {
    return NextResponse.json(
      { error: "S3 not configured. Set AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY." },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { filename, contentType, folder } = body as {
      filename?: string;
      contentType?: string;
      folder?: string;
    };

    // Validate required fields
    if (!filename || !contentType) {
      return NextResponse.json(
        { error: "Missing required fields: filename, contentType" },
        { status: 400 }
      );
    }

    // Validate content type
    if (!ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: `Invalid content type: ${contentType}. Allowed: ${ALLOWED_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // Build the S3 key: folder/timestamp-randomId-filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).slice(2, 10);
    const safeName = sanitizeFilename(filename);
    const prefix = folder ? `${folder}/` : "uploads/";
    const key = `${prefix}${timestamp}-${randomId}-${safeName}`;

    // Generate presigned URL
    const client = getS3Client();
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: 300, // 5 minutes
    });

    // Public URL (assumes bucket has public read or CloudFront)
    const publicUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

    return NextResponse.json({ uploadUrl, publicUrl });
  } catch (error) {
    console.error("[presign] Error generating presigned URL:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate upload URL" },
      { status: 500 }
    );
  }
}
