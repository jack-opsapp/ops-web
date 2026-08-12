"use client";

/**
 * Catalog header kebab — "everything else, one click deep, never a tab"
 * (Direction D). MANAGE (categories / tags / units / threshold defaults) +
 * VIEWS (saved counts / import). Mirrors the iOS kebab groups minus ORDERS
 * (catalog_orders is consumed nowhere on web — no order affordances ship).
 * Manage items gate on catalog.manage; import on catalog.import.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { CatalogStockRow } from "@/lib/types/catalog";
import { ManageModal, type ManageTab } from "./modals/manage-modal";
import { ImportModal } from "./modals/import-modal";
import { BulkAddVariantsDialog } from "./modals/bulk-add-variants-dialog";

export function CatalogKebab({
  segment,
  rows,
}: {
  segment: "stock" | "products";
  rows: CatalogStockRow[];
}) {
  const { t } = useDictionary("catalog");
  const router = useRouter();
  const can = usePermissionStore((s) => s.can);
  const canManage = can("catalog.manage");
  const canImport = can("catalog.import");
  const canSetup = can("catalog.run_setup");

  const [manageTab, setManageTab] = useState<ManageTab | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkVariantsOpen, setBulkVariantsOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More"
            className="inline-flex h-control-36 w-control-36 items-center justify-center rounded border border-border text-text-2 transition-colors ease-smooth hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <MoreVertical className="h-icon-16 w-icon-16" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px]">
          {canSetup && (
            <>
              <DropdownMenuItem onSelect={() => router.push("/catalog/setup")}>
                {t("kebab.setup", "Set up catalog")}
              </DropdownMenuItem>
              {(canManage || segment === "stock") && <DropdownMenuSeparator />}
            </>
          )}
          {canManage && (
            <>
              <DropdownMenuLabel className="font-mono text-micro uppercase tracking-widest text-text-3">
                <span className="text-text-mute">{"// "}</span>
                {t("kebab.manage", "MANAGE")}
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setManageTab("categories")}>
                {t("kebab.categories", "Categories")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setManageTab("tags")}>
                {t("kebab.tags", "Tags")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setManageTab("units")}>
                {t("kebab.units", "Units")}
              </DropdownMenuItem>
              {segment === "stock" && (
                <DropdownMenuItem onSelect={() => setManageTab("thresholds")}>
                  {t("kebab.thresholdDefaults", "Threshold defaults")}
                </DropdownMenuItem>
              )}
            </>
          )}
          {segment === "stock" && canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="font-mono text-micro uppercase tracking-widest text-text-3">
                <span className="text-text-mute">{"// "}</span>
                {t("kebab.stock", "STOCK")}
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setBulkVariantsOpen(true)}>
                {t("kebab.bulkAddVariants", "Bulk Add Variants")}
              </DropdownMenuItem>
            </>
          )}
          {segment === "stock" && (
            <>
              {canManage && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="font-mono text-micro uppercase tracking-widest text-text-3">
                <span className="text-text-mute">{"// "}</span>
                {t("kebab.views", "VIEWS")}
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() =>
                  router.replace("/catalog?segment=stock&view=counts", {
                    scroll: false,
                  })
                }
              >
                {t("kebab.savedCounts", "Saved counts")}
              </DropdownMenuItem>
              {canImport && (
                <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                  {t("kebab.import", "Import CSV")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {manageTab && (
        <ManageModal
          tab={manageTab}
          onTabChange={setManageTab}
          onClose={() => setManageTab(null)}
        />
      )}
      {importOpen && (
        <ImportModal rows={rows} onClose={() => setImportOpen(false)} />
      )}
      {bulkVariantsOpen && (
        <BulkAddVariantsDialog onClose={() => setBulkVariantsOpen(false)} />
      )}
    </>
  );
}
