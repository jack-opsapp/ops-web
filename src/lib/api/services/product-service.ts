/**
 * OPS Web - Product Service
 *
 * CRUD operations for the Products/Services catalog using Supabase.
 * Database columns use snake_case; TypeScript uses camelCase.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type {
  Product,
  CreateProduct,
  UpdateProduct,
  LineItemType,
  ProductKind,
  ProductPricingUnit,
} from "@/lib/types/pipeline";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapProductFromDb(row: Record<string, unknown>): Product {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    defaultPrice: Number(row.default_price ?? 0),
    unitCost: row.unit_cost != null ? Number(row.unit_cost) : null,
    unit: (row.unit as string) ?? "each",
    unitId: (row.unit_id as string) ?? null,
    category: (row.category as string) ?? null,
    categoryId: (row.category_id as string) ?? null,
    isTaxable: (row.is_taxable as boolean) ?? false,
    isActive: (row.is_active as boolean) ?? true,
    type: ((row.type as string) ?? "LABOR") as LineItemType,
    taskTypeId: (row.task_type_id as string) ?? null,
    // iOS DTO parity fields ─────────────────────────────────────────────
    pricingUnit: (row.pricing_unit as ProductPricingUnit) ?? null,
    sku: (row.sku as string) ?? null,
    thumbnailUrl: (row.thumbnail_url as string) ?? null,
    kind: (row.kind as ProductKind) ?? null,
    minimumCharge:
      row.minimum_charge != null ? Number(row.minimum_charge) : null,
    minimumQuantity:
      row.minimum_quantity != null ? Number(row.minimum_quantity) : null,
    showBomOnEstimate: (row.show_bom_on_estimate as boolean) ?? false,
    showInStorefront: (row.show_in_storefront as boolean) ?? false,
    isFavorite: (row.is_favorite as boolean) ?? false,
    tieredPricing: row.tiered_pricing ?? null,
    taskTypeRef: (row.task_type_ref as string) ?? null,
    // ────────────────────────────────────────────────────────────────────
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapProductToDb(
  data: Partial<CreateProduct>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  // Sparse-update pattern: only emit fields the caller explicitly set so an
  // update path never force-writes NULL over a server-owned value it didn't
  // touch (e.g. thumbnail_url after iOS uploads finish).
  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.name !== undefined) row.name = data.name;
  if (data.description !== undefined) row.description = data.description;
  if (data.defaultPrice !== undefined) row.default_price = data.defaultPrice;
  if (data.unitCost !== undefined) row.unit_cost = data.unitCost;
  if (data.unit !== undefined) row.unit = data.unit;
  if (data.unitId !== undefined) row.unit_id = data.unitId ?? null;
  if (data.category !== undefined) row.category = data.category;
  if (data.categoryId !== undefined) row.category_id = data.categoryId ?? null;
  if (data.isTaxable !== undefined) row.is_taxable = data.isTaxable;
  if (data.isActive !== undefined) row.is_active = data.isActive;
  if (data.type !== undefined) row.type = data.type;
  if (data.taskTypeId !== undefined) row.task_type_id = data.taskTypeId;
  // iOS DTO parity fields ─────────────────────────────────────────────
  if (data.pricingUnit !== undefined) row.pricing_unit = data.pricingUnit ?? null;
  if (data.sku !== undefined) row.sku = data.sku ?? null;
  if (data.thumbnailUrl !== undefined)
    row.thumbnail_url = data.thumbnailUrl ?? null;
  if (data.kind !== undefined) row.kind = data.kind ?? null;
  if (data.minimumCharge !== undefined)
    row.minimum_charge = data.minimumCharge ?? null;
  if (data.minimumQuantity !== undefined)
    row.minimum_quantity = data.minimumQuantity ?? null;
  if (data.showBomOnEstimate !== undefined)
    row.show_bom_on_estimate = data.showBomOnEstimate;
  if (data.showInStorefront !== undefined)
    row.show_in_storefront = data.showInStorefront;
  if (data.isFavorite !== undefined) row.is_favorite = data.isFavorite;
  if (data.tieredPricing !== undefined) row.tiered_pricing = data.tieredPricing;
  if (data.taskTypeRef !== undefined)
    row.task_type_ref = data.taskTypeRef ?? null;

  return row;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const ProductService = {
  async fetchProducts(
    companyId: string,
    activeOnly: boolean = true
  ): Promise<Product[]> {
    const supabase = requireSupabase();

    let query = supabase
      .from("products")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    query = query.order("name");

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch products: ${error.message}`);
    return (data ?? []).map(mapProductFromDb);
  },

  async fetchProduct(id: string): Promise<Product> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch product: ${error.message}`);
    return mapProductFromDb(data);
  },

  async createProduct(data: CreateProduct): Promise<Product> {
    const supabase = requireSupabase();
    const row = mapProductToDb(data);

    const { data: created, error } = await supabase
      .from("products")
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(`Failed to create product: ${error.message}`);
    return mapProductFromDb(created);
  },

  async updateProduct(
    id: string,
    data: Partial<CreateProduct>
  ): Promise<Product> {
    const supabase = requireSupabase();
    const row = mapProductToDb(data);

    const { data: updated, error } = await supabase
      .from("products")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update product: ${error.message}`);
    return mapProductFromDb(updated);
  },

  async deleteProduct(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("products")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete product: ${error.message}`);
  },
};
