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
import { JOURNAL_HERO_VERSION, type RenderedJournalHero } from "./hero";
import { isJournalHeroUrl, JOURNAL_HERO_PREFIX } from "./hero-url";

export { isJournalHeroUrl, JOURNAL_HERO_PREFIX };

export interface JournalHeroAsset {
  url: string;
  storage_key: string;
  backend: StorageBackend;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  content_type: "image/jpeg";
  render_version: string;
}

export interface JournalHeroStoreDependencies {
  backend: StorageBackend;
  putS3: (key: string, buffer: Buffer) => Promise<void>;
  putSupabase: (key: string, buffer: Buffer) => Promise<void>;
  publicS3Url: (key: string) => string;
  publicSupabaseUrl: (key: string) => string;
}

// Blog imagery follows the product's global storage selector exactly as the
// Blog admin upload does (S3 `blog/…`, or the Supabase `images` bucket when
// STORAGE_BACKEND=supabase). Nothing here changes that selector.
function defaultDependencies(): JournalHeroStoreDependencies {
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
      if (error) throw new Error(`Journal hero upload failed: ${error.message}`);
    },
    publicS3Url: buildPublicS3Url,
    publicSupabaseUrl: (key) =>
      getServiceRoleClient().storage.from("images").getPublicUrl(key).data.publicUrl,
  };
}

/**
 * The key is derived from the slot and the image bytes, so a retried
 * promotion writes the same object instead of littering the bucket.
 */
export function journalHeroKey(identity: string, sha256: string): string {
  const slot = /^weekly:(\d{4}-\d{2}-\d{2})$/.exec(identity)?.[1];
  if (!slot) throw new Error("Invalid journal identity");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Invalid image digest");
  return `${JOURNAL_HERO_PREFIX}${slot}-${sha256.slice(0, 16)}.jpg`;
}

export async function storeJournalHero(
  identity: string,
  hero: RenderedJournalHero,
  dependencies: JournalHeroStoreDependencies = defaultDependencies()
): Promise<JournalHeroAsset> {
  const sha256 = createHash("sha256").update(hero.buffer).digest("hex");
  const key = journalHeroKey(identity, sha256);
  let url: string;
  if (dependencies.backend === "supabase") {
    await dependencies.putSupabase(key, hero.buffer);
    url = dependencies.publicSupabaseUrl(key);
  } else {
    await dependencies.putS3(key, hero.buffer);
    url = dependencies.publicS3Url(key);
  }
  return {
    url,
    storage_key: key,
    backend: dependencies.backend,
    sha256,
    width: hero.width,
    height: hero.height,
    bytes: hero.buffer.byteLength,
    content_type: "image/jpeg",
    render_version: JOURNAL_HERO_VERSION,
  };
}
