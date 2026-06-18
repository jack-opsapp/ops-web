// SINGLE SOURCE OF TRUTH for the catalog-setup trade tokens.
//
// Consumed by BOTH:
//   1. the wizard source/template trade picker (spec §8, §9, Phase 2), and
//   2. the `projects.trade` CHECK migration (Phase 0 Task 0.3).
// Keeping one list means the picker and the DB constraint can never drift apart.
//
// Tokens are STABLE lowercase snake_case slugs. `projects.trade` is read by the
// shipped iOS app, so a token can never be renamed — only appended. The three
// legacy tokens (roofing/hvac/plumbing) lead the list so the CHECK widening is
// purely additive (every value old iOS can emit still validates).
//
// `presetKey` points at the closest `INDUSTRY_PRESETS` family (a human-readable
// key in `@/lib/data/industry-presets`) so the template lane can seed starter
// task types per trade. Every trade resolves to a real preset — no dead option.

/** The locked trade tokens (spec §9). Legacy three first → additive CHECK. */
export const WIZARD_TRADE_IDS = [
  "roofing",
  "hvac",
  "plumbing",
  "electrical",
  "flooring",
  "masonry",
  "drywall",
  "concrete",
  "cleaning",
  "windows_and_doors",
  "general",
] as const;

/** Stable trade token stored in `projects.trade` (iOS-shared, unrenameable). */
export type WizardTradeId = (typeof WIZARD_TRADE_IDS)[number];

export interface WizardTrade {
  /** Stable slug written to `projects.trade`. */
  id: WizardTradeId;
  /** Human-facing display label (UI applies UPPERCASE for the picker). */
  label: string;
  /** Closest `INDUSTRY_PRESETS` family key for template seeding. */
  presetKey: string;
}

/**
 * The trade catalog. `label` is the display string; `presetKey` is a real key
 * in `INDUSTRY_PRESETS` (verified by the trade-list test, which asserts every
 * entry resolves to a defined preset).
 */
export const WIZARD_TRADES: readonly WizardTrade[] = [
  { id: "roofing", label: "Roofing", presetKey: "Roofing" },
  { id: "hvac", label: "HVAC", presetKey: "HVAC" },
  { id: "plumbing", label: "Plumbing", presetKey: "Plumbing" },
  { id: "electrical", label: "Electrical", presetKey: "Electrical" },
  { id: "flooring", label: "Flooring", presetKey: "Flooring" },
  { id: "masonry", label: "Masonry", presetKey: "Masonry" },
  { id: "drywall", label: "Drywall", presetKey: "Drywall" },
  { id: "concrete", label: "Concrete", presetKey: "Concrete Finishing" },
  { id: "cleaning", label: "Cleaning", presetKey: "House Cleaning" },
  {
    id: "windows_and_doors",
    label: "Windows & doors",
    presetKey: "Windows",
  },
  { id: "general", label: "General", presetKey: "General Contracting" },
];

const TRADE_BY_ID: Readonly<Record<WizardTradeId, WizardTrade>> =
  Object.fromEntries(WIZARD_TRADES.map((t) => [t.id, t])) as Record<
    WizardTradeId,
    WizardTrade
  >;

/** Narrowing guard: is an arbitrary string one of the locked trade tokens? */
export function isWizardTrade(value: string): value is WizardTradeId {
  return Object.prototype.hasOwnProperty.call(TRADE_BY_ID, value);
}

/** Display label for a trade token (e.g. `windows_and_doors` → "Windows & doors"). */
export function getTradeLabel(id: WizardTradeId): string {
  return TRADE_BY_ID[id].label;
}
