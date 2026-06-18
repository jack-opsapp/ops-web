import { Suspense } from "react";
import { CatalogPage } from "@/components/catalog/catalog-page";

/**
 * /catalog — the variant-aware price book + stock hub (WEB OVERHAUL P3.2).
 * Suspense boundary is required for useSearchParams during prerender.
 */
export default function Catalog() {
  return (
    <Suspense fallback={null}>
      <CatalogPage />
    </Suspense>
  );
}
