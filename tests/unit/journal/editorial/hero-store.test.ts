import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  isJournalHeroUrl,
  journalHeroKey,
  storeJournalHero,
  type JournalHeroStoreDependencies,
} from "@/lib/journal/editorial/hero-store";

const hero = {
  buffer: Buffer.from("jpeg-bytes"),
  width: 1200,
  height: 630,
  contentType: "image/jpeg" as const,
};
const digest = createHash("sha256").update(hero.buffer).digest("hex");

function deps(backend: "s3" | "supabase"): JournalHeroStoreDependencies {
  return {
    backend,
    putS3: vi.fn(async () => undefined),
    putSupabase: vi.fn(async () => undefined),
    publicS3Url: (key) => `https://ops-app-files-prod.s3.us-west-2.amazonaws.com/${key}`,
    publicSupabaseUrl: (key) =>
      `https://ijeekuhbatykdomumfjx.supabase.co/storage/v1/object/public/images/${key}`,
  };
}

describe("journal hero storage", () => {
  it("derives a stable key from the slot and the bytes", () => {
    expect(journalHeroKey("weekly:2026-09-14", digest)).toBe(
      `blog/journal/2026-09-14-${digest.slice(0, 16)}.jpg`
    );
    expect(() => journalHeroKey("blog:abc", digest)).toThrow();
    expect(() => journalHeroKey("weekly:2026-09-14", "nope")).toThrow();
  });

  it("writes to S3 under the blog prefix when the global backend is S3", async () => {
    const d = deps("s3");
    const asset = await storeJournalHero("weekly:2026-09-14", hero, d);
    expect(d.putS3).toHaveBeenCalledWith(asset.storage_key, hero.buffer);
    expect(d.putSupabase).not.toHaveBeenCalled();
    expect(asset).toMatchObject({
      url: `https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/journal/2026-09-14-${digest.slice(0, 16)}.jpg`,
      backend: "s3",
      sha256: digest,
      width: 1200,
      height: 630,
      bytes: hero.buffer.byteLength,
      content_type: "image/jpeg",
    });
  });

  it("follows the Supabase images bucket when the global backend is Supabase", async () => {
    const d = deps("supabase");
    const asset = await storeJournalHero("weekly:2026-09-14", hero, d);
    expect(d.putSupabase).toHaveBeenCalledWith(asset.storage_key, hero.buffer);
    expect(asset.url).toContain("/object/public/images/blog/journal/");
  });

  it("recognises a journal plate URL on either backend and nothing else", () => {
    expect(isJournalHeroUrl("https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/journal/2026-09-14-x.jpg")).toBe(true);
    expect(isJournalHeroUrl("https://ijeekuhbatykdomumfjx.supabase.co/storage/v1/object/public/images/blog/journal/2026-09-14-x.jpg")).toBe(true);
    expect(isJournalHeroUrl("https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/1788762281195-75f6b6d4.png")).toBe(false);
    expect(isJournalHeroUrl(null)).toBe(false);
    expect(isJournalHeroUrl("not a url")).toBe(false);
  });
});
