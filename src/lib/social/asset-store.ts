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
import type { RenderedSocialAsset } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export interface StoreSocialAssetInput {
  postId: string;
  renderVersion: string;
  order: number;
  buffer: Buffer;
  altText: string;
  width: number;
  height: number;
}

export interface SocialAssetStoreDependencies {
  backend: StorageBackend;
  putS3: (key: string, buffer: Buffer) => Promise<void>;
  putSupabase: (key: string, buffer: Buffer) => Promise<void>;
  publicS3Url: (key: string) => string;
  publicSupabaseUrl: (key: string) => string;
}

function defaultDependencies(): SocialAssetStoreDependencies {
  const supabase = getServiceRoleClient();
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
      const { error } = await supabase.storage.from("social-media").upload(key, buffer, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
      });
      if (error) throw new Error(`Social asset upload failed: ${error.message}`);
    },
    publicS3Url: buildPublicS3Url,
    publicSupabaseUrl: (key) =>
      supabase.storage.from("social-media").getPublicUrl(key).data.publicUrl,
  };
}

export async function storeSocialAsset(
  input: StoreSocialAssetInput,
  dependencies: SocialAssetStoreDependencies = defaultDependencies()
): Promise<RenderedSocialAsset> {
  if (!UUID_PATTERN.test(input.postId)) throw new Error("Invalid social post ID");
  if (!SAFE_VERSION_PATTERN.test(input.renderVersion)) throw new Error("Invalid render version");
  if (!Number.isInteger(input.order) || input.order < 1 || input.order > 10) {
    throw new Error("Invalid slide order");
  }
  if (input.width < 1 || input.height < 1) throw new Error("Invalid asset dimensions");

  const slide = String(input.order).padStart(2, "0");
  const relativeKey = `${input.postId}/${input.renderVersion}/slide-${slide}.jpg`;
  const storageKey = `social-media/${relativeKey}`;
  let url: string;

  if (dependencies.backend === "supabase") {
    await dependencies.putSupabase(relativeKey, input.buffer);
    url = dependencies.publicSupabaseUrl(relativeKey);
  } else {
    await dependencies.putS3(storageKey, input.buffer);
    url = dependencies.publicS3Url(storageKey);
  }

  return {
    order: input.order,
    url,
    alt_text: input.altText,
    sha256: createHash("sha256").update(input.buffer).digest("hex"),
    width: input.width,
    height: input.height,
    bytes: input.buffer.byteLength,
    content_type: "image/jpeg",
    storage_key: storageKey,
  };
}
