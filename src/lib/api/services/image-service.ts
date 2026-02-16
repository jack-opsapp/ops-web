/**
 * OPS Web - Image Upload Service
 *
 * Handles image uploads to S3 via Bubble.io presigned URLs.
 * Includes client-side validation, compression, and multi-image support.
 */

import { getBubbleClient } from "../bubble-client";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const COMPRESS_THRESHOLD = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

// ─── Types ───────────────────────────────────────────────────────────────────

interface PresignedUrlResponse {
  response?: { url: string };
  url?: string;
}

export type ImageUploadErrorCode =
  | "INVALID_TYPE"
  | "TOO_LARGE"
  | "UPLOAD_FAILED"
  | "COMPRESS_FAILED";

// ─── Error Class ─────────────────────────────────────────────────────────────

export class ImageUploadError extends Error {
  constructor(
    message: string,
    public code: ImageUploadErrorCode
  ) {
    super(message);
    this.name = "ImageUploadError";
  }
}

// ─── Image Compression ──────────────────────────────────────────────────────

async function compressImage(file: File, maxWidth = 1920): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      ctx?.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to compress image"));
        },
        "image/jpeg",
        0.85
      );
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

// ─── Single Image Upload ────────────────────────────────────────────────────

export async function uploadImage(file: File): Promise<string> {
  // Validate type
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new ImageUploadError(
      `Invalid file type: ${file.type}. Allowed: ${ALLOWED_TYPES.join(", ")}`,
      "INVALID_TYPE"
    );
  }

  // Validate size
  if (file.size > MAX_FILE_SIZE) {
    throw new ImageUploadError(
      `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 10MB`,
      "TOO_LARGE"
    );
  }

  // Compress if needed (skip HEIC since canvas can't decode it)
  let uploadBlob: Blob = file;
  let contentType = file.type;
  if (file.size > COMPRESS_THRESHOLD && file.type !== "image/heic") {
    try {
      uploadBlob = await compressImage(file);
      contentType = "image/jpeg";
    } catch {
      // If compression fails, upload original
      console.warn("[ImageService] Compression failed, uploading original");
    }
  }

  try {
    // Get presigned URL from Bubble
    const client = getBubbleClient();
    const data = await client.post<PresignedUrlResponse>(
      "/wf/get_upload_url",
      {
        filename: file.name,
        content_type: contentType,
      }
    );

    const presignedUrl = data.response?.url || data.url;
    if (!presignedUrl) {
      throw new ImageUploadError("Failed to get upload URL", "UPLOAD_FAILED");
    }

    // Upload directly to S3 (bypass bubbleClient -- this is a raw S3 PUT)
    await fetch(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: uploadBlob,
    });

    // Return the S3 URL (presigned URL without query params)
    const s3Url = presignedUrl.split("?")[0];
    return s3Url;
  } catch (error) {
    if (error instanceof ImageUploadError) throw error;
    throw new ImageUploadError(
      `Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "UPLOAD_FAILED"
    );
  }
}

// ─── Multiple Image Upload ──────────────────────────────────────────────────

export async function uploadMultipleImages(
  files: File[]
): Promise<string[]> {
  const results = await Promise.allSettled(files.map(uploadImage));
  const urls: string[] = [];
  const errors: string[] = [];

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      urls.push(result.value);
    } else {
      errors.push(`${files[i].name}: ${result.reason.message}`);
    }
  });

  if (errors.length > 0 && urls.length === 0) {
    throw new ImageUploadError(
      `All uploads failed: ${errors.join("; ")}`,
      "UPLOAD_FAILED"
    );
  }

  return urls;
}
