import sharp from "sharp";

const MAX_VISION_EDGE_PX = 4_096;
const MAX_INPUT_PIXELS = 100_000_000;

export interface NormalizedAttachmentVisionImage {
  bytes: Buffer;
  mimeType: "image/jpeg";
}

/**
 * Convert an OPS-stored customer image into one bounded JPEG frame for vision.
 * This gives HEIC/HEIF/TIFF/BMP and phone-orientation metadata the same path as
 * JPEG/PNG/WebP while keeping the original private file byte-for-byte intact.
 * Deterministic decoder failures return null so the durable inspection job can
 * be skipped instead of retrying a permanently unsupported format forever.
 */
export async function normalizeAttachmentImageForVision(
  bytes: Buffer
): Promise<NormalizedAttachmentVisionImage | null> {
  try {
    const normalized = await sharp(bytes, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize({
        width: MAX_VISION_EDGE_PX,
        height: MAX_VISION_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    return { bytes: normalized, mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}
