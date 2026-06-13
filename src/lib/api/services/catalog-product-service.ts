/**
 * OPS Web — Catalog Product Service
 *
 * Per-product option + recipe-material counts for the PRODUCTS segment CONFIG
 * column and the PRODUCTS supply tile. Two grouped reads, never N+1.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

export interface ProductConfigCount {
  options: number;
  materials: number;
}

export const CatalogProductService = {
  /** productId → { options, materials } for every product in the company. */
  async fetchConfigCounts(
    companyId: string,
  ): Promise<Map<string, ProductConfigCount>> {
    const supabase = requireSupabase();

    // Resolve the company's product ids first so the option/material reads can
    // filter by an in-list (those child tables have no company_id column).
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id")
      .eq("company_id", companyId)
      .is("deleted_at", null);
    if (prodErr) throw new Error(`Failed to fetch products: ${prodErr.message}`);

    const productIds = (products ?? []).map((p) => p.id as string);
    const counts = new Map<string, ProductConfigCount>();
    for (const id of productIds) counts.set(id, { options: 0, materials: 0 });
    if (productIds.length === 0) return counts;

    const [optionsRes, materialsRes] = await Promise.all([
      supabase.from("product_options").select("product_id").in("product_id", productIds),
      supabase
        .from("product_materials")
        .select("product_id")
        .in("product_id", productIds)
        .is("deleted_at", null),
    ]);

    for (const r of optionsRes.data ?? []) {
      const c = counts.get(r.product_id as string);
      if (c) c.options += 1;
    }
    for (const r of materialsRes.data ?? []) {
      const c = counts.get(r.product_id as string);
      if (c) c.materials += 1;
    }
    return counts;
  },
};

export default CatalogProductService;
