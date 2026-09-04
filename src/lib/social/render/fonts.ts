import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface SocialFont {
  name: string;
  data: ArrayBuffer;
  weight: 300 | 400;
  style: "normal";
}

let fontPromise: Promise<SocialFont[]> | null = null;

function exactArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

export function loadSocialFonts(): Promise<SocialFont[]> {
  if (fontPromise) return fontPromise;

  fontPromise = Promise.all([
    readFile(join(process.cwd(), "public/fonts/CakeMono-Light.woff")),
    readFile(join(process.cwd(), "public/fonts/Mohave-Regular.ttf")),
    readFile(join(process.cwd(), "public/fonts/JetBrainsMono-Regular.ttf")),
  ]).then(([cakeMono, mohave, jetBrainsMono]) => [
    { name: "Cake Mono", data: exactArrayBuffer(cakeMono), weight: 300, style: "normal" },
    { name: "Mohave", data: exactArrayBuffer(mohave), weight: 400, style: "normal" },
    {
      name: "JetBrains Mono",
      data: exactArrayBuffer(jetBrainsMono),
      weight: 400,
      style: "normal",
    },
  ]);

  return fontPromise;
}
