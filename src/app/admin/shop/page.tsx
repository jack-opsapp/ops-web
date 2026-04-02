import { AdminPageHeader } from "../_components/admin-page-header";
import { getShopProducts, getLowStockVariantCount, getShopCategories } from "@/lib/admin/shop-queries";
import { safe } from "@/lib/utils/safe";
import { ProductsTable } from "./_components/products-table";

export default async function ShopProductsPage() {
  const [products, lowStockCount, categories] = await Promise.all([
    safe(getShopProducts(), []),
    safe(getLowStockVariantCount(), 0),
    safe(getShopCategories(), []),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Shop: Products"
        caption={`${products.length} products · ${lowStockCount > 0 ? `${lowStockCount} low stock` : "stock healthy"}`}
      />
      <div className="p-8">
        <ProductsTable
          products={products}
          categories={categories}
          lowStockCount={lowStockCount}
        />
      </div>
    </div>
  );
}
