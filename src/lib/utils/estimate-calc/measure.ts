/**
 * Measurement and unit-conversion math for the line-item calculator.
 *
 * Every conversion routes through a single SI anchor per dimension, so there
 * is exactly one factor per unit to get wrong. The factors are the exact
 * international definitions, not decimal approximations.
 *
 * The `working` strings this module builds are English. They are the shown
 * work an operator reads back before inserting — the surrounding chrome is
 * localised through the `estimate-calculator` namespace, but the working
 * line is not, alongside the rest of the line-item editor's i18n debt.
 */

import { formatResult, roundForInsert } from "./expression";

// International yard and pound agreement, 1959 — exact by definition.
const METRES_PER_INCH = 0.0254;
const METRES_PER_FOOT = 0.3048;
const METRES_PER_YARD = 0.9144;
const METRES_PER_CENTIMETRE = 0.01;
const METRES_PER_METRE = 1;

export type LengthUnit = "in" | "ft" | "yd" | "cm" | "m";
export type AreaUnit = "sqft" | "sqyd" | "sqm";
export type VolumeUnit = "cuft" | "cuyd" | "m3";
export type MeasurementUnit = LengthUnit | AreaUnit | VolumeUnit;

export type UnitDimension = "length" | "area" | "volume";

/** The units an area result may be reported in. */
export type AreaOutputUnit = Extract<AreaUnit, "sqft" | "sqm">;
/** The units a linear result may be reported in. */
export type LinearOutputUnit = Extract<LengthUnit, "ft" | "m">;

export interface UnitGroup {
  dimension: UnitDimension;
  units: readonly MeasurementUnit[];
}

/** Dimension groups in display order — drives the CONVERT mode selects. */
export const UNIT_GROUPS: readonly UnitGroup[] = [
  { dimension: "length", units: ["in", "ft", "yd", "cm", "m"] },
  { dimension: "area", units: ["sqft", "sqyd", "sqm"] },
  { dimension: "volume", units: ["cuft", "cuyd", "m3"] },
];

/** English display forms, used in working strings and as select labels. */
export const UNIT_LABELS: Record<MeasurementUnit, string> = {
  in: "in",
  ft: "ft",
  yd: "yd",
  cm: "cm",
  m: "m",
  sqft: "sq ft",
  sqyd: "sq yd",
  sqm: "sq m",
  cuft: "cu ft",
  cuyd: "cu yd",
  m3: "m³",
};

const METRES_PER_LENGTH_UNIT: Record<LengthUnit, number> = {
  in: METRES_PER_INCH,
  ft: METRES_PER_FOOT,
  yd: METRES_PER_YARD,
  cm: METRES_PER_CENTIMETRE,
  m: METRES_PER_METRE,
};

// Area and volume factors are derived, never restated — a typo in a
// hand-written 10.7639 would be invisible until a quote was wrong.
const SQUARE_METRES_PER_AREA_UNIT: Record<AreaUnit, number> = {
  sqft: METRES_PER_FOOT ** 2,
  sqyd: METRES_PER_YARD ** 2,
  sqm: 1,
};

const CUBIC_METRES_PER_VOLUME_UNIT: Record<VolumeUnit, number> = {
  cuft: METRES_PER_FOOT ** 3,
  cuyd: METRES_PER_YARD ** 3,
  m3: 1,
};

const FACTORS_BY_DIMENSION: Record<UnitDimension, Record<string, number>> = {
  length: METRES_PER_LENGTH_UNIT,
  area: SQUARE_METRES_PER_AREA_UNIT,
  volume: CUBIC_METRES_PER_VOLUME_UNIT,
};

const DIMENSION_BY_UNIT: Record<string, UnitDimension> = Object.fromEntries(
  UNIT_GROUPS.flatMap((group) => group.units.map((unit) => [unit, group.dimension])),
);

export interface MeasurementResult {
  /** Rounded to two decimals — the number the operator inserts. */
  value: number;
  /** The shown work, or null when there is no math to show. */
  working: string | null;
}

export interface AreaInput {
  length: number;
  width: number;
  unit: LengthUnit;
  count?: number;
  wastePercent?: number;
  output: AreaOutputUnit;
}

export interface LinearInput {
  lengths: number[];
  unit: LengthUnit;
  wastePercent?: number;
  output: LinearOutputUnit;
}

/** Returns the dimension a unit belongs to. */
export function dimensionOf(unit: MeasurementUnit): UnitDimension {
  const dimension = DIMENSION_BY_UNIT[unit];
  if (!dimension) throw new Error(`Unknown unit: ${unit}`);
  return dimension;
}

/**
 * Converts a value between two units of the same dimension.
 *
 * Returns the raw quotient — rounding is the caller's decision, so that
 * chained math (an area built from two converted edges) never compounds a
 * rounding error. Binary representation means `12 in → ft` lands on
 * 0.9999999999999999; `formatResult` is what turns that back into `1`.
 */
export function convert(
  value: number,
  from: MeasurementUnit,
  to: MeasurementUnit,
): number {
  if (from === to) return value;

  const fromDimension = dimensionOf(from);
  const toDimension = dimensionOf(to);
  if (fromDimension !== toDimension) {
    throw new Error(
      `Cannot convert ${from} (${fromDimension}) to ${to} (${toDimension})`,
    );
  }

  const factors = FACTORS_BY_DIMENSION[fromDimension];
  return (value * factors[from]) / factors[to];
}

/**
 * Rejects anything that would silently produce a nonsense quantity. The UI
 * validates too; this is the backstop that makes the failure loud.
 */
function assertMeasurement(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative`);
  }
}

/** ` (+10% waste = 211.2)`, or nothing when there is no waste. */
function wasteSuffix(wastePercent: number, finalValue: number): string {
  if (wastePercent <= 0) return "";
  return ` (+${formatResult(wastePercent)}% waste = ${formatResult(finalValue)})`;
}

/**
 * Length × width, optionally repeated and padded with waste.
 *
 * Both edges are converted into the output's base length before multiplying,
 * so a metric pair reported in square feet is one conversion per edge rather
 * than a square-unit conversion after the fact.
 */
export function computeArea({
  length,
  width,
  unit,
  count = 1,
  wastePercent = 0,
  output,
}: AreaInput): MeasurementResult {
  assertMeasurement(length, "length");
  assertMeasurement(width, "width");
  assertMeasurement(count, "count");
  assertMeasurement(wastePercent, "waste");

  const baseUnit: LengthUnit = output === "sqft" ? "ft" : "m";
  const area =
    convert(length, unit, baseUnit) * convert(width, unit, baseUnit) * count;
  const withWaste = area * (1 + wastePercent / 100);

  const inputLabel = UNIT_LABELS[unit];
  const countPart = count === 1 ? "" : ` × ${formatResult(count)}`;
  const working =
    `${formatResult(length)} ${inputLabel} × ${formatResult(width)} ${inputLabel}` +
    `${countPart} = ${formatResult(area)} ${UNIT_LABELS[output]}` +
    wasteSuffix(wastePercent, withWaste);

  return { value: roundForInsert(withWaste), working };
}

/**
 * A run of lengths summed into a linear total, optionally padded with waste.
 */
export function computeLinear({
  lengths,
  unit,
  wastePercent = 0,
  output,
}: LinearInput): MeasurementResult {
  lengths.forEach((entry, index) => assertMeasurement(entry, `length ${index + 1}`));
  assertMeasurement(wastePercent, "waste");

  if (lengths.length === 0) {
    return { value: 0, working: null };
  }

  const total = lengths.reduce(
    (sum, entry) => sum + convert(entry, unit, output),
    0,
  );
  const withWaste = total * (1 + wastePercent / 100);

  const working =
    `${lengths.map((entry) => formatResult(entry)).join(" + ")} ${UNIT_LABELS[unit]}` +
    ` = ${formatResult(total)} lin ${UNIT_LABELS[output]}` +
    wasteSuffix(wastePercent, withWaste);

  return { value: roundForInsert(withWaste), working };
}
