"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ProductsTable } from "./products-table";
import { OrdersTable } from "../orders/_components/orders-table";
import { ShippingTable } from "../shipping/_components/shipping-table";
import { CategoriesList } from "../categories/_components/categories-list";
import type {
  ShopProductListItem,
  ShopCategory,
  ShopOrder,
  ShopShippingMethod,
} from "@/lib/admin/shop-types";

const TABS = ["products", "orders", "shipping", "categories"] as const;
type Tab = (typeof TABS)[number];

interface ShopTabsProps {
  products: ShopProductListItem[];
  categories: ShopCategory[];
  lowStockCount: number;
  orders: ShopOrder[];
  orderItemCounts: Record<string, { count: number; firstItem: string }>;
  shippingMethods: ShopShippingMethod[];
}

export function ShopTabs({
  products,
  categories,
  lowStockCount,
  orders,
  orderItemCounts,
  shippingMethods,
}: ShopTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get("tab") as Tab) || "products";

  function setTab(tab: Tab) {
    router.push(`/admin/shop?tab=${tab}`, { scroll: false });
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-white/[0.08] px-8">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={[
              "px-4 py-3 font-mono text-[11px] uppercase tracking-widest transition-colors relative",
              activeTab === tab
                ? "text-[#E5E5E5]"
                : "text-[#6B6B6B] hover:text-[#A0A0A0]",
            ].join(" ")}
          >
            {tab}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-ops-accent" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-8">
        {activeTab === "products" && (
          <ProductsTable
            products={products}
            categories={categories}
            lowStockCount={lowStockCount}
          />
        )}
        {activeTab === "orders" && (
          <OrdersTable orders={orders} orderItemCounts={orderItemCounts} />
        )}
        {activeTab === "shipping" && (
          <ShippingTable methods={shippingMethods} />
        )}
        {activeTab === "categories" && (
          <CategoriesList categories={categories} />
        )}
      </div>
    </div>
  );
}
