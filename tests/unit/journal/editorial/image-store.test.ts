import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isJournalHeroUrl } from "@/lib/journal/editorial/hero-url";
import {
  journalImageKey,
  storeJournalImage,
  type JournalImageStoreDependencies,
} from "@/lib/journal/editorial/image-store";

const image = {
  buffer: Buffer.from("jpeg-bytes"),
  width: 1600,
  height: 900,
  contentType: "image/jpeg" as const,
  model: "gpt-image-2.5-flare",
  prompt_sha256: "c".repeat(64),
};
const digest = createHash("sha256").update(image.buffer).digest("hex");

function deps(backend: "s3" | "supabase"): JournalImageStoreDependencies {
  return {
    backend,
    putS3: vi.fn(async () => undefined),
    putSupabase: vi.fn(async () => undefined),
    publicS3Url: (key) => `https://ops-app-files-prod.s3.us-west-2.amazonaws.com/${key}`,
    publicSupabaseUrl: (key) =>
      `https://ijeekuhbatykdomumfjx.supabase.co/storage/v1/object/public/images/${key}`,
  };
}

describe("journal photograph storage", () => {
  it("derives a stable key from the slot and the bytes", () => {
    expect(journalImageKey("weekly:2026-09-14", digest)).toBe(
      `blog/weekly/2026-09-14-${digest.slice(0, 16)}.jpg`
    );
    expect(() => journalImageKey("blog:abc", digest)).toThrow();
    expect(() => journalImageKey("weekly:2026-09-14", "nope")).toThrow();
  });

  it("writes to S3 under the blog prefix when the global backend is S3", async () => {
    const d = deps("s3");
    const asset = await storeJournalImage("weekly:2026-09-14", image, d);
    expect(d.putS3).toHaveBeenCalledWith(asset.storage_key, image.buffer);
    expect(d.putSupabase).not.toHaveBeenCalled();
    expect(asset).toMatchObject({
      url: `https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/weekly/2026-09-14-${digest.slice(0, 16)}.jpg`,
      backend: "s3",
      sha256: digest,
      width: 1600,
      height: 900,
      bytes: image.buffer.byteLength,
      content_type: "image/jpeg",
      render_version: "journal-photo-2026-09-15-v1",
      model: "gpt-image-2.5-flare",
      prompt_sha256: "c".repeat(64),
    });
  });

  it("follows the Supabase images bucket when the global backend is Supabase", async () => {
    const d = deps("supabase");
    const asset = await storeJournalImage("weekly:2026-09-14", image, d);
    expect(d.putSupabase).toHaveBeenCalledWith(asset.storage_key, image.buffer);
    expect(asset.url).toContain("/object/public/images/blog/weekly/");
  });

  it("never mistakes a generated photograph for a retired text plate", async () => {
    const asset = await storeJournalImage("weekly:2026-09-14", image, deps("s3"));
    expect(isJournalHeroUrl(asset.url)).toBe(false);
    expect(isJournalHeroUrl("https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/journal/2026-09-14-x.jpg")).toBe(true);
    expect(isJournalHeroUrl("https://ijeekuhbatykdomumfjx.supabase.co/storage/v1/object/public/images/blog/journal/2026-09-14-x.jpg")).toBe(true);
    expect(isJournalHeroUrl(null)).toBe(false);
    expect(isJournalHeroUrl("not a url")).toBe(false);
  });
});
