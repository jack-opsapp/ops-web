"use client";

/**
 * Catalog import modal — the 4-step CSV wizard (upload → map → preview →
 * apply). Reuses the existing inventory import steps; rows land in catalog_*
 * via the `inventory_items` INSTEAD-OF-INSERT trigger (which materializes a
 * catalog_items + catalog_variants pair per row). On close the catalog stock
 * query is invalidated so new rows appear immediately.
 */

import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDictionary } from "@/i18n/client";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import { ImportTab } from "@/components/inventory/import-tab";
import type { CatalogStockRow } from "@/lib/types/catalog";

export function ImportModal({
  rows: _rows,
  onClose,
}: {
  rows: CatalogStockRow[];
  onClose: () => void;
}) {
  const { t } = useDictionary("catalog");
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) {
          queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="font-cakemono text-[18px] font-light uppercase tracking-[0.02em] text-text">
            {t("import.title", "IMPORT CSV")}
          </DialogTitle>
        </DialogHeader>
        <ImportTab />
      </DialogContent>
    </Dialog>
  );
}
