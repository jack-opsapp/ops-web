/**
 * Curated color palette for task types.
 * Colors sourced from real paint companies — desaturated pastels
 * that read well against the OPS dark theme (#0A0A0A background).
 *
 * Organized into 5 families for auto-assignment based on task tags.
 */

export interface CuratedColor {
  hex: string;
  name: string;
  source: string;
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
 * All hex codes verified against encycolorpedia.com, hextoral.com, color-name.com.
 */
export const CURATED_COLORS: CuratedColor[] = [
  // ── Warm Earth family (reds, terracotta, brown) ──
  // Suggested: demolition, excavation, site prep tasks
  { hex: "#C79A95", name: "Cinder Rose", source: "Farrow & Ball", family: "warm" },
  { hex: "#A0837F", name: "Sulking Room Pink", source: "Farrow & Ball", family: "warm" },
  { hex: "#8B534E", name: "Toile Red", source: "Sherwin-Williams", family: "warm" },
  { hex: "#A47864", name: "Mocha Mousse", source: "Pantone", family: "warm" },
  { hex: "#B7788D", name: "Rangwali", source: "Farrow & Ball", family: "warm" },
  { hex: "#7A6455", name: "Cobble Brown", source: "Sherwin-Williams", family: "warm" },
  { hex: "#716354", name: "Smokehouse", source: "Sherwin-Williams", family: "warm" },

  // ── Warm Neutral family (sand, olive, gold) ──
  // Suggested: planning, permitting, administrative tasks
  { hex: "#E7CCB8", name: "Raleigh Peach", source: "Benjamin Moore", family: "neutral" },
  { hex: "#C4B2A2", name: "Jitney", source: "Farrow & Ball", family: "neutral" },
  { hex: "#C4A998", name: "Dead Salmon", source: "Farrow & Ball", family: "neutral" },
  { hex: "#A79473", name: "Roycroft Suede", source: "Sherwin-Williams", family: "neutral" },
  { hex: "#97896A", name: "Renwick Olive", source: "Sherwin-Williams", family: "neutral" },
  { hex: "#948674", name: "Kingsport Gray", source: "Benjamin Moore", family: "neutral" },
  { hex: "#8B8A77", name: "Treron", source: "Farrow & Ball", family: "neutral" },

  // ── Cool Green & Teal family ──
  // Suggested: landscaping, environmental, mechanical/HVAC tasks
  { hex: "#B9BEAA", name: "Pigeon", source: "Farrow & Ball", family: "earth" },
  { hex: "#BBBE9F", name: "Vert De Terre", source: "Farrow & Ball", family: "earth" },
  { hex: "#73806E", name: "Card Room Green", source: "Farrow & Ball", family: "earth" },
  { hex: "#6F9587", name: "Spotswood Teal", source: "Benjamin Moore", family: "earth" },
  { hex: "#636F65", name: "Green Smoke", source: "Farrow & Ball", family: "earth" },
  { hex: "#7B8070", name: "Dried Thyme", source: "Sherwin-Williams", family: "earth" },
  { hex: "#48929B", name: "Asagi-iro", source: "Japanese Traditional", family: "earth" },

  // ── Cool Blue & Lavender family ──
  // Suggested: electrical, plumbing, finish/inspection tasks
  { hex: "#89C3EB", name: "Wasurenagusa-iro", source: "Japanese Traditional", family: "cool" },
  { hex: "#5D8CAE", name: "Gunjou-iro", source: "Japanese Traditional", family: "cool" },
  { hex: "#7E9EA0", name: "Wythe Blue", source: "Benjamin Moore", family: "cool" },
  { hex: "#90A0A6", name: "Debonair", source: "Sherwin-Williams", family: "cool" },
  { hex: "#8595AA", name: "Dried Lavender", source: "Sherwin-Williams", family: "cool" },
  { hex: "#8990A3", name: "Dusty Heather", source: "Sherwin-Williams", family: "cool" },
  { hex: "#89729E", name: "Fuji-iro", source: "Japanese Traditional", family: "cool" },

  // ── Neutral Gray & Stone family ──
  // Suggested: general overhead, travel, meetings, untyped tasks
  { hex: "#979CA0", name: "Plummett", source: "Farrow & Ball", family: "muted" },
  { hex: "#949495", name: "Nezumi-iro", source: "Japanese Traditional", family: "muted" },
  { hex: "#748284", name: "De Nimes", source: "Farrow & Ball", family: "muted" },
  { hex: "#807F79", name: "Geddy Gray", source: "Benjamin Moore", family: "muted" },
  { hex: "#AF9C8B", name: "Dove Tale", source: "Farrow & Ball", family: "muted" },
  { hex: "#847B77", name: "Mink", source: "Sherwin-Williams", family: "muted" },
  { hex: "#7A8E8D", name: "Oval Room Blue", source: "Farrow & Ball", family: "muted" },
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
