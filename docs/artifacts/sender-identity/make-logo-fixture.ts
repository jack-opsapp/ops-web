/**
 * Builds the background-removal evidence for the sender-identity artifacts.
 *
 * Renders a real PNG logo on a solid white field, runs the shipped removal core
 * over it — the same module the browser calls — and writes:
 *
 *   logo-source-white-bg.png                 the file an operator would upload
 *   logo-cut-transparent.png                 what comes back out
 *   11-background-removal-before-after.png   the two side by side, the cut one
 *                                            over a checkerboard so the
 *                                            transparency is actually visible
 *
 * Run from the repo root:
 *   npx tsx docs/artifacts/sender-identity/make-logo-fixture.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { removeSolidBackgroundFromPixels } from "../../../src/lib/images/remove-solid-background";

const OUT = path.resolve(process.cwd(), "docs/artifacts/sender-identity");
const W = 360;
const H = 200;

// SVG so the renderer anti-aliases the edges the way a real logo file is
// anti-aliased — that rim is what the feather exists for. The ring is closed
// on purpose: its counter is white, enclosed, and must survive the cut.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <circle cx="80" cy="100" r="46" fill="none" stroke="#1f2933" stroke-width="16"/>
  <rect x="150" y="68" width="176" height="20" fill="#1f2933"/>
  <rect x="150" y="102" width="128" height="12" fill="#1f2933"/>
  <rect x="150" y="124" width="96" height="12" fill="#1f2933"/>
</svg>`;

function rgba(png: Buffer, index: number): number[] {
  return [png[index], png[index + 1], png[index + 2], png[index + 3]];
}

async function main() {
  const sourcePng = await sharp(Buffer.from(SVG)).png().toBuffer();
  writeFileSync(path.join(OUT, "logo-source-white-bg.png"), sourcePng);

  const source = await sharp(sourcePng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = source.info;

  const cut = Buffer.from(source.data);
  const { applied } = removeSolidBackgroundFromPixels(
    new Uint8ClampedArray(cut.buffer, cut.byteOffset, cut.length),
    width,
    height
  );

  let clear = 0;
  let feathered = 0;
  for (let i = 3; i < cut.length; i += 4) {
    if (cut[i] === 0) clear += 1;
    else if (cut[i] < 255) feathered += 1;
  }

  const cutPng = await sharp(cut, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  writeFileSync(path.join(OUT, "logo-cut-transparent.png"), cutPng);

  // ── Side by side ─────────────────────────────────────────────────────────
  const GAP = 16;
  const CHECK = 8;
  const boardWidth = width * 2 + GAP;
  const board = Buffer.alloc(boardWidth * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < boardWidth; x += 1) {
      const at = (y * boardWidth + x) * 4;
      board[at] = 24;
      board[at + 1] = 24;
      board[at + 2] = 26;
      board[at + 3] = 255;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const left = (y * boardWidth + x) * 4;
      board[left] = source.data[from];
      board[left + 1] = source.data[from + 1];
      board[left + 2] = source.data[from + 2];
      board[left + 3] = 255;

      // Right panel: the cut image alpha-blended onto a checkerboard, which is
      // the only way transparency reads in a flat screenshot.
      const light = (Math.floor(x / CHECK) + Math.floor(y / CHECK)) % 2 === 0;
      const base = light ? 210 : 170;
      const alpha = cut[from + 3] / 255;
      const right = (y * boardWidth + x + width + GAP) * 4;
      board[right] = Math.round(cut[from] * alpha + base * (1 - alpha));
      board[right + 1] = Math.round(cut[from + 1] * alpha + base * (1 - alpha));
      board[right + 2] = Math.round(cut[from + 2] * alpha + base * (1 - alpha));
      board[right + 3] = 255;
    }
  }

  writeFileSync(
    path.join(OUT, "11-background-removal-before-after.png"),
    await sharp(board, {
      raw: { width: boardWidth, height, channels: 4 },
    })
      .png()
      .toBuffer()
  );

  // eslint-disable-next-line no-console -- the report IS this script's output
  console.log(
    JSON.stringify(
      {
        applied,
        width,
        height,
        total: width * height,
        clear,
        feathered,
        cornerAlpha: cut[3],
        // Inside a wordmark bar, and inside the ring's enclosed counter — the
        // second is the one an edge-seeded fill has to leave alone.
        markAlpha: rgba(cut, (78 * width + 200) * 4)[3],
        counterAlpha: rgba(cut, (100 * width + 80) * 4)[3],
        sourceBytes: sourcePng.length,
        cutBytes: cutPng.length,
      },
      null,
      2
    )
  );
}

void main();
