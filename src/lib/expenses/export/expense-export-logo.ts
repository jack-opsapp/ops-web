/**
 * Fetches and normalises a company logo for embedding.
 *
 * Fetched server-side for two reasons: browser CORS would block most of these
 * origins, and S3 prefixes are only public where the bucket policy says so, so
 * the browser is the wrong place to be asking. Everything is normalised to PNG
 * via sharp — which also rasterises SVG, and downsamples the 1000px+ logos
 * companies actually upload to something proportionate to a 74px slot instead
 * of carrying a megabyte into every download.
 *
 * Every failure is non-fatal: the document renders without a logo rather than
 * failing an export because a CDN was slow.
 */

import sharp from "sharp";
import type { WorkbookLogo } from "./expense-workbook";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 8 * 1024 * 1024;
/** Twice the printed slot, so it stays crisp on a retina screen and in print. */
const RASTER_W = 380;
const RASTER_H = 148;

/**
 * A missing logo is survivable but never silent: a company's document quietly
 * losing its branding is the kind of thing nobody reports and nobody can
 * diagnose later. Always leaves a greppable server line.
 */
function warn(reason: string, url: string): null {
  console.warn(`[expenses/export] logo skipped — ${reason} (${url})`);
  return null;
}

export async function fetchExportLogo(url: string | null): Promise<WorkbookLogo | null> {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) return warn(`logo fetch returned ${response.status}`, url);

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return null;

    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length === 0 || raw.length > MAX_BYTES) return null;

    const png = await sharp(raw, { density: 300 })
      .resize({
        width: RASTER_W,
        height: RASTER_H,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();

    return { buffer: png, extension: "png" };
  } catch (error) {
    return warn(error instanceof Error ? error.message : "logo fetch failed", url);
  }
}
