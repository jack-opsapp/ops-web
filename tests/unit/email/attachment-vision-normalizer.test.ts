import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { normalizeAttachmentImageForVision } from "@/lib/api/services/email-attachments/attachment-vision-normalizer";

describe("attachment vision image normalization", () => {
  it("converts supported and camera-oriented image inputs to a bounded JPEG payload", async () => {
    const png = await sharp({
      create: {
        width: 5_000,
        height: 2_500,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    const normalized = await normalizeAttachmentImageForVision(png);

    expect(normalized).not.toBeNull();
    expect(normalized?.mimeType).toBe("image/jpeg");
    const metadata = await sharp(normalized!.bytes).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(4_096);
    expect(metadata.height).toBe(2_048);
  });

  it("fails closed for invalid or unsupported image bytes", async () => {
    await expect(
      normalizeAttachmentImageForVision(Buffer.from("not-an-image"))
    ).resolves.toBeNull();
  });
});
