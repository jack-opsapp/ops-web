/**
 * OPS Web - Image Upload Service
 *
 * Handles image uploads to Supabase Storage via /api/uploads/presign.
 * Includes client-side validation, compression, and multi-image support.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const COMPRESS_THRESHOLD = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

// ─── Types ───────────────────────────────────────────────────────────────────

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

export async function uploadImage(
  file: File,
  folder?: string
): Promise<string> {
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
    // Upload file directly to our API (Supabase Storage backend)
    const formData = new FormData();
    formData.append(
      "file",
      new File([uploadBlob], file.name, { type: contentType })
    );
    if (folder) formData.append("folder", folder);

    const response = await fetch("/api/uploads/presign", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new ImageUploadError(
        (err as Record<string, string>).error || "Upload failed",
        "UPLOAD_FAILED"
      );
    }

    const { url, publicUrl } = (await response.json()) as {
      url?: string;
      publicUrl?: string;
    };

    return url || publicUrl || "";
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
  files: File[],
  folder?: string
): Promise<string[]> {
  const results = await Promise.allSettled(
    files.map((f) => uploadImage(f, folder))
  );
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
