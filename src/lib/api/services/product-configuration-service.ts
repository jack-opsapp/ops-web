import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ProductConfigurationModifier,
  ProductConfigurationOption,
  ProductConfigurationValue,
} from "@/lib/products/product-configuration-resolver";

export interface ProductConfigurationData {
  options: ProductConfigurationOption[];
  values: ProductConfigurationValue[];
  modifiers: ProductConfigurationModifier[];
}

export const ProductConfigurationService = {
  async fetch(productId: string): Promise<ProductConfigurationData> {
    const supabase = requireSupabase();
    const [optionResult, modifierResult] = await Promise.all([
      supabase
        .from("product_options")
        .select("*")
        .eq("product_id", productId)
        .is("deleted_at", null)
        .order("sort_order"),
      supabase
        .from("product_pricing_modifiers")
        .select("*")
        .eq("product_id", productId)
        .is("deleted_at", null),
    ]);
    if (optionResult.error) {
      throw new Error(
        `Failed to load product options: ${optionResult.error.message}`,
      );
    }
    if (modifierResult.error) {
      throw new Error(
        `Failed to load product pricing: ${modifierResult.error.message}`,
      );
    }

    const options: ProductConfigurationOption[] = (optionResult.data ?? []).map(
      (row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        required: row.required,
        defaultValue: row.default_value,
        sortOrder: row.sort_order,
      }),
    );
    const optionIds = options.map((option) => option.id);
    const valueResult =
      optionIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("product_option_values")
            .select("*")
            .in("option_id", optionIds)
            .is("deleted_at", null)
            .order("sort_order");
    if (valueResult.error) {
      throw new Error(
        `Failed to load product option values: ${valueResult.error.message}`,
      );
    }

    return {
      options,
      values: (valueResult.data ?? []).map((row) => ({
        id: row.id,
        optionId: row.option_id,
        value: row.value,
        sortOrder: row.sort_order,
      })),
      modifiers: (modifierResult.data ?? []).map((row) => ({
        optionId: row.option_id,
        optionValueId: row.trigger_value_id ?? "",
        kind: row.modifier_kind,
        amount: Number(row.amount),
      })),
    };
  },
};
