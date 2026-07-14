/**
 * OPS Web — Lead Photo Upload
 *
 * Uploads lead photos through `/api/uploads/presign` into
 * `opportunities/{companyId}/{opportunityId}/…` — the exact folder iOS
 * `LeadImageService` writes — and returns the full public S3 URLs that land
 * in `opportunities.images` (bible 03 § Images contract).
 *
 * Transport: the route's multipart direct-upload mode (server-side S3 put,
 * same auth + folder authorization + content-type validation as the JSON
 * presign mode). Browser-direct presigned PUTs are the eventual upgrade but
 * are blocked today: `ops-app-files-prod` has no CORS rule for browser
 * origins, so a cross-origin PUT dies in preflight (verified 2026-07-14).
 * iOS is unaffected (native URLSession — no CORS). If bucket CORS lands,
 * swap `uploadOne` to presign + PUT and nothing else changes.
 *
 * Auth rides `authedFetch` — the route rejects anonymous calls (the legacy
 * `uploadImage()` helper predates that tightening and sends none).
 *
 * Per-file failure isolation mirrors iOS: every file settles independently;
 * what lands is returned in input order, what doesn't is counted so the
 * caller can surface a partial-failure line.
 */

import { authedFetch } from "@/lib/utils/authed-fetch";
import { compressImage, ImageUploadError } from "./image-service";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB — matches the route cap.
const COMPRESS_THRESHOLD = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export interface LeadPhotoUploadResult {
  /** Public S3 URLs of every photo that landed, in input order. */
  urls: string[];
  /** Number of files that failed validation or upload. */
  failedCount: number;
}

interface UploadResponse {
  url?: string;
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
  let filename = file.name;
  if (file.size > COMPRESS_THRESHOLD && file.type !== "image/heic") {
    try {
      blob = await compressImage(file);
      contentType = "image/jpeg";
      filename = filename.replace(/\.[A-Za-z0-9]+$/, "") + ".jpg";
    } catch {
      // Compression is best-effort; the original still fits the 10MB cap.
    }
  }

  const formData = new FormData();
  formData.append("file", new File([blob], filename, { type: contentType }));
  formData.append("folder", folder);

  const res = await authedFetch("/api/uploads/presign", {
    method: "POST",
    body: formData,
  });

  const body = (await res.json().catch(() => ({}))) as UploadResponse;
  const publicUrl = body.publicUrl || body.url;
  if (!res.ok || !publicUrl) {
    throw new ImageUploadError(
      body.error || `Upload failed (${res.status})`,
      "UPLOAD_FAILED"
    );
  }

  return publicUrl;
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
