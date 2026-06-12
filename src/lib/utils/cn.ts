import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * OPS custom type-scale tokens (tailwind.config.ts `fontSize`).
 *
 * Without this registration tailwind-merge cannot tell `text-micro`
 * (a font size) from `text-text-3` (a color) — both fall into its
 * color group, so whenever a size token and a color token meet inside
 * cn() the later class silently DELETES the size and text renders at
 * the 16px browser default. (Caught live on /books 2026-06-12: table
 * headers, filter chips, and the period pill all lost `text-micro`.)
 * Keep in sync with the config's fontSize block.
 */
const FONT_SIZE_TOKENS = [
  "display-lg",
  "display",
  "heading",
  "body-lg",
  "body",
  "body-sm",
  "caption",
  "caption-bold",
  "caption-sm",
  "micro",
  "micro-sm",
  "micro-xs",
  "card-title",
  "card-subtitle",
  "card-body",
  "button",
  "button-sm",
  "status",
  "data-lg",
  "data",
  "data-sm",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: FONT_SIZE_TOKENS }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
