"use client";

/**
 * Catalog header kebab — "everything else, one click deep, never a tab"
 * (Direction D). MANAGE (categories / tags / units / threshold defaults) +
 * VIEWS (saved counts / import). Mirrors the iOS kebab groups minus ORDERS
 * (catalog_orders is consumed nowhere on web — no order affordances ship).
 * Manage items gate on inventory.manage; import on inventory.import.
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
  const canManage = can("inventory.manage");
  const canImport = can("inventory.import");
  const canSetup = can("catalog.run_setup");

  const [manageTab, setManageTab] = useState<ManageTab | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[5px] border border-border text-text-2 transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
          >
            <MoreVertical className="h-[16px] w-[16px]" />
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
              <DropdownMenuLabel className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
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
          {segment === "stock" && (
            <>
              {canManage && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
                <span className="text-text-mute">{"// "}</span>
                {t("kebab.views", "VIEWS")}
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => router.replace("/catalog?segment=stock&view=counts", { scroll: false })}
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
        <ManageModal tab={manageTab} onTabChange={setManageTab} onClose={() => setManageTab(null)} />
      )}
      {importOpen && <ImportModal rows={rows} onClose={() => setImportOpen(false)} />}
    </>
  );
}
