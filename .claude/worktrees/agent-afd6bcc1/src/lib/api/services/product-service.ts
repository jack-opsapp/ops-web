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
    category: (row.category as string) ?? null,
    isTaxable: (row.is_taxable as boolean) ?? false,
    isActive: (row.is_active as boolean) ?? true,
    type: ((row.type as string) ?? "LABOR") as LineItemType,
    taskTypeId: (row.task_type_id as string) ?? null,
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapProductToDb(
  data: Partial<CreateProduct>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.name !== undefined) row.name = data.name;
  if (data.description !== undefined) row.description = data.description;
  if (data.defaultPrice !== undefined) row.default_price = data.defaultPrice;
  if (data.unitCost !== undefined) row.unit_cost = data.unitCost;
  if (data.unit !== undefined) row.unit = data.unit;
  if (data.category !== undefined) row.category = data.category;
  if (data.isTaxable !== undefined) row.is_taxable = data.isTaxable;
  if (data.isActive !== undefined) row.is_active = data.isActive;
  if (data.type !== undefined) row.type = data.type;
  if (data.taskTypeId !== undefined) row.task_type_id = data.taskTypeId;

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
