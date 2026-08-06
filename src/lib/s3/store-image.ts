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
  /** Logical prefix, e.g. `"company-{id}/logos"`. Gets company-scoped. */
  folder: string;
  companyId: string;
  /**
   * Optional marker in front of the generated filename, e.g. `"signature_"`.
   * Lets two kinds of object share one folder — and so one public-read
   * policy — without either being able to overwrite the other.
   */
  filenamePrefix?: string;
}

/** Same alphabet the folder segments allow: no slashes, no traversal. */
const SAFE_FILENAME_PREFIX_RE = /^[A-Za-z0-9._-]+$/;

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

  // Callers pass a constant here, never user input — but the folder is
  // guarded segment by segment, and a filename able to hold a slash would
  // be the one way around that. Fail closed instead.
  if (
    input.filenamePrefix !== undefined &&
    !SAFE_FILENAME_PREFIX_RE.test(input.filenamePrefix)
  ) {
    return { ok: false, error: "Invalid filename prefix" };
  }
  const filenamePrefix = input.filenamePrefix ?? "";

  const key = `${folder.folder}/${filenamePrefix}${buildUniqueSuffix()}.${input.extension}`;

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
