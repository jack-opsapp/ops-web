import { Suspense } from "react";
import { InventoryImportRoute } from "@/components/catalog/setup/inventory-import-route";

export default function CatalogInventoryImportPage() {
  return (
    <Suspense fallback={null}>
      <InventoryImportRoute />
    </Suspense>
  );
}
