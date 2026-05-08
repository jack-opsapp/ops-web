"use client";

/**
 * Product Pricing Modifier Form Dialog
 *
 * Build a single rule: pick the option that triggers it, the trigger
 * (value / int range / boolean implicit), the modifier kind, and the amount.
 *
 * Trigger UI varies by the chosen option's kind:
 *   - select  → pick which value triggers
 *   - integer → optional min + max range
 *   - boolean → implicit (rule fires when value is TRUE)
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import {
  PRICING_MODIFIER_KINDS,
  MODIFIER_KIND_LABEL,
  formatModifierEffect,
  type PricingModifierKind,
  type ProductOption,
  type ProductOptionValue,
  type ProductPricingModifier,
} from "@/lib/types/product-options";
import {
  useCreateProductPricingModifier,
  useUpdateProductPricingModifier,
} from "@/lib/hooks";

interface Props {
  open: boolean;
  mode: "create" | "edit";
  productId: string;
  modifier?: ProductPricingModifier;
  options: ProductOption[];
  values: ProductOptionValue[];
  onClose: () => void;
}

export function ProductPricingModifierFormDialog({
  open,
  mode,
  productId,
  modifier,
  options,
  values,
  onClose,
}: Props) {
  const isEdit = mode === "edit" && !!modifier;

  // ── Form state ───────────────────────────────────────────────────────
  const [optionId, setOptionId] = useState<string>(
    modifier?.optionId ?? options[0]?.id ?? ""
  );
  const [triggerValueId, setTriggerValueId] = useState<string>(
    modifier?.triggerValueId ?? ""
  );
  const [triggerIntMin, setTriggerIntMin] = useState<string>(
    modifier?.triggerIntMin != null ? String(modifier.triggerIntMin) : ""
  );
  const [triggerIntMax, setTriggerIntMax] = useState<string>(
    modifier?.triggerIntMax != null ? String(modifier.triggerIntMax) : ""
  );
  const [modifierKind, setModifierKind] = useState<PricingModifierKind>(
    modifier?.modifierKind ?? "add_per_unit"
  );
  const [amount, setAmount] = useState<string>(
    modifier?.amount != null ? String(modifier.amount) : ""
  );

  useEffect(() => {
    if (!modifier) {
      setOptionId(options[0]?.id ?? "");
      setTriggerValueId("");
      setTriggerIntMin("");
      setTriggerIntMax("");
      setModifierKind("add_per_unit");
      setAmount("");
      return;
    }
    setOptionId(modifier.optionId);
    setTriggerValueId(modifier.triggerValueId ?? "");
    setTriggerIntMin(
      modifier.triggerIntMin != null ? String(modifier.triggerIntMin) : ""
    );
    setTriggerIntMax(
      modifier.triggerIntMax != null ? String(modifier.triggerIntMax) : ""
    );
    setModifierKind(modifier.modifierKind);
    setAmount(String(modifier.amount));
  }, [modifier, options]);

  const selectedOption = options.find((o) => o.id === optionId);
  const selectableValues = useMemo(
    () =>
      values
        .filter((v) => v.optionId === optionId)
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.value.localeCompare(b.value)
        ),
    [values, optionId]
  );

  // Reset trigger state when option changes (kinds may not match).
  useEffect(() => {
    setTriggerValueId("");
    setTriggerIntMin("");
    setTriggerIntMax("");
  }, [optionId]);

  const createModifier = useCreateProductPricingModifier();
  const updateModifier = useUpdateProductPricingModifier(productId);

  const amountNumber = Number.parseFloat(amount);
  const intMinNumber = triggerIntMin === "" ? null : Number.parseInt(triggerIntMin, 10);
  const intMaxNumber = triggerIntMax === "" ? null : Number.parseInt(triggerIntMax, 10);

  // Validation
  const validation = validate({
    selectedOption,
    triggerValueId,
    intMinNumber,
    intMaxNumber,
    amount,
    amountNumber,
  });

  function handleSubmit() {
    if (!selectedOption || validation) return;

    const payload = {
      optionId: selectedOption.id,
      modifierKind,
      amount: amountNumber,
      triggerValueId:
        selectedOption.kind === "select" && triggerValueId
          ? triggerValueId
          : null,
      triggerIntMin:
        selectedOption.kind === "integer" ? intMinNumber : null,
      triggerIntMax:
        selectedOption.kind === "integer" ? intMaxNumber : null,
    };

    if (isEdit && modifier) {
      updateModifier.mutate(
        { id: modifier.id, data: payload },
        { onSuccess: () => onClose() }
      );
    } else {
      createModifier.mutate(
        { productId, ...payload },
        { onSuccess: () => onClose() }
      );
    }
  }

  // Live preview line — same formatter used on the read-only list.
  const previewEffect =
    !Number.isNaN(amountNumber) && amount !== ""
      ? formatModifierEffect(amountNumber, modifierKind)
      : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-cakemono font-light uppercase tracking-wider">
            {isEdit ? "// EDIT MODIFIER" : "// NEW MODIFIER"}
          </DialogTitle>
          <p className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
            [PRICE RULE TRIGGERED BY AN OPTION VALUE]
          </p>
        </DialogHeader>

        <div className="space-y-3">
          {/* Option picker */}
          <FormField label="OPTION" required>
            <select
              value={optionId}
              onChange={(e) => setOptionId(e.target.value)}
              className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
            >
              {options.length === 0 ? (
                <option value="">— no options yet —</option>
              ) : (
                options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.kind})
                  </option>
                ))
              )}
            </select>
          </FormField>

          {/* Trigger by kind */}
          {selectedOption && (
            <FormField label="TRIGGER" required={selectedOption.kind !== "boolean"}>
              {selectedOption.kind === "select" ? (
                <select
                  value={triggerValueId}
                  onChange={(e) => setTriggerValueId(e.target.value)}
                  className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
                >
                  <option value="">— pick a value —</option>
                  {selectableValues.length === 0 ? (
                    <option value="" disabled>
                      No values defined yet
                    </option>
                  ) : (
                    selectableValues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.value}
                      </option>
                    ))
                  )}
                </select>
              ) : selectedOption.kind === "integer" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    value={triggerIntMin}
                    onChange={(e) => setTriggerIntMin(e.target.value)}
                    placeholder="min"
                  />
                  <Input
                    type="number"
                    value={triggerIntMax}
                    onChange={(e) => setTriggerIntMax(e.target.value)}
                    placeholder="max"
                  />
                </div>
              ) : (
                <p className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
                  [IMPLICIT — FIRES WHEN VALUE IS TRUE]
                </p>
              )}
            </FormField>
          )}

          {/* Modifier kind */}
          <FormField label="MODIFIER KIND" required>
            <div className="grid grid-cols-2 gap-1">
              {PRICING_MODIFIER_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setModifierKind(k)}
                  className={cn(
                    "px-2 py-1.5 font-mono text-caption-sm uppercase tracking-widest transition-colors",
                    "border rounded",
                    modifierKind === k
                      ? "bg-ops-accent text-black border-ops-accent"
                      : "border-border text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.04)]"
                  )}
                >
                  {MODIFIER_KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </FormField>

          {/* Amount */}
          <FormField
            label="AMOUNT"
            required
            hint={
              modifierKind === "multiply_unit_price"
                ? "[MULTIPLIER — E.G. 1.25 FOR +25%]"
                : "[USD — POSITIVE OR NEGATIVE]"
            }
          >
            <Input
              type="number"
              step={modifierKind === "multiply_unit_price" ? "0.001" : "0.01"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={modifierKind === "multiply_unit_price" ? "1.25" : "5.00"}
            />
          </FormField>

          {/* Live preview */}
          {previewEffect && (
            <div className="px-2 py-1.5 border border-border rounded bg-[rgba(255,255,255,0.02)]">
              <span className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
                [PREVIEW] →
              </span>
              <span className="font-mohave text-body text-text ml-1.5">
                {previewEffect}
              </span>
            </div>
          )}

          {/* Validation message */}
          {validation && (
            <div className="px-2 py-1.5 border border-[rgba(147,50,26,0.5)] rounded bg-[rgba(147,50,26,0.08)]">
              <span className="font-mono text-caption-sm uppercase tracking-widest text-ops-error">
                {`// ${validation}`}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSubmit}
            disabled={
              !!validation ||
              !selectedOption ||
              createModifier.isPending ||
              updateModifier.isPending
            }
          >
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validate(args: {
  selectedOption: ProductOption | undefined;
  triggerValueId: string;
  intMinNumber: number | null;
  intMaxNumber: number | null;
  amount: string;
  amountNumber: number;
}): string | null {
  const {
    selectedOption,
    triggerValueId,
    intMinNumber,
    intMaxNumber,
    amount,
    amountNumber,
  } = args;

  if (!selectedOption) return "PICK AN OPTION";

  if (selectedOption.kind === "select" && !triggerValueId) {
    return "PICK A TRIGGER VALUE";
  }

  if (selectedOption.kind === "integer") {
    if (intMinNumber == null && intMaxNumber == null) {
      return "ENTER A MIN, MAX, OR BOTH";
    }
    if (
      intMinNumber != null &&
      intMaxNumber != null &&
      intMinNumber > intMaxNumber
    ) {
      return "MIN MUST BE ≤ MAX";
    }
    if (intMinNumber != null && !Number.isFinite(intMinNumber)) {
      return "MIN MUST BE AN INTEGER";
    }
    if (intMaxNumber != null && !Number.isFinite(intMaxNumber)) {
      return "MAX MUST BE AN INTEGER";
    }
  }

  if (amount.trim() === "") return "ENTER AN AMOUNT";
  if (!Number.isFinite(amountNumber)) return "AMOUNT MUST BE NUMERIC";

  return null;
}

// ─── Local FormField (mirrors the option dialog) ───────────────────────────

function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
        {label}
        {required && <span className="text-ops-accent ml-0.5">*</span>}
      </label>
      {children}
      {hint && (
        <p className="font-mono text-micro text-text-mute uppercase tracking-widest">
          {hint}
        </p>
      )}
    </div>
  );
}
