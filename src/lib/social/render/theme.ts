/**
 * Fixed social-artifact tokens. ImageResponse cannot resolve the product CSS
 * variables, so the canonical OPS values are centralized here instead of
 * repeated inside treatment components.
 */
export const SOCIAL_THEME = {
  canvas: "#000000",
  text: "#EDEDED",
  textSecondary: "#B5B5B5",
  textTertiary: "#8A8A8A",
  textMute: "#6A6A6A",
  line: "rgba(255,255,255,0.10)",
  glass: "rgba(18,18,20,0.78)",
  input: "rgba(255,255,255,0.04)",
  editorialFade:
    "linear-gradient(180deg, rgba(0,0,0,0) 28%, rgba(0,0,0,0.18) 44%, rgba(0,0,0,0.72) 68%, rgba(0,0,0,0.96) 86%, #000000 100%)",
  olive: "#9DB582",
  tan: "#C4A868",
  rose: "#B58289",
  agent: "#8A7FB8",
} as const;

export const SOCIAL_FONTS = {
  display: "Cake Mono",
  body: "Mohave",
  mono: "JetBrains Mono",
} as const;

/**
 * Raster type scale. Sizes step down by copy length so a 100-character
 * headline and a 350-character body — the contract maximums — still sit
 * inside the 1080x1350 frame.
 */
export const SOCIAL_TYPE = {
  coverHeadline: 76,
  coverHeadlineLong: 62,
  slideHeadline: 64,
  slideHeadlineLong: 52,
  fieldHeadline: 57,
  fieldHeadlineLong: 46,
  body: 34,
  bodyLong: 30,
  eyebrow: 22,
  counter: 22,
  url: 30,
  urlWide: 40,
  mark: 26,
  subtitle: 34,
} as const;

/** Raster spacing scale. */
export const SOCIAL_SPACE = {
  frameX: 62,
  frameTop: 58,
  frameBottom: 48,
  eyebrowGap: 28,
  headlineGap: 34,
  ruleGap: 40,
  headerHeight: 48,
  headerGap: 20,
  footerHeight: 50,
  footerGap: 20,
  slideX: 34,
  slideTop: 54,
  slideBottom: 44,
  coverX: 40,
  coverBottom: 56,
  ruleWidth: 170,
  panelTop: 34,
  panelBottom: 36,
  splitTop: 42,
  splitBottom: 38,
  splitGap: 34,
  splitPanelInset: 74,
  proofX: 26,
  roastX: 24,
} as const;

/** Typographic ratios. Mono micro labels track wide; display type tracks tight. */
export const SOCIAL_TRACKING = {
  label: "0.16em",
  labelTight: "0.12em",
  display: "-0.025em",
  url: "0.01em",
} as const;

export const SOCIAL_LEADING = {
  display: 0.98,
  body: 1.25,
  url: 1.3,
  flush: 1,
} as const;

/** Copy-length thresholds that drive the type steps above. */
export const SOCIAL_TYPE_STEPS = {
  headlineLong: 44,
  bodyLong: 200,
  urlWide: 34,
} as const;

/** Raster border + radius scale. */
export const SOCIAL_LINE = { hairline: 1, rule: 3 } as const;
export const SOCIAL_RADIUS = { panel: 10 } as const;
