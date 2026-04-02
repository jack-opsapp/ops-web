import { AdminPageHeader } from "../../_components/admin-page-header";
import { getShopOrders } from "@/lib/admin/shop-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { safe } from "@/lib/utils/safe";
import { OrdersTable } from "./_components/orders-table";

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

export default async function ShopOrdersPage() {
  const [orders, itemCounts] = await Promise.all([
    safe(getShopOrders(), []),
    safe(getOrderItemCounts(), {}),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const o of orders) {
    statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
  }

  const caption = [
    `${orders.length} total`,
    statusCounts.paid ? `${statusCounts.paid} awaiting shipment` : null,
    statusCounts.shipped ? `${statusCounts.shipped} in transit` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <AdminPageHeader title="Shop: Orders" caption={caption} />
      <div className="p-8">
        <OrdersTable orders={orders} orderItemCounts={itemCounts} />
      </div>
    </div>
  );
}
