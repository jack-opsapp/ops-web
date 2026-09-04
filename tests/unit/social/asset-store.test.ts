import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { storeSocialAsset } from "@/lib/social/asset-store";

const input = {
  postId: "9d5fd8b8-83bc-44bf-b846-63c5a1bb9c30",
  renderVersion: "render-2026-09-01-a1",
  order: 1,
  buffer: Buffer.from("jpeg bytes"),
  altText: "A field note about crew coordination.",
  width: 1080,
  height: 1350,
};

describe("social rendered asset storage", () => {
  it("uses a deterministic S3 key and returns complete metadata", async () => {
    const putS3 = vi.fn().mockResolvedValue(undefined);
    const result = await storeSocialAsset(input, {
      backend: "s3",
      putS3,
      putSupabase: vi.fn(),
      publicS3Url: (key) => `https://bucket.s3.us-west-2.amazonaws.com/${key}`,
      publicSupabaseUrl: vi.fn(),
    });

    expect(putS3).toHaveBeenCalledWith(
      "social-media/9d5fd8b8-83bc-44bf-b846-63c5a1bb9c30/render-2026-09-01-a1/slide-01.jpg",
      input.buffer
    );
    expect(result).toEqual({
      order: 1,
      url: "https://bucket.s3.us-west-2.amazonaws.com/social-media/9d5fd8b8-83bc-44bf-b846-63c5a1bb9c30/render-2026-09-01-a1/slide-01.jpg",
      alt_text: input.altText,
      sha256: createHash("sha256").update(input.buffer).digest("hex"),
      width: 1080,
      height: 1350,
      bytes: input.buffer.byteLength,
      content_type: "image/jpeg",
      storage_key:
        "social-media/9d5fd8b8-83bc-44bf-b846-63c5a1bb9c30/render-2026-09-01-a1/slide-01.jpg",
    });
  });

  it("uses the social-media bucket without duplicating its prefix", async () => {
    const putSupabase = vi.fn().mockResolvedValue(undefined);
    const result = await storeSocialAsset(input, {
      backend: "supabase",
      putS3: vi.fn(),
      putSupabase,
      publicS3Url: vi.fn(),
      publicSupabaseUrl: (key) =>
        `https://project.supabase.co/storage/v1/object/public/social-media/${key}`,
    });

    expect(putSupabase).toHaveBeenCalledWith(
      "9d5fd8b8-83bc-44bf-b846-63c5a1bb9c30/render-2026-09-01-a1/slide-01.jpg",
      input.buffer
    );
    expect(result.url).not.toContain("social-media/social-media");
  });

  it("rejects unsafe identifiers and invalid slide positions", async () => {
    const dependencies = {
      backend: "s3" as const,
      putS3: vi.fn(),
      putSupabase: vi.fn(),
      publicS3Url: vi.fn(),
      publicSupabaseUrl: vi.fn(),
    };

    await expect(
      storeSocialAsset(
        { ...input, renderVersion: "../../escape" },
        dependencies
      )
    ).rejects.toThrow(/render version/i);
    await expect(
      storeSocialAsset({ ...input, order: 11 }, dependencies)
    ).rejects.toThrow(/slide order/i);
  });
});
