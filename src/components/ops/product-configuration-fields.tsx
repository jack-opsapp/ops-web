"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProductConfiguration } from "@/lib/hooks/use-product-configuration";
import {
  resolveProductConfiguration,
  type ResolvedProductConfiguration,
} from "@/lib/products/product-configuration-resolver";
import type { Product } from "@/lib/types/pipeline";
import { useDictionary } from "@/i18n/client";

interface ProductConfigurationFieldsProps {
  product: Product;
  configuredOptions: Readonly<Record<string, unknown>>;
  quantity: number;
  discountPercent: number;
  onResolved: (resolved: ResolvedProductConfiguration) => void;
}

export function ProductConfigurationFields({
  product,
  configuredOptions,
  quantity,
  discountPercent,
  onResolved,
}: ProductConfigurationFieldsProps) {
  const { t } = useDictionary("pipeline");
  const { data, isLoading, isError } = useProductConfiguration(product.id);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  // What the estimator has typed but not yet committed, per option. A count
  // field can sit empty mid-edit without the line losing its committed value.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const clearDraft = useCallback((optionId: string) => {
    setDrafts((current) => {
      if (!(optionId in current)) return current;
      const next = { ...current };
      delete next[optionId];
      return next;
    });
  }, []);
  const configuredKey = JSON.stringify(configuredOptions);

  const resolved = useMemo(() => {
    if (!data) return null;
    return resolveProductConfiguration({
      product: {
        id: product.id,
        name: product.name,
        basePrice: product.defaultPrice,
        minimumCharge: product.minimumCharge ?? null,
        isTaxable: product.isTaxable,
        showInStorefront: product.showInStorefront !== false,
        taskTypeId: product.taskTypeRef ?? product.taskTypeId,
        unitCost: product.unitCost,
        pricingUnit: product.pricingUnit ?? product.unit,
      },
      options: data.options,
      values: data.values,
      modifiers: data.modifiers,
      configuredOptions,
      quantity,
      discountPercent,
    });
  }, [configuredKey, data, discountPercent, product, quantity]);

  useEffect(() => {
    if (resolved) onResolvedRef.current(resolved);
  }, [resolved]);

  if (isLoading) {
    return (
      <p className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
        {t("estimates.form.configurationLoading", "[LOADING OPTIONS]")}
      </p>
    );
  }

  if (isError) {
    return (
      <p className="font-mono text-caption-sm text-ops-error">
        {t(
          "estimates.form.configurationError",
          "Product options could not be loaded.",
        )}
      </p>
    );
  }

  if (!data || data.options.length === 0) return null;

  const applyOption = (optionId: string, value: string) => {
    // An empty value is an explicit "unanswered" — the resolver must not fall
    // back to the catalog default, or clearing a field would silently re-arm it.
    const next: Record<string, unknown> = { ...configuredOptions, [optionId]: value };

    const nextResolved = resolveProductConfiguration({
      product: {
        id: product.id,
        name: product.name,
        basePrice: product.defaultPrice,
        minimumCharge: product.minimumCharge ?? null,
        isTaxable: product.isTaxable,
        showInStorefront: product.showInStorefront !== false,
        taskTypeId: product.taskTypeRef ?? product.taskTypeId,
        unitCost: product.unitCost,
        pricingUnit: product.pricingUnit ?? product.unit,
      },
      options: data.options,
      values: data.values,
      modifiers: data.modifiers,
      configuredOptions: next,
      quantity,
      discountPercent,
    });
    onResolvedRef.current(nextResolved);
  };

  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      {data.options.map((option) => {
        const values = data.values.filter(
          (value) => value.optionId === option.id,
        );
        // Controls are text/select inputs; a stored number or boolean renders
        // as its string form and the resolver types it again on the way out.
        const stored = configuredOptions[option.id];
        const committed =
          stored === undefined || stored === null ? "" : String(stored);
        const value = drafts[option.id] ?? committed;
        const fieldClass =
          "w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text";

        return (
          <label
            key={option.id}
            className="space-y-0.5 font-mono text-caption-sm uppercase tracking-widest text-text-3"
          >
            <span>
              {option.name}
              {option.required ? " *" : ""}
            </span>
            {option.kind === "select" ? (
              <select
                aria-label={option.name}
                value={value}
                onChange={(event) =>
                  applyOption(option.id, event.target.value)
                }
                className={fieldClass}
              >
                <option value="">
                  {t("estimates.form.selectOption", "Select option...")}
                </option>
                {values.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.value}
                  </option>
                ))}
              </select>
            ) : option.kind === "boolean" ? (
              <select
                aria-label={option.name}
                value={value}
                onChange={(event) =>
                  applyOption(option.id, event.target.value)
                }
                className={fieldClass}
              >
                <option value="">
                  {t("estimates.form.selectOption", "Select option...")}
                </option>
                <option value="true">
                  {t("estimates.form.booleanYes", "Yes")}
                </option>
                <option value="false">
                  {t("estimates.form.booleanNo", "No")}
                </option>
              </select>
            ) : (
              <input
                aria-label={option.name}
                type={option.kind === "integer" ? "number" : "text"}
                step={option.kind === "integer" ? 1 : undefined}
                value={value}
                onChange={(event) => {
                  const typed = event.target.value;
                  setDrafts((current) => ({
                    ...current,
                    [option.id]: typed,
                  }));
                  if (typed !== "") applyOption(option.id, typed);
                }}
                onBlur={() => clearDraft(option.id)}
                className={fieldClass}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
