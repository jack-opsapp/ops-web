import { Suspense } from "react";
import { CatalogSetupRoute } from "@/components/catalog/setup/catalog-setup-route";

/**
 * /catalog/setup — the full-page Catalog Setup Wizard (spec §7). Gated at the
 * layout by the route-registry `catalog.run_setup` entry; the client surface
 * re-checks the permission as defense-in-depth and the RPC enforces write
 * authority. Suspense mirrors the /catalog page (useSearchParams during prerender).
 */
export default function CatalogSetup() {
  return (
    <Suspense fallback={null}>
      <CatalogSetupRoute />
    </Suspense>
  );
}
