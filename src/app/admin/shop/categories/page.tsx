import { AdminPageHeader } from "../../_components/admin-page-header";
import { getShopCategories } from "@/lib/admin/shop-queries";
import { safe } from "@/lib/utils/safe";
import { CategoriesList } from "./_components/categories-list";

export default async function ShopCategoriesPage() {
  const categories = await safe(getShopCategories(), []);

  return (
    <div>
      <AdminPageHeader
        title="Shop: Categories"
        caption={`${categories.length} categor${categories.length !== 1 ? "ies" : "y"}`}
      />
      <div className="p-8">
        <CategoriesList categories={categories} />
      </div>
    </div>
  );
}
