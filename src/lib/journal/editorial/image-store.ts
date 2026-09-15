import "server-only";

import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  buildPublicS3Url,
  getS3Client,
  getStorageBackend,
  S3_BUCKET,
  type StorageBackend,
} from "@/lib/s3/client";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { JOURNAL_IMAGE_VERSION, type GeneratedJournalImage } from "./image";

/** Every generated weekly photograph lives under this key prefix. */
export const JOURNAL_IMAGE_PREFIX = "blog/weekly/";

export interface JournalImageAsset {
  url: string;
  storage_key: string;
  backend: StorageBackend;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  content_type: "image/jpeg";
  render_version: string;
  model: string;
  prompt_sha256: string;
}

export interface JournalImageStoreDependencies {
  backend: StorageBackend;
  putS3: (key: string, buffer: Buffer) => Promise<void>;
  putSupabase: (key: string, buffer: Buffer) => Promise<void>;
  publicS3Url: (key: string) => string;
  publicSupabaseUrl: (key: string) => string;
}

// Blog imagery follows the product's global storage selector exactly as the
// Blog admin upload does (S3 `blog/…`, or the Supabase `images` bucket when
// STORAGE_BACKEND=supabase). Nothing here changes that selector.
function defaultDependencies(): JournalImageStoreDependencies {
  return {
    backend: getStorageBackend(),
    putS3: async (key, buffer) => {
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: "image/jpeg",
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
    },
    putSupabase: async (key, buffer) => {
      const { error } = await getServiceRoleClient()
        .storage.from("images")
        .upload(key, buffer, { contentType: "image/jpeg", cacheControl: "31536000", upsert: true });
      if (error) throw new Error(`Journal image upload failed: ${error.message}`);
    },
    publicS3Url: buildPublicS3Url,
    publicSupabaseUrl: (key) =>
      getServiceRoleClient().storage.from("images").getPublicUrl(key).data.publicUrl,
  };
}

/**
 * Derived from the slot and the image bytes: every generation is its own
 * immutable object, and a retried upload of the same bytes writes the same key.
 */
export function journalImageKey(identity: string, sha256: string): string {
  const slot = /^weekly:(\d{4}-\d{2}-\d{2})$/.exec(identity)?.[1];
  if (!slot) throw new Error("Invalid journal identity");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Invalid image digest");
  return `${JOURNAL_IMAGE_PREFIX}${slot}-${sha256.slice(0, 16)}.jpg`;
}

export async function storeJournalImage(
  identity: string,
  image: GeneratedJournalImage,
  dependencies: JournalImageStoreDependencies = defaultDependencies()
): Promise<JournalImageAsset> {
  const sha256 = createHash("sha256").update(image.buffer).digest("hex");
  const key = journalImageKey(identity, sha256);
  let url: string;
  if (dependencies.backend === "supabase") {
    await dependencies.putSupabase(key, image.buffer);
    url = dependencies.publicSupabaseUrl(key);
  } else {
    await dependencies.putS3(key, image.buffer);
    url = dependencies.publicS3Url(key);
  }
  return {
    url,
    storage_key: key,
    backend: dependencies.backend,
    sha256,
    width: image.width,
    height: image.height,
    bytes: image.buffer.byteLength,
    content_type: "image/jpeg",
    render_version: JOURNAL_IMAGE_VERSION,
    model: image.model,
    prompt_sha256: image.prompt_sha256,
  };
}
