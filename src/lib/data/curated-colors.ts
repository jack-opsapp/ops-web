/**
 * Centralized OPS color system.
 * Single source of truth for every color picker in the app.
 *
 * Two palettes:
 *   CURATED_COLORS — 35 desaturated pastels for task type labels (grouped by family)
 *   ACCENT_COLORS  — 16 mid-saturation colors for UI accents, portal branding, personalization
 *
 * Names pulled from the job site — materials, weather, textures.
 */

export interface CuratedColor {
  hex: string;
  name: string;
  family: ColorFamily;
}

export type ColorFamily =
  | "neutral"
  | "warm"
  | "cool"
  | "earth"
  | "muted";

/**
 * Tag → color family mapping.
 * Used by auto-assignment logic to pick colors based on task type tags.
 */
export const TAG_TO_FAMILY: Record<string, ColorFamily> = {
  // Neutral family
  assessment: "neutral",
  permitting: "neutral",
  documentation: "neutral",
  coordination: "neutral",
  monitoring: "neutral",
  // Warm family
  "site-prep": "warm",
  demolition: "warm",
  repair: "warm",
  treatment: "warm",
  emergency: "warm",
  // Cool family
  "rough-in": "cool",
  framing: "cool",
  installation: "cool",
  plumbing: "cool",
  electrical: "cool",
  "equipment-set": "cool",
  // Earth family
  finishing: "earth",
  grouting: "earth",
  curing: "earth",
  "trim-out": "earth",
  forming: "earth",
  // Muted family
  inspection: "muted",
  testing: "muted",
  commissioning: "muted",
  cleanup: "muted",
  "follow-up": "muted",
};

/**
 * The curated palette — 35 colors across 5 families.
 */
export const CURATED_COLORS: CuratedColor[] = [
  // ── Warm family (reds, terracotta, brown) ──
  // Demolition, excavation, site prep
  { hex: "#C79A95", name: "Fired Clay", family: "warm" },
  { hex: "#A0837F", name: "Worn Saddle", family: "warm" },
  { hex: "#8B534E", name: "Rust", family: "warm" },
  { hex: "#A47864", name: "Terra", family: "warm" },
  { hex: "#B7788D", name: "Dusk", family: "warm" },
  { hex: "#7A6455", name: "Timber", family: "warm" },
  { hex: "#716354", name: "Ironbark", family: "warm" },

  // ── Neutral family (sand, olive, gold) ──
  // Planning, permitting, admin
  { hex: "#E7CCB8", name: "Sandstone", family: "neutral" },
  { hex: "#C4B2A2", name: "Limestone", family: "neutral" },
  { hex: "#C4A998", name: "Adobe", family: "neutral" },
  { hex: "#A79473", name: "Rawhide", family: "neutral" },
  { hex: "#97896A", name: "Field Sage", family: "neutral" },
  { hex: "#948674", name: "Quarry", family: "neutral" },
  { hex: "#8B8A77", name: "Lichen", family: "neutral" },

  // ── Earth family (greens, teals) ──
  // Landscaping, mechanical, HVAC
  { hex: "#B9BEAA", name: "Morning Fog", family: "earth" },
  { hex: "#BBBE9F", name: "New Growth", family: "earth" },
  { hex: "#73806E", name: "Patina", family: "earth" },
  { hex: "#6F9587", name: "Verdigris", family: "earth" },
  { hex: "#636F65", name: "Deep Forest", family: "earth" },
  { hex: "#7B8070", name: "Moss", family: "earth" },
  { hex: "#48929B", name: "Oxidized Copper", family: "earth" },

  // ── Cool family (blues, lavenders) ──
  // Electrical, plumbing, finish work
  { hex: "#89C3EB", name: "Clear Sky", family: "cool" },
  { hex: "#5D8CAE", name: "Steel Blue", family: "cool" },
  { hex: "#7E9EA0", name: "Weathered Zinc", family: "cool" },
  { hex: "#90A0A6", name: "Overcast", family: "cool" },
  { hex: "#8595AA", name: "Blue Haze", family: "cool" },
  { hex: "#8990A3", name: "Drift", family: "cool" },
  { hex: "#89729E", name: "Last Light", family: "cool" },

  // ── Muted family (grays, stone) ──
  // Inspection, testing, cleanup, overhead
  { hex: "#979CA0", name: "Pewter", family: "muted" },
  { hex: "#949495", name: "Raw Concrete", family: "muted" },
  { hex: "#748284", name: "Gunmetal", family: "muted" },
  { hex: "#807F79", name: "Gravel", family: "muted" },
  { hex: "#AF9C8B", name: "Mortar", family: "muted" },
  { hex: "#847B77", name: "Flint", family: "muted" },
  { hex: "#7A8E8D", name: "Slate", family: "muted" },
];

/** Get colors filtered by family */
export function getColorsByFamily(family: ColorFamily): CuratedColor[] {
  return CURATED_COLORS.filter((c) => c.family === family);
}

/** Get the best family for a set of tags */
export function getFamilyForTags(tags: string[]): ColorFamily {
  const familyCounts: Record<ColorFamily, number> = {
    neutral: 0,
    warm: 0,
    cool: 0,
    earth: 0,
    muted: 0,
  };
  for (const tag of tags) {
    const family = TAG_TO_FAMILY[tag];
    if (family) familyCounts[family]++;
  }
  let best: ColorFamily = "cool";
  let bestCount = 0;
  for (const [family, count] of Object.entries(familyCounts)) {
    if (count > bestCount) {
      best = family as ColorFamily;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Auto-assign colors to a list of task type entries.
 * Assigns from the matching family, cycling through available colors.
 */
export function autoAssignColors(
  taskTypes: Array<{ name: string; tags: string[] }>
): Array<{ name: string; tags: string[]; color: string }> {
  const familyIndex: Record<ColorFamily, number> = {
    neutral: 0,
    warm: 0,
    cool: 0,
    earth: 0,
    muted: 0,
  };

  return taskTypes.map((tt) => {
    const family = getFamilyForTags(tt.tags);
    const familyColors = getColorsByFamily(family);
    const idx = familyIndex[family] % familyColors.length;
    familyIndex[family]++;
    return { ...tt, color: familyColors[idx].hex };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCENT COLORS — UI highlights, portal branding, personalization
// Mid-saturation colors that work as button fills, active states, and links.
// ═══════════════════════════════════════════════════════════════════════════════

export type AccentColorId =
  | "steel-blue"
  | "slate"
  | "harbor"
  | "pewter"
  | "sage"
  | "olive"
  | "brick-dust"
  | "pumice"
  | "silt"
  | "sandstone"
  | "straw"
  | "ash"
  | "terracotta"
  | "driftwood"
  | "amber"
  | "charcoal";

export interface AccentColor {
  id: AccentColorId;
  hex: string;
  name: string;
}

export const ACCENT_COLORS: AccentColor[] = [
  { id: "steel-blue",  hex: "#417394", name: "Steel Blue" },
  { id: "slate",       hex: "#7A8B99", name: "Slate" },
  { id: "harbor",      hex: "#8FA7B8", name: "Harbor" },
  { id: "pewter",      hex: "#6B7D8D", name: "Pewter" },
  { id: "sage",        hex: "#7D9B76", name: "Sage" },
  { id: "olive",       hex: "#8A8D65", name: "Olive" },
  { id: "brick-dust",  hex: "#C2858A", name: "Brick Dust" },
  { id: "pumice",      hex: "#B08B96", name: "Pumice" },
  { id: "silt",        hex: "#C9A5A5", name: "Silt" },
  { id: "sandstone",   hex: "#B8A68E", name: "Sandstone" },
  { id: "straw",       hex: "#C4AA82", name: "Straw" },
  { id: "ash",         hex: "#A89889", name: "Ash" },
  { id: "terracotta",  hex: "#B5856A", name: "Terracotta" },
  { id: "driftwood",   hex: "#9E8E78", name: "Driftwood" },
  { id: "amber",       hex: "#C4A868", name: "Amber" },
  { id: "charcoal",    hex: "#5A5A5A", name: "Charcoal" },
];

/** Accent color hex lookup by ID */
export const ACCENT_COLOR_VALUES: Record<AccentColorId, string> =
  Object.fromEntries(ACCENT_COLORS.map((c) => [c.id, c.hex])) as Record<AccentColorId, string>;

/**
 * Map old accent color IDs to current ones.
 * Used by preferences-store migration when users have stale IDs in localStorage.
 */
export const ACCENT_ID_MIGRATION: Record<string, AccentColorId> = {
  "mist": "harbor",
  "dusty-rose": "brick-dust",
  "mauve": "pumice",
  "blush": "silt",
  "quicksand": "straw",
  "warm-taupe": "ash",
  "amber-gold": "amber",
  // These kept the same ID:
  // steel-blue, slate, pewter, sage, olive, sandstone, terracotta, driftwood, charcoal
};
