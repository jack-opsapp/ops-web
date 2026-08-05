/**
 * Automatic background removal for an uploaded signature logo.
 *
 * The operator has a logo on a white card, or a JPEG with a grey field behind
 * it, and they want it in their email signature. They should not have to know
 * what a transparent PNG is, and they should not be handed a "remove
 * background" button to reason about. So: upload anything, a solid field comes
 * out clean, and nothing is announced. If the background is a photo or a
 * gradient — anything this cannot cut cleanly — it is left exactly as it was
 * rather than mangled.
 *
 * The detection and fill are a pure function over pixels so the behavior can be
 * tested without a canvas; the browser wrapper below only decodes and encodes.
 * No paid cutout service, no model — a flood fill from the border does the
 * whole job for the flat backgrounds this actually meets.
 */

/** How far a border pixel may sit from the border's median and still read as
 *  background when deciding whether the background is solid at all. */
const SOLID_TOLERANCE = 24;

/** Share of the border that must read as background for the field to count as
 *  solid. The slack absorbs a mark that runs off the edge of the image. */
const SOLID_RATIO = 0.9;

/** The fill is slightly more forgiving than the detection, so JPEG ringing
 *  around the mark does not leave a halo of survivors. */
const FILL_TOLERANCE = 28;

/** Pixels this close to the background that touch the cut get half alpha —
 *  the anti-aliased rim, softened instead of left as a jagged edge. */
const FEATHER_TOLERANCE = Math.round(FILL_TOLERANCE * 1.5);
const FEATHER_ALPHA = 128;

/** Beyond this the file is a photograph, not a mark. The signature renders at
 *  96–120px, so the cap costs nothing and keeps the upload inside the route's
 *  size limit after the PNG re-encode. */
const MAX_EDGE = 1024;

export interface BackgroundRemovalResult {
  /** True only when pixels actually changed — this is what earns the operator
   *  an undo affordance. A background left alone never offers one. */
  applied: boolean;
}

function borderIndices(width: number, height: number): Uint32Array {
  const count =
    width === 1 || height === 1
      ? width * height
      : width * 2 + height * 2 - 4;
  const indices = new Uint32Array(count);
  let next = 0;
  for (let x = 0; x < width; x += 1) {
    indices[next++] = x;
    if (height > 1) indices[next++] = (height - 1) * width + x;
  }
  for (let y = 1; y < height - 1; y += 1) {
    indices[next++] = y * width;
    if (width > 1) indices[next++] = y * width + width - 1;
  }
  return indices.subarray(0, next);
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/**
 * Strips a solid background in place, leaving alpha 0 where the field was.
 *
 * Returns whether anything was removed. Untouched on `false` — the caller can
 * hand the original file straight through.
 */
export function removeSolidBackgroundFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number
): BackgroundRemovalResult {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    data.length < width * height * 4
  ) {
    return { applied: false };
  }

  const border = borderIndices(width, height);
  const opaque: number[] = [];
  for (const index of border) {
    if (data[index * 4 + 3] > 0) opaque.push(index);
  }

  // A border that is already transparent belongs to a logo somebody has
  // already cut out. Its background pixels carry arbitrary colour under that
  // transparency, so re-cutting could flood the mark's own ink away.
  if (opaque.length < border.length * (1 - SOLID_RATIO)) {
    return { applied: false };
  }

  const backgroundR = median(opaque.map((index) => data[index * 4]));
  const backgroundG = median(opaque.map((index) => data[index * 4 + 1]));
  const backgroundB = median(opaque.map((index) => data[index * 4 + 2]));

  const nearBackground = (index: number, tolerance: number): boolean => {
    const offset = index * 4;
    return (
      Math.abs(data[offset] - backgroundR) <= tolerance &&
      Math.abs(data[offset + 1] - backgroundG) <= tolerance &&
      Math.abs(data[offset + 2] - backgroundB) <= tolerance
    );
  };

  // Already-transparent pixels are background by definition — they must not
  // count against the field's solidity, nor dam the fill.
  const isBackground = (index: number, tolerance: number): boolean =>
    data[index * 4 + 3] === 0 || nearBackground(index, tolerance);

  let matching = 0;
  for (const index of border) {
    if (isBackground(index, SOLID_TOLERANCE)) matching += 1;
  }
  if (matching < border.length * SOLID_RATIO) return { applied: false };

  // Seeded from the border and nowhere else, so an enclosed light area — the
  // hole in a letter, a window inside the mark — survives the cut.
  const pixels = width * height;
  const cleared = new Uint8Array(pixels);
  const queue = new Uint32Array(pixels);
  let head = 0;
  let tail = 0;

  const enqueue = (index: number): void => {
    if (cleared[index] || !isBackground(index, FILL_TOLERANCE)) return;
    cleared[index] = 1;
    queue[tail++] = index;
  };

  for (const index of border) enqueue(index);

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index + width < pixels) enqueue(index + width);
  }

  let applied = false;
  for (let index = 0; index < pixels; index += 1) {
    if (!cleared[index]) continue;
    if (data[index * 4 + 3] !== 0) applied = true;
    data[index * 4 + 3] = 0;
  }

  // One pass, read off the finished mask, so the softening cannot cascade
  // inward from its own output.
  for (let index = 0; index < pixels; index += 1) {
    if (cleared[index]) continue;
    if (data[index * 4 + 3] <= FEATHER_ALPHA) continue;
    if (!nearBackground(index, FEATHER_TOLERANCE)) continue;

    const x = index % width;
    const touchesCut =
      (x > 0 && cleared[index - 1] === 1) ||
      (x < width - 1 && cleared[index + 1] === 1) ||
      (index >= width && cleared[index - width] === 1) ||
      (index + width < pixels && cleared[index + width] === 1);
    if (!touchesCut) continue;

    data[index * 4 + 3] = FEATHER_ALPHA;
    applied = true;
  }

  return { applied };
}

export interface BackgroundRemoval extends BackgroundRemovalResult {
  /** The cut image when something was removed, otherwise the original file. */
  blob: Blob;
}

/**
 * Browser wrapper: decode, cut, re-encode as PNG.
 *
 * Deliberately thin — every decision lives in the pure function above. Returns
 * the untouched original whenever nothing was removed and nothing was resized,
 * so a background this cannot cut costs the operator neither fidelity nor a
 * needless re-encode. A file that will not decode at all comes back unchanged
 * rather than failing the upload: removal is invisible, including when it
 * cannot happen.
 */
export async function removeSolidBackground(
  file: File
): Promise<BackgroundRemoval> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { blob: file, applied: false };
  }

  try {
    const scale = Math.min(
      1,
      MAX_EDGE / Math.max(bitmap.width, bitmap.height)
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { blob: file, applied: false };

    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const { applied } = removeSolidBackgroundFromPixels(
      image.data,
      width,
      height
    );
    if (!applied && scale === 1) return { blob: file, applied: false };

    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    return blob ? { blob, applied } : { blob: file, applied: false };
  } finally {
    bitmap.close();
  }
}
