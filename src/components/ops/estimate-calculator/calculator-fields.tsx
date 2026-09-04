"use client";

import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import type { MeasurementUnit } from "@/lib/utils/estimate-calc/measure";
import {
  FieldLabel,
  Keypad,
  LabeledField,
  NUMERIC_INPUT_CLASS,
  SELECT_CLASS,
  Segmented,
} from "./calculator-controls";
import {
  AREA_OUTPUTS,
  LINEAR_OUTPUTS,
  MEASUREMENT_UNITS,
  unitsForDimension,
  type useCalculatorState,
} from "./use-calculator-state";

type CalculatorState = ReturnType<typeof useCalculatorState>;
type Translate = (key: string, params?: Record<string, unknown>) => string;

interface ModeProps {
  state: CalculatorState;
  t: Translate;
}

/** Unit selects are labelled from the dictionary, never from raw enum keys. */
function unitOptions(t: Translate, units: readonly MeasurementUnit[]) {
  return units.map((unit) => (
    <option key={unit} value={unit}>
      {t(`unit.${unit}`)}
    </option>
  ));
}

export function CalcFields({ state, t }: ModeProps) {
  const { expression, setExpression, outcome } = state;

  /** `=` and Enter fold the expression into its result, so the operator can
   *  keep calculating from the number rather than retyping it. */
  function fold() {
    if (outcome.value === null) return;
    setExpression(String(outcome.value));
  }

  return (
    <div className="space-y-1">
      <LabeledField label={t("field.expression")}>
        <Input
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          onKeyDown={(event) => {
            // Plain Enter folds; the modifier chord is the insert shortcut and
            // belongs to the panel, not this field.
            if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              fold();
            }
          }}
          // Deliberately not type="number" — operators and parens must be typeable.
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          className={cn(NUMERIC_INPUT_CLASS, "text-left")}
        />
      </LabeledField>
      <Keypad
        onAppend={(token) => setExpression(expression + token)}
        onClear={() => setExpression("")}
        onBackspace={() => setExpression(expression.slice(0, -1))}
        onEquals={fold}
        labels={{
          clear: t("keypad.clear"),
          backspace: t("keypad.backspace"),
          equals: t("keypad.equals"),
        }}
      />
    </div>
  );
}

export function AreaFields({ state, t }: ModeProps) {
  const { area, updateArea } = state;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-1">
        <LabeledField label={t("field.length")}>
          <Input
            value={area.length}
            onChange={(event) => updateArea({ length: event.target.value })}
            inputMode="decimal"
            className={NUMERIC_INPUT_CLASS}
          />
        </LabeledField>
        <LabeledField label={t("field.width")}>
          <Input
            value={area.width}
            onChange={(event) => updateArea({ width: event.target.value })}
            inputMode="decimal"
            className={NUMERIC_INPUT_CLASS}
          />
        </LabeledField>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <LabeledField label={t("field.unit")}>
          <select
            value={area.unit}
            onChange={(event) =>
              updateArea({ unit: event.target.value as typeof area.unit })
            }
            className={SELECT_CLASS}
          >
            {unitOptions(t, MEASUREMENT_UNITS)}
          </select>
        </LabeledField>
        <LabeledField label={t("field.count")}>
          <Input
            value={area.count}
            onChange={(event) => updateArea({ count: event.target.value })}
            inputMode="decimal"
            className={NUMERIC_INPUT_CLASS}
          />
        </LabeledField>
      </div>
      <div className="grid grid-cols-2 items-end gap-1">
        <LabeledField label={t("field.waste")}>
          <Input
            value={area.waste}
            onChange={(event) => updateArea({ waste: event.target.value })}
            inputMode="decimal"
            className={NUMERIC_INPUT_CLASS}
          />
        </LabeledField>
        <div className="flex min-w-0 flex-col gap-0.5">
          <FieldLabel>{t("field.output")}</FieldLabel>
          <Segmented
            label={t("field.output")}
            value={area.output}
            options={AREA_OUTPUTS.map((unit) => ({
              value: unit,
              label: t(`unit.${unit}`),
            }))}
            onChange={(output) => updateArea({ output })}
          />
        </div>
      </div>
    </div>
  );
}

export function LinearFields({ state, t }: ModeProps) {
  const { linear, updateLinear, setLengthAt, addLength, removeLengthAt } = state;

  return (
    <div className="space-y-1">
      <div className="flex flex-col gap-0.5">
        <FieldLabel>{t("field.lengths")}</FieldLabel>
        <div className="space-y-0.5">
          {linear.lengths.map((length, index) => (
            <div key={index} className="flex items-center gap-0.5">
              <Input
                value={length}
                onChange={(event) => setLengthAt(index, event.target.value)}
                aria-label={`${t("field.length")} ${index + 1}`}
                inputMode="decimal"
                className={cn(NUMERIC_INPUT_CLASS, "flex-1")}
              />
              {linear.lengths.length > 1 && (
                <button
                  type="button"
                  aria-label={t("field.removeLength", { n: index + 1 })}
                  onClick={() => removeLengthAt(index)}
                  className={cn(
                    "shrink-0 rounded p-[4px] text-text-mute",
                    "transition-colors duration-150 motion-reduce:transition-none",
                    "hover:bg-surface-hover hover:text-text-2",
                    "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                  )}
                >
                  <X className="h-[14px] w-[14px]" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={addLength}
        className={cn(
          "flex h-[24px] items-center rounded-chip border border-line px-[6px]",
          "font-mono text-micro uppercase tracking-[0.12em] text-text-3",
          "transition-colors duration-150 motion-reduce:transition-none",
          "hover:border-line-hi hover:text-text-2",
          "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        )}
      >
        {t("field.addLength")}
      </button>
      <div className="grid grid-cols-2 gap-1">
        <LabeledField label={t("field.unit")}>
          <select
            value={linear.unit}
            onChange={(event) =>
              updateLinear({ unit: event.target.value as typeof linear.unit })
            }
            className={SELECT_CLASS}
          >
            {unitOptions(t, MEASUREMENT_UNITS)}
          </select>
        </LabeledField>
        <LabeledField label={t("field.waste")}>
          <Input
            value={linear.waste}
            onChange={(event) => updateLinear({ waste: event.target.value })}
            inputMode="decimal"
            className={NUMERIC_INPUT_CLASS}
          />
        </LabeledField>
      </div>
      <div className="flex flex-col gap-0.5">
        <FieldLabel>{t("field.output")}</FieldLabel>
        <Segmented
          label={t("field.output")}
          value={linear.output}
          options={LINEAR_OUTPUTS.map((unit) => ({
            value: unit,
            label: t(`unit.${unit}`),
          }))}
          onChange={(output) => updateLinear({ output })}
        />
      </div>
    </div>
  );
}

export function ConvertFields({ state, t }: ModeProps) {
  const { conversion, setConvertFrom, setConvertTo, setConvertValue } = state;

  return (
    <div className="space-y-1">
      <LabeledField label={t("field.value")}>
        <Input
          value={conversion.value}
          onChange={(event) => setConvertValue(event.target.value)}
          inputMode="decimal"
          className={NUMERIC_INPUT_CLASS}
        />
      </LabeledField>
      <div className="grid grid-cols-2 gap-1">
        <LabeledField label={t("field.from")}>
          <select
            value={conversion.from}
            onChange={(event) => setConvertFrom(event.target.value as MeasurementUnit)}
            className={SELECT_CLASS}
          >
            {unitOptions(
              t,
              // Every unit, grouped — this is the only place a dimension is chosen.
              [...unitsForDimension("ft"), ...unitsForDimension("sqft"), ...unitsForDimension("cuft")],
            )}
          </select>
        </LabeledField>
        <LabeledField label={t("field.to")}>
          <select
            value={conversion.to}
            onChange={(event) => setConvertTo(event.target.value as MeasurementUnit)}
            className={SELECT_CLASS}
          >
            {/* Cross-dimension conversion is meaningless, so it is not offered. */}
            {unitOptions(t, unitsForDimension(conversion.from))}
          </select>
        </LabeledField>
      </div>
    </div>
  );
}
