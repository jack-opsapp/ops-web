import "server-only";

import convertHeic from "heic-convert";
import sharp from "sharp";

import type { ExternalIntakeFileKind } from "./structural-inspector";

export interface SanitizedExternalIntakeImage {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}

export async function sanitizeExternalIntakeImage(
  bytes: Buffer,
  kind: ExternalIntakeFileKind
): Promise<SanitizedExternalIntakeImage | null> {
  if (!["jpeg", "png", "webp", "heic", "heif"].includes(kind)) {
    return null;
  }

  const decoded =
    kind === "heic" || kind === "heif"
      ? Buffer.from(
          await convertHeic({
            buffer: bytes,
            format: "JPEG",
            quality: 1,
          })
        )
      : bytes;
  const base = sharp(decoded, {
    failOn: "warning",
    limitInputPixels: 50_000_000,
    pages: 1,
  })
    .rotate()
    .toColorspace("srgb");

  let output: Buffer;
  let contentType: SanitizedExternalIntakeImage["contentType"];
  if (kind === "png") {
    output = await base
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    contentType = "image/png";
  } else if (kind === "webp") {
    output = await base.webp({ quality: 90, effort: 5 }).toBuffer();
    contentType = "image/webp";
  } else {
    output = await base.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    contentType = "image/jpeg";
  }

  const metadata = await sharp(output).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("sanitized_image_invalid");
  }
  return {
    bytes: output,
    contentType,
    width: metadata.width,
    height: metadata.height,
  };
}
