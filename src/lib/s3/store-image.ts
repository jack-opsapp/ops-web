/**
 * Server-side image storage, for routes that receive image bytes directly
 * instead of handing the browser a presigned URL.
 *
 * This project's bucket rejects cross-origin PUTs, so "upload straight from
 * the browser" is not on the table — every upload lands on a route first. The
 * key shape, the company-scoping rule, and the storage-backend switch are the
 * same ones `/api/uploads/presign` uses on its direct-upload path; they live
 * here so a second route does not have to reimplement them.
 */

import { PutObjectCommand } from "@aws-sdk/client-s3";

import {
  buildPublicS3Url,
  getS3Client,
  getStorageBackend,
  S3_BUCKET,
} from "@/lib/s3/client";
import { authorizeFolder, buildUniqueSuffix } from "@/lib/s3/path-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export interface StoreImageInput {
  buffer: Buffer;
  contentType: string;
  /** Extension without the dot, already derived from the verified bytes. */
  extension: string;
  /** Logical prefix, e.g. `"email-signatures"`. Gets company-scoped. */
  folder: string;
  companyId: string;
}

export type StoreImageResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Writes the bytes and returns the public URL. The caller's company id is
 * forced into the key, so one company's upload can never land in another's
 * prefix even if the folder string says otherwise.
 */
export async function storeImageObject(
  input: StoreImageInput
): Promise<StoreImageResult> {
  const folder = authorizeFolder(input.folder, input.companyId);
  if (!folder.ok) return { ok: false, error: folder.reason };

  const key = `${folder.folder}/${buildUniqueSuffix()}.${input.extension}`;

  if (getStorageBackend() === "supabase") {
    const supabase = getServiceRoleClient();
    const { error } = await supabase.storage
      .from("images")
      .upload(key, input.buffer, {
        contentType: input.contentType,
        upsert: false,
      });
    if (error) return { ok: false, error: error.message };
    const { data } = supabase.storage.from("images").getPublicUrl(key);
    return { ok: true, url: data.publicUrl };
  }

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: input.buffer,
      ContentType: input.contentType,
    })
  );
  return { ok: true, url: buildPublicS3Url(key) };
}
