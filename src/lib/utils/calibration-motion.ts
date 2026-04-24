/**
 * CALIBRATION motion tokens. Centralized so every component references the
 * same values. Matches system.md's EASE_SMOOTH. Durations picked per the
 * animation-architect skill's Entry/Discovery/Transition/Achievement beats.
 */

export const CAL_EASE = [0.22, 1, 0.36, 1] as const;

export const CAL_DURATIONS = {
  hover: 0.15,
  tileEnter: 0.2,
  drillInTransition: 0.3,
  /** seconds between tile entries */
  deckEntryStagger: 0.06,
  countUp: 0.8,
  ringFill: 1.0,
  barGrow: 0.4,
  recentRailInsert: 0.25,
  milestonePulse: 0.24,
} as const;

export const CAL_REDUCED = {
  tileEnter: 0.15,
  drillIn: 0.2,
  countUp: 0,
  ringFill: 0,
  barGrow: 0,
  recentRailInsert: 0.15,
  milestonePulse: 0.4,
} as const;
