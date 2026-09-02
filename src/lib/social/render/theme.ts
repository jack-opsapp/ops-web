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
