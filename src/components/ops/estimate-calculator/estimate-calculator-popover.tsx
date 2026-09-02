"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  formatResult,
  roundForInsert,
  type ExpressionError,
} from "@/lib/utils/estimate-calc/expression";
import { Segmented } from "./calculator-controls";
import {
  AreaFields,
  CalcFields,
  ConvertFields,
  LinearFields,
} from "./calculator-fields";
import {
  CALCULATOR_MODES,
  useCalculatorState,
  type CalculatorMode,
} from "./use-calculator-state";

export interface CalculatorInsertTarget {
  lineItemId: string;
  field: "quantity" | "unitPrice";
  lineNumber: number;
}

export interface CalculatorInsertResult {
  value: number;
  working: string | null;
  addToDescription: boolean;
}

export interface EstimateCalculatorPopoverProps {
  /** The numeric field the operator last focused, or null if none yet. */
  target: CalculatorInsertTarget | null;
  /** Whether the row model exposes a description the working can be appended to. */
  descriptionSupported: boolean;
  onInsert: (result: CalculatorInsertResult) => void;
  /** The CALC chip, rendered as the popover's trigger. */
  trigger: ReactNode;
}

const ERROR_KEYS: Record<ExpressionError, string> = {
  empty: "error.empty",
  malformed: "error.malformed",
  divide_by_zero: "error.divideByZero",
  out_of_range: "error.outOfRange",
};

/** Only measurement modes have working worth writing onto a line item. */
const SHOWS_WORKING: readonly CalculatorMode[] = ["area", "linear"];

/**
 * The line-item calculator.
 *
 * Anchored to the editor's action row rather than to a row, so it is never
 * clipped by the floating window's scrolling shell, and rendered at `z-modal`
 * so it clears both the window (z 2000+) and the Books dialog (z 3000) — the
 * sanctioned override documented on `entity-picker`.
 *
 * It writes one finished number through the editor's `updateItem`, never into
 * the DOM: the quantity and price inputs re-parse on every keystroke, so a
 * partial value would be silently mangled.
 */
export function EstimateCalculatorPopover({
  target,
  descriptionSupported,
  onInsert,
  trigger,
}: EstimateCalculatorPopoverProps) {
  const { t } = useDictionary("estimate-calculator");
  const [open, setOpen] = useState(false);
  // Set for exactly one close: the one caused by an insert.
  const insertedRef = useRef(false);
  const state = useCalculatorState();
  const { mode, setMode, outcome, addToDescription, setAddToDescription, reset } = state;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) reset();
    },
    [reset],
  );

  const offersWorking = SHOWS_WORKING.includes(mode) && outcome.working !== null;
  const canAddToDescription = descriptionSupported && offersWorking;

  const insertLabel =
    target === null
      ? t("insert.noTarget")
      : target.field === "quantity"
        ? t("insert.qty", { n: target.lineNumber })
        : t("insert.price", { n: target.lineNumber });

  const canInsert = target !== null && outcome.value !== null;

  const handleInsert = useCallback(() => {
    if (target === null || outcome.value === null) return;
    insertedRef.current = true;
    onInsert({
      value: roundForInsert(outcome.value),
      working: offersWorking ? outcome.working : null,
      addToDescription: canAddToDescription && addToDescription,
    });
    handleOpenChange(false);
  }, [
    target,
    outcome,
    offersWorking,
    canAddToDescription,
    addToDescription,
    onInsert,
    handleOpenChange,
  ]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        // `z-modal` clears the floating window and the Books dialog. The panel
        // surface itself (dense glass, hairline, 12px radius) comes from the
        // primitive's own `glass-dense` — restating it here would only fight it.
        className="z-modal w-[296px] p-1.5"
        aria-label={t("dialogLabel")}
        // Panels are menus: global single-key shortcuts must ignore keys while
        // one is open, and the keypad's buttons are not inputs.
        data-keyboard-scope="modal-or-menu"
        onCloseAutoFocus={(event) => {
          // After an insert the consumer puts focus in the field that received
          // the number; Radix restoring focus to the trigger would fight it.
          // Escape and outside-click keep the default restore.
          if (insertedRef.current) {
            insertedRef.current = false;
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            handleInsert();
          }
        }}
      >
        <div className="space-y-1.5">
          <Segmented
            label={t("mode.label")}
            value={mode}
            options={CALCULATOR_MODES.map((entry) => ({
              value: entry,
              label: t(`mode.${entry}`),
            }))}
            onChange={setMode}
          />

          {mode === "calc" && <CalcFields state={state} t={t} />}
          {mode === "area" && <AreaFields state={state} t={t} />}
          {mode === "linear" && <LinearFields state={state} t={t} />}
          {mode === "convert" && <ConvertFields state={state} t={t} />}

          <div className="space-y-0.5 border-t border-line pt-1">
            <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-mute">
              {t("result.label")}
            </span>
            <p
              data-testid="calculator-result"
              className="font-mono text-data-lg text-text"
            >
              {outcome.value === null ? "—" : formatResult(outcome.value)}
            </p>
            {outcome.error !== null ? (
              <p className="font-mono text-micro text-rose" role="alert">
                {t(ERROR_KEYS[outcome.error])}
              </p>
            ) : offersWorking ? (
              <p className="font-mono text-micro text-text-3">{outcome.working}</p>
            ) : null}
          </div>

          {canAddToDescription && (
            <label className="flex cursor-pointer items-center gap-0.5">
              <input
                type="checkbox"
                checked={addToDescription}
                onChange={(event) => setAddToDescription(event.target.checked)}
                className="rounded-sm border border-line bg-surface-input"
              />
              <span className="font-mono text-micro uppercase tracking-[0.12em] text-text-3">
                {t("addMath")}
              </span>
            </label>
          )}

          <button
            type="button"
            onClick={handleInsert}
            disabled={!canInsert}
            className={cn(
              "h-9 w-full rounded border",
              // DESIGN.md §9 primary: outlined accent at rest, fills on hover.
              // The one accent element in the panel.
              "border-ops-accent bg-transparent text-ops-accent",
              "font-cakemono font-light text-cake-button uppercase",
              "transition-all duration-150 motion-reduce:transition-none",
              "hover:bg-ops-accent hover:text-black",
              "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
              "disabled:pointer-events-none disabled:border-line disabled:bg-transparent disabled:text-text-mute",
            )}
          >
            {insertLabel}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
