import { requireSupabase } from "@/lib/supabase/helpers";
import {
  buildBulkVariantFamilyRecords,
  type BulkVariantExpansionRequest,
  type BulkVariantFamilyRecord,
} from "@/lib/catalog/bulk-variant-expansion";

export interface CatalogBulkVariantResponse {
  ok: boolean;
  replayed: boolean;
  error_code?: string | null;
  message?: string | null;
  saved_at?: string | null;
  family_count: number;
  existing_variant_assignment_count: number;
  new_variant_count: number;
  options?: unknown[];
  option_values?: unknown[];
  variants?: unknown[];
  variant_option_values?: unknown[];
}

export class CatalogBulkVariantRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CatalogBulkVariantRpcError";
    this.code = code;
  }
}

function numberOrNull(value: unknown): number | undefined {
  return value == null ? undefined : Number(value);
}

export const CatalogBulkVariantService = {
  async fetchFamilies(companyId: string): Promise<BulkVariantFamilyRecord[]> {
    const supabase = requireSupabase();
    const [items, categories, options, values, variants, joins] =
      await Promise.all([
        supabase
          .from("catalog_items")
          .select("id, company_id, category_id, name, is_active")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .is("deleted_at", null),
        supabase
          .from("catalog_categories")
          .select("id, name")
          .eq("company_id", companyId)
          .is("deleted_at", null),
        supabase
          .from("catalog_options")
          .select("id, catalog_item_id, name, sort_order")
          .is("deleted_at", null),
        supabase
          .from("catalog_option_values")
          .select("id, option_id, value, sort_order")
          .is("deleted_at", null),
        supabase
          .from("catalog_variants")
          .select(
            "id, company_id, catalog_item_id, sku, quantity, price_override, unit_cost_override, warning_threshold, critical_threshold, unit_id, is_active"
          )
          .eq("company_id", companyId)
          .eq("is_active", true)
          .is("deleted_at", null),
        supabase
          .from("catalog_variant_option_values")
          .select("variant_id, option_value_id")
          .is("deleted_at", null),
      ]);

    for (const result of [
      items,
      categories,
      options,
      values,
      variants,
      joins,
    ]) {
      if (result.error) {
        throw new CatalogBulkVariantRpcError(
          "snapshot_error",
          result.error.message
        );
      }
    }

    return buildBulkVariantFamilyRecords({
      companyId,
      items: (items.data ?? []).map((row) => ({
        id: row.id as string,
        companyId: row.company_id as string,
        categoryId: (row.category_id as string | null) ?? null,
        name: row.name as string,
        isActive: Boolean(row.is_active),
      })),
      categories: (categories.data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
      })),
      options: (options.data ?? []).map((row) => ({
        id: row.id as string,
        catalogItemId: row.catalog_item_id as string,
        name: row.name as string,
        sortOrder: Number(row.sort_order ?? 0),
      })),
      values: (values.data ?? []).map((row) => ({
        id: row.id as string,
        optionId: row.option_id as string,
        value: row.value as string,
        sortOrder: Number(row.sort_order ?? 0),
      })),
      variants: (variants.data ?? []).map((row) => ({
        id: row.id as string,
        companyId: row.company_id as string,
        catalogItemId: row.catalog_item_id as string,
        sku: (row.sku as string | null) ?? undefined,
        quantity: Number(row.quantity ?? 0),
        priceOverride: numberOrNull(row.price_override),
        unitCostOverride: numberOrNull(row.unit_cost_override),
        warningThreshold: numberOrNull(row.warning_threshold),
        criticalThreshold: numberOrNull(row.critical_threshold),
        unitId: (row.unit_id as string | null) ?? undefined,
        isActive: Boolean(row.is_active),
        optionValueIds: [],
      })),
      joins: (joins.data ?? []).map((row) => ({
        variantId: row.variant_id as string,
        optionValueId: row.option_value_id as string,
      })),
    });
  },

  async expandVariants(
    request: BulkVariantExpansionRequest
  ): Promise<CatalogBulkVariantResponse> {
    const { data, error } = await requireSupabase().rpc(
      "catalog_bulk_expand_variants",
      {
        p_company_id: request.companyId,
        p_idempotency_key: request.idempotencyKey,
        p_payload: request.payload,
      }
    );
    if (error)
      throw new CatalogBulkVariantRpcError("transport_error", error.message);

    const response = (data ?? {}) as Partial<CatalogBulkVariantResponse>;
    if (response.ok !== true) {
      throw new CatalogBulkVariantRpcError(
        response.error_code ?? "request_rejected",
        response.message ?? "Catalog update was rejected."
      );
    }
    return response as CatalogBulkVariantResponse;
  },
};
