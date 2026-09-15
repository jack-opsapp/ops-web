import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  buildJournalImagePrompt,
  generateJournalImage,
  JOURNAL_IMAGE_MODEL,
  JOURNAL_IMAGE_REQUEST,
  JOURNAL_IMAGE_STYLE,
  JournalImageError,
  journalImageErrorFrom,
} from "@/lib/journal/editorial/image";

const direction =
  "A deck builder at first light holds a folded bid sheet against a half-framed deck, tape measure hooked on a joist.";

async function landscapeJpeg(width = 1536, height = 1024) {
  return await sharp({ create: { width, height, channels: 3, background: { r: 92, g: 104, b: 112 } } })
    .jpeg()
    .toBuffer();
}

describe("journal photograph generation", () => {
  it("asks for one high-quality landscape JPEG from the fast image model", () => {
    expect(JOURNAL_IMAGE_MODEL).toBe("gpt-image-2.5-flare");
    expect(JOURNAL_IMAGE_REQUEST).toEqual({
      size: "1536x1024",
      quality: "high",
      output_format: "jpeg",
      output_compression: 95,
    });
  });

  it("puts the writer's direction first and the fixed house style after it", () => {
    const prompt = buildJournalImagePrompt(`  ${direction}\n\n  `);
    expect(prompt.startsWith(direction)).toBe(true);
    expect(prompt.endsWith(JOURNAL_IMAGE_STYLE)).toBe(true);
    expect(JOURNAL_IMAGE_STYLE).toMatch(/No text, letters, numbers, signage/);
    expect(JOURNAL_IMAGE_STYLE).toMatch(/16:9/);
    expect(() => buildJournalImagePrompt("   ")).toThrow(JournalImageError);
  });

  it("crops the frame to the 1600 × 900 the journal shows and records what made it", async () => {
    const generate = vi.fn(async () => await landscapeJpeg());
    const image = await generateJournalImage(direction, generate);
    expect(generate).toHaveBeenCalledWith(buildJournalImagePrompt(direction));
    const metadata = await sharp(image.buffer).metadata();
    expect([metadata.width, metadata.height, metadata.format]).toEqual([1600, 900, "jpeg"]);
    expect(image).toMatchObject({ width: 1600, height: 900, contentType: "image/jpeg", model: "gpt-image-2.5-flare" });
    expect(image.prompt_sha256).toBe(createHash("sha256").update(buildJournalImagePrompt(direction)).digest("hex"));
  });

  it("refuses bytes that are not an image", async () => {
    await expect(generateJournalImage(direction, async () => Buffer.from("not an image"))).rejects.toMatchObject({
      code: "IMAGE_INVALID",
    });
  });

  it("names every way the image service can fail", async () => {
    expect(journalImageErrorFrom({ status: 400, code: "moderation_blocked", message: "blocked" }).code).toBe("IMAGE_REFUSED");
    expect(journalImageErrorFrom({ status: 400, message: "Your request was rejected by the safety system." }).code).toBe("IMAGE_REFUSED");
    expect(journalImageErrorFrom({ status: 403, message: "Your organization must be verified" }).code).toBe("IMAGE_NOT_AUTHORIZED");
    expect(journalImageErrorFrom({ status: 401, message: "Incorrect API key" }).code).toBe("IMAGE_NOT_AUTHORIZED");
    expect(journalImageErrorFrom({ status: 500, message: "server error" }).code).toBe("IMAGE_FAILED");
    expect(journalImageErrorFrom(new Error("socket hang up")).code).toBe("IMAGE_FAILED");
    const configured = new JournalImageError("IMAGE_NOT_CONFIGURED");
    expect(journalImageErrorFrom(configured)).toBe(configured);
    await expect(
      generateJournalImage(direction, async () => {
        throw { status: 403, message: "Your organization must be verified to use the model" };
      })
    ).rejects.toMatchObject({ code: "IMAGE_NOT_AUTHORIZED" });
  });
});
