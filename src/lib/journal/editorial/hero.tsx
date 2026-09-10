import "server-only";

import { ImageResponse } from "next/og";
import sharp from "sharp";
import { loadSocialFonts } from "../../social/render/fonts";
import { SOCIAL_FONTS, SOCIAL_THEME } from "../../social/render/theme";

export const JOURNAL_HERO_VERSION = "journal-hero-2026-09-10-v1" as const;
export const JOURNAL_HERO_WIDTH = 1200;
export const JOURNAL_HERO_HEIGHT = 630;

/**
 * Raster tokens for the journal plate. ImageResponse cannot resolve the
 * product CSS variables, so every value is the canonical OPS value from
 * ops-design-system/project/DESIGN.md (canvas, text ladder, hairline, type
 * families), reusing the social artifact tokens where they already exist.
 *
 * Composition, measured against every crop the public surfaces apply:
 * - ops-site's article header is full-bleed at 50 vh with a white fade over
 *   its lower half, so on a wide screen only y 127–503 shows and anything
 *   below ~y 320 washes out;
 * - on a phone the same header keeps the full height but only the centre
 *   strip x 312–888;
 * - the journal index card is 16:10, cutting 96 px from each side.
 * The one line that matters therefore sits in x 328–884, y 140–320. Category
 * and date are printed beside the image on every surface, so the plate does
 * not repeat them.
 */
export const JOURNAL_HERO = {
  canvas: SOCIAL_THEME.canvas,
  text: SOCIAL_THEME.text,
  mute: SOCIAL_THEME.textMute,
  line: SOCIAL_THEME.line,
  rule: 1,
  markX: 112,
  markTop: 72,
  mark: 40,
  dividerX: 288,
  frameTop: 72,
  frameBottom: 72,
  lineX: 328,
  lineWidth: 556,
  lineTop: 140,
  label: 20,
  labelTracking: "0.16em",
  eyebrowGap: 22,
  display: { tight: 56, standard: 48, long: 42 },
  displaySteps: { standard: 30, long: 45 },
  displayLeading: 1.04,
  displayTracking: "-0.02em",
} as const;

// ops-design-system/project/assets/ops-mark.svg; currentColor → text token.
const MARK_PATHS = [
  "M1624.48,1228.51v-563.59s-375.6-187.86-375.6-187.86h0l-281.73,140.87.16.08,469.34,234.72v469.62s.07.04.07.04l187.78-93.89Z",
  "M1432.95,1775.53l.03-.02v-.08l-469.49-234.8-.13-469.56-187.37,93.85-.15.08-.33,563.39.15.08,375.54,187.82.1.06,281.64-140.81Z",
];

export interface JournalHeroInput {
  heroLine: string;
}

/** Cake Mono is set by size, never by weight, so a longer line steps down. */
export function heroDisplaySize(line: string): number {
  const length = line.trim().length;
  if (length > JOURNAL_HERO.displaySteps.long) return JOURNAL_HERO.display.long;
  if (length > JOURNAL_HERO.displaySteps.standard) return JOURNAL_HERO.display.standard;
  return JOURNAL_HERO.display.tight;
}

export function JournalHeroPlate({ heroLine }: JournalHeroInput) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        backgroundColor: JOURNAL_HERO.canvas,
      }}
    >
      <svg
        width={JOURNAL_HERO.mark}
        height={JOURNAL_HERO.mark}
        viewBox="600 400 1200 1600"
        fill={JOURNAL_HERO.text}
        style={{ position: "absolute", left: JOURNAL_HERO.markX, top: JOURNAL_HERO.markTop }}
      >
        {MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>

      {/* The one structural hairline. */}
      <div
        style={{
          position: "absolute",
          left: JOURNAL_HERO.dividerX,
          top: JOURNAL_HERO.frameTop,
          bottom: JOURNAL_HERO.frameBottom,
          width: JOURNAL_HERO.rule,
          backgroundColor: JOURNAL_HERO.line,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: JOURNAL_HERO.lineX,
          top: JOURNAL_HERO.lineTop,
          width: JOURNAL_HERO.lineWidth,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            marginBottom: JOURNAL_HERO.eyebrowGap,
            color: JOURNAL_HERO.mute,
            fontFamily: SOCIAL_FONTS.mono,
            fontSize: JOURNAL_HERO.label,
            letterSpacing: JOURNAL_HERO.labelTracking,
            textTransform: "uppercase",
          }}
        >
          {"// OPS JOURNAL"}
        </div>
        <div
          style={{
            display: "flex",
            color: JOURNAL_HERO.text,
            fontFamily: SOCIAL_FONTS.display,
            fontSize: heroDisplaySize(heroLine),
            lineHeight: JOURNAL_HERO.displayLeading,
            letterSpacing: JOURNAL_HERO.displayTracking,
            textTransform: "uppercase",
          }}
        >
          {heroLine.trim()}
        </div>
      </div>
    </div>
  );
}

export interface RenderedJournalHero {
  buffer: Buffer;
  width: number;
  height: number;
  contentType: "image/jpeg";
}

export async function renderJournalHero(input: JournalHeroInput): Promise<RenderedJournalHero> {
  const response = new ImageResponse(<JournalHeroPlate {...input} />, {
    width: JOURNAL_HERO_WIDTH,
    height: JOURNAL_HERO_HEIGHT,
    fonts: await loadSocialFonts(),
  });
  const png = Buffer.from(await response.arrayBuffer());
  const buffer = await sharp(png)
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
  return {
    buffer,
    width: JOURNAL_HERO_WIDTH,
    height: JOURNAL_HERO_HEIGHT,
    contentType: "image/jpeg",
  };
}
