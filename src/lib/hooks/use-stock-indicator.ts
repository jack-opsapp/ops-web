/**
 * OPS Web - Stock Indicator Hook
 *
 * Computes stock availability for estimate line items by resolving
 * line_item_materials (overrides) or product_materials (BOM defaults)
 * against current inventory quantities.
 */

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  LineItemStockStatus,
  MaterialStockCheck,
  StockStatus,
} from "../types/product-materials";

interface LineItemInput {
  id: string;
  productId: string | null;
  quantity: number;
}

async function computeStockStatus(lineItems: LineItemInput[]): Promise<LineItemStockStatus[]> {
  const supabase = requireSupabase();
  const results: LineItemStockStatus[] = [];

  const productIds = [...new Set(lineItems.map((li) => li.productId).filter(Boolean))] as string[];
  if (productIds.length === 0) {
    return lineItems.map((li) => ({
      lineItemId: li.id,
      overallStatus: "no_bom" as StockStatus,
      materials: [],
    }));
  }

  const { data: allBom } = await supabase
    .from("product_materials")
    .select("product_id, inventory_item_id, quantity_per_unit")
    .in("product_id", productIds);

  const lineItemIds = lineItems.map((li) => li.id);
  const { data: allOverrides } = await supabase
    .from("line_item_materials")
    .select("line_item_id, inventory_item_id, quantity")
    .in("line_item_id", lineItemIds);

  const inventoryItemIds = new Set<string>();
  (allBom ?? []).forEach((b) => inventoryItemIds.add(b.inventory_item_id as string));
  (allOverrides ?? []).forEach((o) => inventoryItemIds.add(o.inventory_item_id as string));

  if (inventoryItemIds.size === 0) {
    return lineItems.map((li) => ({
      lineItemId: li.id,
      overallStatus: "no_bom" as StockStatus,
      materials: [],
    }));
  }

  const { data: items } = await supabase
    .from("inventory_items")
    .select("id, name, quantity, warning_threshold, deleted_at")
    .in("id", [...inventoryItemIds])
    .is("deleted_at", null);

  const itemMap = new Map((items ?? []).map((i) => [i.id as string, i]));

  for (const li of lineItems) {
    const overrides = (allOverrides ?? []).filter((o) => o.line_item_id === li.id);

    let materialChecks: MaterialStockCheck[];

    if (overrides.length > 0) {
      materialChecks = overrides.map((o) => {
        const item = itemMap.get(o.inventory_item_id as string);
        const required = Number(o.quantity);
        const available = item ? Number(item.quantity) : 0;
        const threshold = item?.warning_threshold != null ? Number(item.warning_threshold) : null;

        let status: StockStatus = "sufficient";
        if (required > available) status = "insufficient";
        else if (threshold != null && available - required <= threshold) status = "warning";

        return {
          inventoryItemId: o.inventory_item_id as string,
          inventoryItemName: item ? (item.name as string) : "Unknown",
          required,
          available,
          warningThreshold: threshold,
          status,
        };
      });
    } else if (li.productId) {
      const bom = (allBom ?? []).filter((b) => b.product_id === li.productId);
      if (bom.length === 0) {
        results.push({ lineItemId: li.id, overallStatus: "no_bom", materials: [] });
        continue;
      }

      materialChecks = bom.map((b) => {
        const item = itemMap.get(b.inventory_item_id as string);
        const required = li.quantity * Number(b.quantity_per_unit);
        const available = item ? Number(item.quantity) : 0;
        const threshold = item?.warning_threshold != null ? Number(item.warning_threshold) : null;

        let status: StockStatus = "sufficient";
        if (required > available) status = "insufficient";
        else if (threshold != null && available - required <= threshold) status = "warning";

        return {
          inventoryItemId: b.inventory_item_id as string,
          inventoryItemName: item ? (item.name as string) : "Unknown",
          required,
          available,
          warningThreshold: threshold,
          status,
        };
      });
    } else {
      results.push({ lineItemId: li.id, overallStatus: "no_bom", materials: [] });
      continue;
    }

    let overall: StockStatus = "sufficient";
    for (const mc of materialChecks) {
      if (mc.status === "insufficient") {
        overall = "insufficient";
        break;
      }
      if (mc.status === "warning") overall = "warning";
    }

    results.push({ lineItemId: li.id, overallStatus: overall, materials: materialChecks });
  }

  return results;
}

export function useStockIndicator(lineItems: LineItemInput[]) {
  const ids = lineItems.map((li) => li.id).sort();

  return useQuery({
    queryKey: queryKeys.stockIndicator.forLineItems(ids),
    queryFn: () => computeStockStatus(lineItems),
    enabled: lineItems.length > 0,
    staleTime: 30_000,
  });
}
