/**
 * S3 client factory for the OPS storage migration (Supabase → S3).
 *
 * Single source of truth for the AWS SDK client + bucket + region. All
 * server-side upload routes (`/api/uploads/presign`,
 * `/api/integrations/email/extract-images`, `/api/admin/blog/upload`,
 * `/api/bug-reports/screenshot`, `/api/admin/shop/upload`,
 * `/api/documents/generate-pdf`) should import from here so credential
 * resolution and region are consistent and rotatable from one place.
 *
 * Region / bucket defaults match the prior implementations in the legacy
 * routes (`us-west-2`, `ops-app-files-prod`) so a missing env var does
 * not silently land objects in the wrong bucket.
 */

import { S3Client } from "@aws-sdk/client-s3";

export const S3_REGION = process.env.AWS_REGION ?? "us-west-2";
export const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "ops-app-files-prod";

let _client: S3Client | null = null;

/**
 * Returns a memoized S3 client. The AWS SDK reuses HTTP connections
 * inside a single client instance, so handing every route the same
 * client (rather than constructing one per request) reduces cold-start
 * latency in serverless environments.
 */
export function getS3Client(): S3Client {
  if (_client) return _client;

  _client = new S3Client({
    region: S3_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    },
  });
  return _client;
}

/**
 * Build the public virtual-hosted–style URL for an object in the OPS
 * bucket. Used as the canonical "publicUrl" stored in database columns
 * after an upload completes.
 */
export function buildPublicS3Url(key: string): string {
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
}

/**
 * Storage backend selector for the Phase 1 cutover. Defaults to "s3"
 * once the cutover lands; setting STORAGE_BACKEND=supabase in Vercel
 * env reverts to the legacy Supabase Storage code path without a code
 * deploy. Phase 3 removes the Supabase branch entirely.
 */
export type StorageBackend = "s3" | "supabase";

export function getStorageBackend(): StorageBackend {
  const value = (process.env.STORAGE_BACKEND ?? "s3").toLowerCase();
  return value === "supabase" ? "supabase" : "s3";
}
