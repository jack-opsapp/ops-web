import { notFound } from "next/navigation";
import { AdminPageHeader } from "../../../_components/admin-page-header";
import {
  getShopProductById,
  getShopCategories,
  getShopProductOptions,
  getShopVariants,
} from "@/lib/admin/shop-queries";
import { ProductEditor } from "../_components/product-editor";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: PageProps) {
  const { id } = await params;
  const [product, categories, options, variants] = await Promise.all([
    getShopProductById(id),
    getShopCategories(),
    getShopProductOptions(id),
    getShopVariants(id),
  ]);

  if (!product) notFound();

  return (
    <div>
      <AdminPageHeader title="Edit Product" caption={product.name} />
      <div className="p-8">
        <ProductEditor
          product={product}
          categories={categories}
          options={options}
          variants={variants}
        />
      </div>
    </div>
  );
}
