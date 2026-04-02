import { AdminPageHeader } from "../../../_components/admin-page-header";
import { getShopCategories } from "@/lib/admin/shop-queries";
import { ProductEditor } from "../_components/product-editor";

export default async function NewProductPage() {
  const categories = await getShopCategories();

  return (
    <div>
      <AdminPageHeader title="New Product" caption="create product" />
      <div className="p-8">
        <ProductEditor product={null} categories={categories} options={[]} variants={[]} />
      </div>
    </div>
  );
}
