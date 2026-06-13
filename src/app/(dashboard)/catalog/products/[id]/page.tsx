import { ProductEditor } from "@/components/catalog/product-editor";

/**
 * /catalog/products/[id] — the full product editor (base fields + options +
 * pricing modifiers + recipe). Replaces the retired /products edit-modal and
 * /products/[id]/options page; also the redirect target for the iOS
 * "VIEW ON WEB →" link to /products/{id}.
 */
export default async function CatalogProductEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductEditor productId={id} />;
}
