import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * The weekly post's header photograph. The writer supplies the art direction
 * (`article.image_prompt`); OPS adds the fixed house style, asks OpenAI's image
 * model for one landscape frame, and crops it to the 16:9 the journal shows.
 * The routine never calls an image service: generation is OPS's own server-side
 * spend on OPS's own key, one image per request.
 */
export const JOURNAL_IMAGE_VERSION = "journal-photo-2026-09-15-v1" as const;

// Fast, high-quality everyday generation (OpenAI image guide, 2026-09).
export const JOURNAL_IMAGE_MODEL = "gpt-image-2.5-flare";

// 1536 × 1024 is the landscape size OpenAI recommends; at high quality it is
// cheaper than the square. The public crop is 16:9, which trims about 7% from
// the top and the bottom, so the house style keeps the subject centred.
export const JOURNAL_IMAGE_REQUEST = {
  size: "1536x1024",
  quality: "high",
  output_format: "jpeg",
  output_compression: 95,
} as const;

export const JOURNAL_IMAGE_WIDTH = 1600;
export const JOURNAL_IMAGE_HEIGHT = 900;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// Matched to the photographs already on the journal: restrained, documentary,
// trades infrastructure, no words. ops-site shows the image full-bleed at half
// the viewport height with a white fade over its lower half, and the index card
// is 16:10, so the decisive detail has to live in the upper-middle band.
export const JOURNAL_IMAGE_STYLE = [
  "House style for the OPS Journal, a publication for owners of small trades businesses in North America:",
  "an original photorealistic editorial photograph, shot like documentary work on a real job site or in a real shop,",
  "natural light, true colour, restrained realism, generous negative space, no staged gloss and no illustration.",
  "Landscape frame with the decisive subject centred in the upper-middle of the frame and clear room above and below it,",
  "because the photograph is cropped to 16:9 and shown behind a fade over its lower half.",
  "No text, letters, numbers, signage, labels, logos, brand marks, watermarks, flags, screens with readable content,",
  "or recognisable real people, companies, places or products.",
  "Any work shown follows safe practice: correct protective equipment, secured ladders, no unguarded edges.",
].join(" ");

export type JournalImageCode =
  | "IMAGE_NOT_CONFIGURED"
  | "IMAGE_NOT_AUTHORIZED"
  | "IMAGE_REFUSED"
  | "IMAGE_INVALID"
  | "IMAGE_FAILED";

export class JournalImageError extends Error {
  constructor(readonly code: JournalImageCode) {
    super(code);
    this.name = "JournalImageError";
  }
}

/** Maps anything the image service throws onto the codes the ledger records. */
export function journalImageErrorFrom(error: unknown): JournalImageError {
  if (error instanceof JournalImageError) return error;
  const detail = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const status = typeof detail?.status === "number" ? detail.status : null;
  const code = typeof detail?.code === "string" ? detail.code : "";
  const message = typeof detail?.message === "string" ? detail.message : "";
  if (code === "moderation_blocked" || /moderation|safety system/i.test(message)) {
    return new JournalImageError("IMAGE_REFUSED");
  }
  if (status === 401 || status === 403) return new JournalImageError("IMAGE_NOT_AUTHORIZED");
  return new JournalImageError("IMAGE_FAILED");
}

export function buildJournalImagePrompt(artDirection: string): string {
  const direction = artDirection.replace(/\s+/g, " ").trim();
  if (!direction) throw new JournalImageError("IMAGE_INVALID");
  return `${direction}\n\n${JOURNAL_IMAGE_STYLE}`;
}

/** Returns the raw image bytes for one prompt. */
export type JournalImageGenerator = (prompt: string) => Promise<Buffer>;

export interface GeneratedJournalImage {
  buffer: Buffer;
  width: number;
  height: number;
  contentType: "image/jpeg";
  model: string;
  prompt_sha256: string;
}

export async function generateJournalImage(
  artDirection: string,
  generate: JournalImageGenerator
): Promise<GeneratedJournalImage> {
  const prompt = buildJournalImagePrompt(artDirection);
  let raw: Buffer;
  try {
    raw = await generate(prompt);
  } catch (error) {
    throw journalImageErrorFrom(error);
  }
  let buffer: Buffer;
  try {
    const metadata = await sharp(raw).metadata();
    if (!metadata.width || !metadata.height) throw new Error("no dimensions");
    buffer = await sharp(raw)
      .rotate()
      .resize(JOURNAL_IMAGE_WIDTH, JOURNAL_IMAGE_HEIGHT, { fit: "cover", position: "centre" })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new JournalImageError("IMAGE_INVALID");
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new JournalImageError("IMAGE_INVALID");
  return {
    buffer,
    width: JOURNAL_IMAGE_WIDTH,
    height: JOURNAL_IMAGE_HEIGHT,
    contentType: "image/jpeg",
    model: JOURNAL_IMAGE_MODEL,
    prompt_sha256: createHash("sha256").update(prompt).digest("hex"),
  };
}
