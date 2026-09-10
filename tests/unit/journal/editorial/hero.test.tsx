// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { JOURNAL_LIMITS } from "@/lib/journal/editorial/brief";
import {
  JOURNAL_HERO,
  heroDisplaySize,
  renderJournalHero,
} from "@/lib/journal/editorial/hero";

const SAMPLES = [
  { name: "short", heroLine: "The job starts when the phone rings" },
  { name: "medium", heroLine: "A referral nominates you for a background check" },
  { name: "long", heroLine: "Your jobs hide the money in four numbers nobody codes" },
];

// Set JOURNAL_HERO_PROOF_DIR to write the plates and every crop the public
// surfaces apply, for visual review.
const proofDir = process.env.JOURNAL_HERO_PROOF_DIR;

// ops-site PostHeader: transparent to 20 %, 40 % white at 50 %, white at 90 %.
function fade(width: number, height: number) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.2" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.4"/><stop offset="0.9" stop-color="#fff" stop-opacity="1"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`
  );
}

async function crops(jpeg: Buffer) {
  const card = await sharp(jpeg).resize(640, 400, { fit: "cover" }).jpeg().toBuffer();
  const desktop = await sharp(jpeg)
    .resize(1440, 450, { fit: "cover" })
    .composite([{ input: fade(1440, 450) }])
    .jpeg()
    .toBuffer();
  const phone = await sharp(jpeg)
    .resize(390, 422, { fit: "cover" })
    .composite([{ input: fade(390, 422) }])
    .jpeg()
    .toBuffer();
  return { card, desktop, phone };
}

describe("journal hero plate", () => {
  it("steps the display size down for longer lines", () => {
    expect(heroDisplaySize("The job starts when the phone")).toBe(JOURNAL_HERO.display.tight);
    expect(heroDisplaySize("A referral nominates you for a check")).toBe(JOURNAL_HERO.display.standard);
    expect(heroDisplaySize("x".repeat(JOURNAL_LIMITS.hero_line))).toBe(JOURNAL_HERO.display.long);
  });

  it("keeps the line inside the band every public crop keeps", () => {
    expect(JOURNAL_HERO.lineX).toBeGreaterThanOrEqual(312);
    expect(JOURNAL_HERO.lineX + JOURNAL_HERO.lineWidth).toBeLessThanOrEqual(888);
    expect(JOURNAL_HERO.markX).toBeGreaterThanOrEqual(96);
  });

  it("renders a 1200 × 630 JPEG for every sample length", async () => {
    if (proofDir) mkdirSync(proofDir, { recursive: true });
    for (const sample of SAMPLES) {
      expect(sample.heroLine.length).toBeLessThanOrEqual(JOURNAL_LIMITS.hero_line);
      const hero = await renderJournalHero(sample);
      const meta = await sharp(hero.buffer).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1200, 630]);
      expect(hero.buffer.byteLength).toBeGreaterThan(5000);
      if (proofDir) {
        writeFileSync(join(proofDir, `${sample.name}-1200x630.jpg`), hero.buffer);
        const views = await crops(hero.buffer);
        writeFileSync(join(proofDir, `${sample.name}-card-16x10.jpg`), views.card);
        writeFileSync(join(proofDir, `${sample.name}-article-desktop-1440x450.jpg`), views.desktop);
        writeFileSync(join(proofDir, `${sample.name}-article-phone-390x422.jpg`), views.phone);
      }
    }
  }, 60000);
});
