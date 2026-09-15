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

// Jackson's direction (2026-09-15): composed, never posed; realistic, never
// the stock trades picture; warm, refined and curated, never gloomy. Every
// photograph reads as a candid frame from a seasoned editorial photographer on
// assignment at a real residential job. ops-site shows the image full-bleed at
// half the viewport height with a white fade over its lower half, phones keep
// only the centre of the frame, and the index card is 16:10, so the decisive
// detail lives in the central two-thirds and above the lower third.
export const JOURNAL_IMAGE_STYLE = [
  "House style for the OPS Journal, a publication for owners of small trades businesses in North America.",
  "This is a candid editorial photograph made on assignment by a seasoned documentary photographer: composed, never posed,",
  "the kind of quiet, considered frame a contemporary fine-art photography gallery would print.",
  "Nothing is staged and nobody performs for the lens. People, when present, are caught mid-task and absorbed in the work,",
  "never smiling at or looking into the camera, never arranged, lined up or gesturing for the shot.",
  "The frame is deliberately composed: purposeful negative space, natural elements framing the subject, leading lines,",
  "layered foreground and background, the subject placed on a strong third, or a landscape built on sound compositional rules.",
  "Realism above all. This is a real residential job on an ordinary street: a house mid-renovation, a backyard deck,",
  "a driveway, a garage, a bungalow interior, a work truck at the curb. Crews dress the way real residential crews dress:",
  "jeans or work pants, a t-shirt or hoodie, a ball cap, sneakers or plain worn boots. No hard hats, no high-visibility vests,",
  "no safety glasses, no harnesses, no pristine new gear; clothes and tools are used, dusty and unbranded.",
  "Never the stock trades picture: no hard-hat crew, no blueprint spread on a table, no tool-belt hero shot, no tidy staged",
  "workbench, no sunset silhouette, no handshake. Prefer the frame a photographer would find rather than illustrate:",
  "the quiet in-between moment, the off-hours, an unexpected vantage, on a pleasant ordinary day.",
  "The atmosphere is warm, refined and curated: calm daylight, open shade or soft afternoon sun, a slightly warm colour temperature,",
  "the feel of a gallery print in a well-kept home. The grade is gentle: saturation and vibrance pulled down by roughly a fifth,",
  "soft contrast, clean matte highlights, shadows that keep their detail, a fine film grain. Never cold, gloomy, foggy, dim or ominous;",
  "never a storm, dusk-after-rain, a derelict interior or anything that reads as a horror film. Never HDR, never vivid or punchy colour,",
  "never teal-and-orange, never golden-hour glow, never glossy commercial polish.",
  "If the direction asks for black and white, make a clean, warm-toned monochrome with the same refinement.",
  "Wide landscape frame; keep the decisive detail inside the central two-thirds of the width and above the lower third,",
  "because the photograph is cropped to 16:9, shown behind a fade over its lower half, and trimmed to its centre on phones.",
  "No text, letters, numbers, signage, labels, logos, brand marks, watermarks, flags, screens with readable content,",
  "or recognisable real people, companies, places or products; any paper, board or screen in the frame is blank,",
  "turned away or out of focus, never showing legible marks. Nobody is shown in real danger.",
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
