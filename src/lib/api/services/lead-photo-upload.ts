/**
 * OPS Web — Lead Photo Upload (presign flow)
 *
 * Uploads lead photos through `/api/uploads/presign` into
 * `opportunities/{companyId}/{opportunityId}/…` — the exact folder iOS
 * `LeadImageService` writes — and returns the full public S3 URLs that land
 * in `opportunities.images` (bible 03 § Images contract).
 *
 * Unlike the legacy `uploadImage()` multipart path, this uses the JSON
 * presign flow with an explicit `Authorization: Bearer` header (the route
 * rejects anonymous calls) via `authedFetch`, then PUTs the bytes straight
 * to S3 with the pinned Content-Type.
 *
 * Per-file failure isolation mirrors iOS: every file settles independently;
 * what lands is returned in input order, what doesn't is counted so the
 * caller can surface a partial-failure line.
 */

import { authedFetch } from "@/lib/utils/authed-fetch";
import { compressImage, ImageUploadError } from "./image-service";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB — matches the presign route cap.
const COMPRESS_THRESHOLD = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export interface LeadPhotoUploadResult {
  /** Public S3 URLs of every photo that landed, in input order. */
  urls: string[];
  /** Number of files that failed validation or upload. */
  failedCount: number;
}

interface PresignResponse {
  uploadUrl?: string;
  publicUrl?: string;
  error?: string;
}

async function uploadOne(file: File, folder: string): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new ImageUploadError(
      `Invalid file type: ${file.type}`,
      "INVALID_TYPE"
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new ImageUploadError(
      `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 10MB`,
      "TOO_LARGE"
    );
  }

  // Canvas can't decode HEIC — those upload as-is (same rule as uploadImage).
  let blob: Blob = file;
  let contentType = file.type;
  if (file.size > COMPRESS_THRESHOLD && file.type !== "image/heic") {
    try {
      blob = await compressImage(file);
      contentType = "image/jpeg";
    } catch {
      // Compression is best-effort; the original still fits the 10MB cap.
    }
  }

  const presignRes = await authedFetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType,
      folder,
    }),
  });

  const presign = (await presignRes.json().catch(() => ({}))) as PresignResponse;
  if (!presignRes.ok || !presign.uploadUrl || !presign.publicUrl) {
    throw new ImageUploadError(
      presign.error || `Presign failed (${presignRes.status})`,
      "UPLOAD_FAILED"
    );
  }

  // The signed URL pins Content-Type — the PUT must declare the same value.
  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!putRes.ok) {
    throw new ImageUploadError(
      `Storage upload failed (${putRes.status})`,
      "UPLOAD_FAILED"
    );
  }

  return presign.publicUrl;
}

/**
 * Upload a batch of lead photos for one opportunity. Resolves with the URLs
 * that landed (input order) and the count that failed — it never rejects for
 * a partial failure, only reports it.
 */
export async function uploadLeadPhotos(
  files: File[],
  companyId: string,
  opportunityId: string,
  onProgress?: (done: number, total: number) => void
): Promise<LeadPhotoUploadResult> {
  const folder = `opportunities/${companyId}/${opportunityId}`;
  const total = files.length;
  let done = 0;

  const settled = await Promise.allSettled(
    files.map(async (file) => {
      try {
        return await uploadOne(file, folder);
      } finally {
        done += 1;
        onProgress?.(done, total);
      }
    })
  );

  const urls: string[] = [];
  let failedCount = 0;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      urls.push(result.value);
    } else {
      failedCount += 1;
    }
  }

  return { urls, failedCount };
}
