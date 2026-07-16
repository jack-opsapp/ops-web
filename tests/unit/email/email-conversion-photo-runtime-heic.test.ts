// @vitest-environment node

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { normalizeEmailConversionProjectPhoto } from "@/lib/api/services/email-conversion-photo-runtime";
import { LIBHEIF_EXAMPLE_HEIC_BASE64 } from "../../fixtures/email/libheif-example-heic";

describe("email conversion project photo HEIC normalization", () => {
  it("converts a real HEVC-backed iPhone-compatible HEIC into a bounded JPEG", async () => {
    const sourceBytes = Buffer.from(LIBHEIF_EXAMPLE_HEIC_BASE64, "base64");

    const normalized = await normalizeEmailConversionProjectPhoto(sourceBytes, {
      storagePath: "company/mailbox/example.heic",
      detectedMimeType: "image/heic",
      filename: "IMG_2048.HEIC",
      isInline: false,
      occurredAt: "2026-07-15T12:00:00.000Z",
      verifiedSizeBytes: sourceBytes.byteLength,
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.mimeType).toBe("image/jpeg");
    expect(normalized?.bytes.subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff])
    );
    expect(normalized?.bytes.byteLength).toBeLessThanOrEqual(10 * 1024 * 1024);

    const metadata = await sharp(normalized?.bytes).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
  });

  it("rejects a HEIC spatial extent that exceeds the decode pixel budget", async () => {
    const sourceBytes = Buffer.from(LIBHEIF_EXAMPLE_HEIC_BASE64, "base64");
    const spatialExtent = sourceBytes.indexOf(Buffer.from("ispe", "ascii"));
    expect(spatialExtent).toBeGreaterThan(0);
    sourceBytes.writeUInt32BE(32_768, spatialExtent + 8);
    sourceBytes.writeUInt32BE(32_768, spatialExtent + 12);

    const normalized = await normalizeEmailConversionProjectPhoto(sourceBytes, {
      storagePath: "company/mailbox/untrusted.heic",
      detectedMimeType: "image/heic",
      filename: "untrusted.heic",
      isInline: false,
      occurredAt: null,
      verifiedSizeBytes: sourceBytes.byteLength,
    });

    expect(normalized).toBeNull();
  });
});
