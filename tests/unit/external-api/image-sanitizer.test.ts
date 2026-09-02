// @vitest-environment node

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { sanitizeExternalIntakeImage } from "@/lib/external-api/uploads/image-sanitizer";
import { LIBHEIF_EXAMPLE_HEIC_BASE64 } from "../../fixtures/email/libheif-example-heic";

describe("external intake image sanitizer", () => {
  it("decodes, rotates, re-encodes, and removes source metadata", async () => {
    const source = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: "#406078",
      },
    })
      .withMetadata({
        orientation: 6,
        exif: {
          IFD0: {
            Artist: "private customer metadata",
          },
        },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();

    const sanitized = await sanitizeExternalIntakeImage(source, "jpeg");

    expect(sanitized).toMatchObject({
      contentType: "image/jpeg",
      width: 2,
      height: 3,
    });
    const metadata = await sharp(sanitized!.bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("turns HEIC into a metadata-free JPEG derivative", async () => {
    const source = Buffer.from(LIBHEIF_EXAMPLE_HEIC_BASE64, "base64");
    const sanitized = await sanitizeExternalIntakeImage(source, "heic");

    expect(sanitized).toMatchObject({
      contentType: "image/jpeg",
      width: 48,
      height: 32,
    });
    const metadata = await sharp(sanitized!.bytes).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
  });
});
