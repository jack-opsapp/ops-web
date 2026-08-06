/**
 * Server-side validation for an image that arrives base64-encoded in a JSON
 * body.
 *
 * The signature logo takes this route rather than the shared upload endpoint
 * because the stored URL becomes an `<img src>` in outbound mail: the bytes
 * have to come from the operator, not a URL the caller hands us. That means
 * this module is the only thing standing between a JSON string and an object
 * in the bucket, so it trusts nothing — the declared content type is a claim,
 * checked against the file's own magic number before anything is stored.
 */

/** One megabyte decoded. A mark that needs more than this is a photograph. */
export const MAX_IMAGE_UPLOAD_BYTES = 1024 * 1024;

interface ImageFormat {
  contentType: string;
  /** What the operator calls it. */
  label: string;
  extension: string;
  matches: (buffer: Buffer) => boolean;
}

const FORMATS: ImageFormat[] = [
  {
    contentType: "image/png",
    label: "PNG",
    extension: "png",
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a,
  },
  {
    contentType: "image/jpeg",
    label: "JPG",
    extension: "jpg",
    matches: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  {
    contentType: "image/webp",
    label: "WebP",
    extension: "webp",
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP",
  },
];

export interface DecodedImageUpload {
  ok: true;
  buffer: Buffer;
  contentType: string;
  extension: string;
}

export interface RejectedImageUpload {
  ok: false;
  error: string;
}

const DATA_URL = /^data:[^;,]*;base64,/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decodes and vets a base64 image payload. Every failure carries the sentence
 * the operator should see — there is no second layer that knows better.
 */
export function decodeImageUploadPayload(input: {
  data: unknown;
  contentType: unknown;
}): DecodedImageUpload | RejectedImageUpload {
  const format = FORMATS.find(
    (candidate) => candidate.contentType === input.contentType
  );
  if (!format) return { ok: false, error: "Use a PNG, JPG, or WebP image" };

  if (typeof input.data !== "string") {
    return { ok: false, error: "That image could not be read" };
  }
  const encoded = input.data.replace(DATA_URL, "").replace(/\s+/g, "");
  if (!encoded || encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
    return { ok: false, error: "That image could not be read" };
  }

  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0) {
    return { ok: false, error: "That image could not be read" };
  }
  // Checked before the magic number so an oversized file is named for what is
  // actually wrong with it.
  if (buffer.length > MAX_IMAGE_UPLOAD_BYTES) {
    return { ok: false, error: "Keep the logo under 1 MB" };
  }
  if (!format.matches(buffer)) {
    return { ok: false, error: `That file is not a ${format.label} image` };
  }

  return {
    ok: true,
    buffer,
    contentType: format.contentType,
    extension: format.extension,
  };
}
