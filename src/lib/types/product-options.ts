/**
 * OPS Web - Product Option + Pricing Modifier Types
 *
 * Types for the configurable-product authoring layer:
 *   - product_options       (per-product knob: select/integer/boolean)
 *   - product_option_values (allowed values for select-kind options)
 *   - product_pricing_modifiers (rules that mutate price based on chosen value)
 *
 * Schema verified live against ops-app on 2026-05-08.
 * Mirrors iOS DTOs in OPS/Network/Supabase/DTOs/ProductExtensionDTOs.swift.
 */

// ─── Enums (from check constraints) ─────────────────────────────────────────

export const PRODUCT_OPTION_KINDS = ["select", "integer", "boolean"] as const;
export type ProductOptionKind = (typeof PRODUCT_OPTION_KINDS)[number];

export const PRICING_MODIFIER_KINDS = [
  "add_per_unit",
  "add_flat",
  "add_per_count",
  "multiply_unit_price",
] as const;
export type PricingModifierKind = (typeof PRICING_MODIFIER_KINDS)[number];

// ─── Domain types ───────────────────────────────────────────────────────────

export interface ProductOption {
  id: string;
  productId: string;
  name: string;
  kind: ProductOptionKind;
  affectsPrice: boolean;
  affectsRecipe: boolean;
  required: boolean;
  defaultValue: string | null;
  optionDefaultSource: string | null;
  sortOrder: number;
}

export interface CreateProductOption {
  productId: string;
  name: string;
  kind: ProductOptionKind;
  affectsPrice?: boolean;
  affectsRecipe?: boolean;
  required?: boolean;
  defaultValue?: string | null;
  optionDefaultSource?: string | null;
  sortOrder?: number;
}

export type UpdateProductOption = Partial<
  Omit<CreateProductOption, "productId">
>;

export interface ProductOptionValue {
  id: string;
  optionId: string;
  value: string;
  sortOrder: number;
}

export interface CreateProductOptionValue {
  optionId: string;
  value: string;
  sortOrder?: number;
}

export type UpdateProductOptionValue = Partial<
  Omit<CreateProductOptionValue, "optionId">
>;

export interface ProductPricingModifier {
  id: string;
  productId: string;
  optionId: string;
  triggerValueId: string | null;
  triggerIntMin: number | null;
  triggerIntMax: number | null;
  modifierKind: PricingModifierKind;
  amount: number;
}

export interface CreateProductPricingModifier {
  productId: string;
  optionId: string;
  triggerValueId?: string | null;
  triggerIntMin?: number | null;
  triggerIntMax?: number | null;
  modifierKind: PricingModifierKind;
  amount: number;
}

export type UpdateProductPricingModifier = Partial<
  Omit<CreateProductPricingModifier, "productId">
>;

// ─── Display helpers ────────────────────────────────────────────────────────

export const OPTION_KIND_LABEL: Record<ProductOptionKind, string> = {
  select: "SELECT",
  integer: "INTEGER",
  boolean: "BOOLEAN",
};

export const MODIFIER_KIND_LABEL: Record<PricingModifierKind, string> = {
  add_per_unit: "ADD PER UNIT",
  add_flat: "ADD FLAT",
  add_per_count: "ADD PER COUNT",
  multiply_unit_price: "MULTIPLY UNIT",
};

/** Format the dollar amount portion of a modifier (with sign + currency). */
function formatModifierAmount(amount: number, kind: PricingModifierKind): string {
  if (kind === "multiply_unit_price") {
    // e.g. "1.25"
    return amount.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  }
  const sign = amount >= 0 ? "+" : "−";
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${sign}${formatted}`;
}

/** Effect clause: e.g. "+$5.00 per unit" or "× 1.25 unit price". */
export function formatModifierEffect(
  amount: number,
  kind: PricingModifierKind
): string {
  const amt = formatModifierAmount(amount, kind);
  switch (kind) {
    case "add_per_unit":
      return `${amt} per unit`;
    case "add_flat":
      return `${amt} flat`;
    case "add_per_count":
      return `${amt} per count`;
    case "multiply_unit_price":
      return `× ${amt} unit price`;
  }
}

/** Trigger clause + effect — full humanized rule string. */
export function formatModifierRule(
  modifier: ProductPricingModifier,
  options: ProductOption[],
  values: ProductOptionValue[]
): string {
  const option = options.find((o) => o.id === modifier.optionId);
  const optionName = option?.name ?? "Option";
  const effect = formatModifierEffect(modifier.amount, modifier.modifierKind);

  if (modifier.triggerValueId) {
    const value = values.find((v) => v.id === modifier.triggerValueId);
    const label = value?.value ?? "?";
    return `When ${optionName} = ${label} → ${effect}`;
  }

  const min = modifier.triggerIntMin;
  const max = modifier.triggerIntMax;
  if (min != null && max != null) {
    if (min === max) return `When ${optionName} = ${min} → ${effect}`;
    return `When ${optionName} is ${min}–${max} → ${effect}`;
  }
  if (min != null) return `When ${optionName} ≥ ${min} → ${effect}`;
  if (max != null) return `When ${optionName} ≤ ${max} → ${effect}`;

  return `When ${optionName} is set → ${effect}`;
}
