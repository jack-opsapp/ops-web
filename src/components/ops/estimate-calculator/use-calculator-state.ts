"use client";

import { useCallback, useMemo, useState } from "react";
import {
  evaluateExpression,
  type ExpressionError,
} from "@/lib/utils/estimate-calc/expression";
import {
  computeArea,
  computeLinear,
  convert,
  dimensionOf,
  UNIT_GROUPS,
  type AreaOutputUnit,
  type LengthUnit,
  type LinearOutputUnit,
  type MeasurementUnit,
} from "@/lib/utils/estimate-calc/measure";

export type CalculatorMode = "calc" | "area" | "linear" | "convert";

export const CALCULATOR_MODES: readonly CalculatorMode[] = [
  "calc",
  "area",
  "linear",
  "convert",
];

/** The units an operator measures in on site. Not the full conversion set. */
export const MEASUREMENT_UNITS: readonly LengthUnit[] = ["ft", "in", "m", "cm"];

export const AREA_OUTPUTS: readonly AreaOutputUnit[] = ["sqft", "sqm"];
export const LINEAR_OUTPUTS: readonly LinearOutputUnit[] = ["ft", "m"];

/**
 * What the panel is currently reporting.
 *
 * `value === null` with `error === null` is the untouched state — the readout
 * shows an em-dash, not a complaint about input the operator has not given yet.
 */
export interface CalculatorOutcome {
  value: number | null;
  working: string | null;
  error: ExpressionError | null;
}

const EMPTY_OUTCOME: CalculatorOutcome = { value: null, working: null, error: null };

interface AreaState {
  length: string;
  width: string;
  unit: LengthUnit;
  count: string;
  waste: string;
  output: AreaOutputUnit;
}

interface LinearState {
  lengths: string[];
  unit: LengthUnit;
  waste: string;
  output: LinearOutputUnit;
}

interface ConvertState {
  value: string;
  from: MeasurementUnit;
  to: MeasurementUnit;
}

const INITIAL_AREA: AreaState = {
  length: "",
  width: "",
  unit: "ft",
  count: "",
  waste: "",
  output: "sqft",
};

const INITIAL_LINEAR: LinearState = {
  lengths: [""],
  unit: "ft",
  waste: "",
  output: "ft",
};

const INITIAL_CONVERT: ConvertState = { value: "", from: "ft", to: "m" };

/** Blank or nonsense reads as "not supplied yet", never as zero. */
function parseField(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/** Blank falls back to the field's neutral value (no waste, one of a thing). */
function parseWithDefault(raw: string, fallback: number): number {
  return parseField(raw) ?? fallback;
}

export function unitsForDimension(unit: MeasurementUnit): readonly MeasurementUnit[] {
  const dimension = dimensionOf(unit);
  const group = UNIT_GROUPS.find((entry) => entry.dimension === dimension);
  return group?.units ?? [];
}

/**
 * Owns every mode's inputs and derives the one number the panel reports.
 *
 * All four modes stay in state while the popover is open, so switching to
 * CONVERT to check a supplier's metric price and switching back does not throw
 * away a half-entered deck measurement. Closing resets everything.
 */
export function useCalculatorState() {
  const [mode, setMode] = useState<CalculatorMode>("calc");
  const [expression, setExpression] = useState("");
  const [area, setArea] = useState<AreaState>(INITIAL_AREA);
  const [linear, setLinear] = useState<LinearState>(INITIAL_LINEAR);
  const [conversion, setConversion] = useState<ConvertState>(INITIAL_CONVERT);
  const [addToDescription, setAddToDescription] = useState(true);

  const reset = useCallback(() => {
    setMode("calc");
    setExpression("");
    setArea(INITIAL_AREA);
    setLinear(INITIAL_LINEAR);
    setConversion(INITIAL_CONVERT);
    setAddToDescription(true);
  }, []);

  const updateArea = useCallback((patch: Partial<AreaState>) => {
    setArea((previous) => ({ ...previous, ...patch }));
  }, []);

  const updateLinear = useCallback((patch: Partial<LinearState>) => {
    setLinear((previous) => ({ ...previous, ...patch }));
  }, []);

  const setLengthAt = useCallback((index: number, value: string) => {
    setLinear((previous) => {
      const lengths = [...previous.lengths];
      lengths[index] = value;
      return { ...previous, lengths };
    });
  }, []);

  const addLength = useCallback(() => {
    setLinear((previous) => ({ ...previous, lengths: [...previous.lengths, ""] }));
  }, []);

  const removeLengthAt = useCallback((index: number) => {
    setLinear((previous) => ({
      ...previous,
      lengths: previous.lengths.filter((_, position) => position !== index),
    }));
  }, []);

  /**
   * Changing the source unit can change dimension; the target has to follow or
   * the next conversion would throw. Same dimension keeps the operator's pick.
   */
  const setConvertFrom = useCallback((from: MeasurementUnit) => {
    setConversion((previous) => {
      if (dimensionOf(from) === dimensionOf(previous.to)) {
        return { ...previous, from };
      }
      const [first, second] = unitsForDimension(from);
      return { ...previous, from, to: from === first ? (second ?? first) : first };
    });
  }, []);

  const setConvertTo = useCallback((to: MeasurementUnit) => {
    setConversion((previous) => ({ ...previous, to }));
  }, []);

  const setConvertValue = useCallback((value: string) => {
    setConversion((previous) => ({ ...previous, value }));
  }, []);

  const outcome = useMemo<CalculatorOutcome>(() => {
    switch (mode) {
      case "calc": {
        // Short-circuit before the evaluator so a blank field reads as
        // "nothing yet" rather than an error the operator did not cause.
        if (expression.trim() === "") return EMPTY_OUTCOME;
        const result = evaluateExpression(expression);
        if (!result.ok) return { value: null, working: null, error: result.error };
        return { value: result.value, working: null, error: null };
      }
      case "area": {
        const length = parseField(area.length);
        const width = parseField(area.width);
        if (length === null || width === null) return EMPTY_OUTCOME;
        const { value, working } = computeArea({
          length,
          width,
          unit: area.unit,
          count: parseWithDefault(area.count, 1),
          wastePercent: parseWithDefault(area.waste, 0),
          output: area.output,
        });
        return { value, working, error: null };
      }
      case "linear": {
        const lengths = linear.lengths
          .map(parseField)
          .filter((entry): entry is number => entry !== null);
        if (lengths.length === 0) return EMPTY_OUTCOME;
        const { value, working } = computeLinear({
          lengths,
          unit: linear.unit,
          wastePercent: parseWithDefault(linear.waste, 0),
          output: linear.output,
        });
        return { value, working, error: null };
      }
      case "convert": {
        const value = parseField(conversion.value);
        if (value === null) return EMPTY_OUTCOME;
        return {
          value: convert(value, conversion.from, conversion.to),
          working: null,
          error: null,
        };
      }
    }
  }, [mode, expression, area, linear, conversion]);

  return {
    mode,
    setMode,
    expression,
    setExpression,
    area,
    updateArea,
    linear,
    updateLinear,
    setLengthAt,
    addLength,
    removeLengthAt,
    conversion,
    setConvertFrom,
    setConvertTo,
    setConvertValue,
    addToDescription,
    setAddToDescription,
    outcome,
    reset,
  };
}
