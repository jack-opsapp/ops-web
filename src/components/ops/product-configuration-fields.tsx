"use client";

import { useEffect, useMemo, useRef } from "react";
import { useProductConfiguration } from "@/lib/hooks/use-product-configuration";
import {
  resolveProductConfiguration,
  type ResolvedProductConfiguration,
} from "@/lib/products/product-configuration-resolver";
import type { Product } from "@/lib/types/pipeline";
import { useDictionary } from "@/i18n/client";

interface ProductConfigurationFieldsProps {
  product: Product;
  configuredOptions: Record<string, string>;
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
    const next = { ...configuredOptions };
    if (value) next[optionId] = value;
    else delete next[optionId];

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
        const value = configuredOptions[option.id] ?? "";
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
                onChange={(event) =>
                  applyOption(option.id, event.target.value)
                }
                className={fieldClass}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
