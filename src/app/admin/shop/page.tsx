import { Suspense } from "react";
import { AdminPageHeader } from "../_components/admin-page-header";
import {
  getShopProducts,
  getLowStockVariantCount,
  getShopCategories,
  getShopOrders,
  getShopShippingMethods,
} from "@/lib/admin/shop-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { safe } from "@/lib/utils/safe";
import { ShopTabs } from "./_components/shop-tabs";

async function getOrderItemCounts(): Promise<Record<string, { count: number; firstItem: string }>> {
  const db = getAdminSupabase();
  const { data } = await db
    .from("shop_order_items")
    .select("order_id, product_name, quantity");

  const map: Record<string, { count: number; firstItem: string }> = {};
  for (const item of data ?? []) {
    if (!map[item.order_id]) {
      map[item.order_id] = { count: 0, firstItem: item.product_name };
    }
    map[item.order_id].count += item.quantity;
  }
  return map;
}

export default async function ShopPage() {
  const [products, lowStockCount, categories, orders, orderItemCounts, shippingMethods] =
    await Promise.all([
      safe(getShopProducts(), []),
      safe(getLowStockVariantCount(), 0),
      safe(getShopCategories(), []),
      safe(getShopOrders(), []),
      safe(getOrderItemCounts(), {}),
      safe(getShopShippingMethods(), []),
    ]);

  return (
    <div>
      <AdminPageHeader title="Shop" caption={`${products.length} products · ${orders.length} orders`} />
      <Suspense>
        <ShopTabs
          products={products}
          categories={categories}
          lowStockCount={lowStockCount}
          orders={orders}
          orderItemCounts={orderItemCounts}
          shippingMethods={shippingMethods}
        />
      </Suspense>
    </div>
  );
}
