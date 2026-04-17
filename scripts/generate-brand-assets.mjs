// OPS-Web/scripts/generate-brand-assets.mjs
// One-shot: regenerate all PNG brand assets from SVG sources.
// Run: npm run brand:generate

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRAND_DIR = path.join(ROOT, "public", "brand");
const APP_DIR = path.join(ROOT, "src", "app");

// ─── Sources ────────────────────────────────────────────────────────────────
const MARK_SVG = path.join(BRAND_DIR, "ops-mark.svg");
const LOCKUP_H_SVG = path.join(BRAND_DIR, "ops-lockup-horizontal.svg");

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Render an SVG as a square PNG with mark centered on a solid background. */
async function renderSquareIcon({
  svgPath,
  size,
  outPath,
  bgColor = "#000000",
  fgColor = "#FFFFFF",
  paddingRatio = 0.18,
}) {
  const svg = await fs.readFile(svgPath, "utf8");
  const coloredSvg = svg.replace(/currentColor/g, fgColor);

  const drawSize = Math.round(size * (1 - paddingRatio * 2));
  const offset = Math.round((size - drawSize) / 2);

  const markBuf = await sharp(Buffer.from(coloredSvg))
    .resize({
      width: drawSize,
      height: drawSize,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: bgColor },
  })
    .composite([{ input: markBuf, left: offset, top: offset }])
    .png({ quality: 95, compressionLevel: 9 })
    .toFile(outPath);

  console.log(`  ✓ ${path.relative(ROOT, outPath)} (${size}×${size})`);
}

/** Render a horizontal lockup onto a wide PNG (for emails, social, etc.). */
async function renderLockup({
  svgPath,
  width,
  outPath,
  bgColor = "#000000",
  fgColor = "#FFFFFF",
  paddingRatio = 0.12,
}) {
  const svg = await fs.readFile(svgPath, "utf8");
  const coloredSvg = svg.replace(/currentColor/g, fgColor);

  const lockupWidth = Math.round(width * (1 - paddingRatio * 2));
  // Horizontal lockup aspect: 2405.66 : 1511.21 → ~1.59:1
  const lockupHeight = Math.round(lockupWidth / (2405.66 / 1511.21));
  const height = Math.round(lockupHeight / (1 - paddingRatio * 2));
  const offsetX = Math.round((width - lockupWidth) / 2);
  const offsetY = Math.round((height - lockupHeight) / 2);

  const lockupBuf = await sharp(Buffer.from(coloredSvg))
    .resize({
      width: lockupWidth,
      fit: "inside",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp({
    create: { width, height, channels: 4, background: bgColor },
  })
    .composite([{ input: lockupBuf, left: offsetX, top: offsetY }])
    .png({ quality: 95, compressionLevel: 9 })
    .toFile(outPath);

  console.log(`  ✓ ${path.relative(ROOT, outPath)} (${width}×${height})`);
}

// ─── Manifest ───────────────────────────────────────────────────────────────
const TARGETS = [
  // Next.js file-convention icons (in src/app/)
  { kind: "icon", size: 64, out: path.join(APP_DIR, "icon.png") },
  { kind: "icon", size: 180, out: path.join(APP_DIR, "apple-icon.png") },
  // PWA manifest icons (in public/brand/)
  { kind: "icon", size: 192, out: path.join(BRAND_DIR, "icon-192.png") },
  { kind: "icon", size: 512, out: path.join(BRAND_DIR, "icon-512.png") },
  // Email header + social share (wide lockup)
  { kind: "lockup", width: 800, out: path.join(BRAND_DIR, "ops-lockup-email.png") },
];

// ─── Run ────────────────────────────────────────────────────────────────────
console.log("Generating OPS brand assets…");
for (const t of TARGETS) {
  if (t.kind === "icon") {
    await renderSquareIcon({ svgPath: MARK_SVG, size: t.size, outPath: t.out });
  } else if (t.kind === "lockup") {
    await renderLockup({ svgPath: LOCKUP_H_SVG, width: t.width, outPath: t.out });
  }
}
console.log("Done.");
