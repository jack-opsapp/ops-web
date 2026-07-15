/**
 * OPS Web — Catalog Stock Hooks (TanStack Query)
 *
 * WEB OVERHAUL P3.2. Reads/writes the variant-aware `catalog_*` model and
 * derives the supply-strip glance metrics client-side from the stock rows
 * (no extra round-trips). Quantity adjusts are optimistic with rollback.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { queryKeys } from "../api/query-client";
import { CatalogStockService } from "../api/services/catalog-stock-service";
import { useAuthStore } from "../store/auth-store";
import type { CatalogStockRow } from "../types/catalog";

export function useCatalogStock() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useQuery({
    queryKey: queryKeys.catalog.stock(companyId),
    queryFn: () => CatalogStockService.fetchStock(companyId),
    enabled: !!companyId,
  });
}

// ─── Supply-strip derived metrics ──────────────────────────────────────────────

export interface StockHealth {
  total: number;
  critical: number;
  low: number;
  ok: number;
  untracked: number;
  belowThreshold: number;
  /** Worst variant by qty/critical ratio (ties → lowest absolute qty). */
  worst: CatalogStockRow | null;
}

export interface OnHand {
  /** Sum of quantity × effective cost over costed variants. */
  value: number;
  costedCount: number;
  total: number;
}

export function deriveStockHealth(rows: CatalogStockRow[]): StockHealth {
  let critical = 0;
  let low = 0;
  let ok = 0;
  let untracked = 0;
  let worst: CatalogStockRow | null = null;
  let worstRatio = Infinity;

  for (const r of rows) {
    if (r.status === "critical") critical++;
    else if (r.status === "warning") low++;
    else if (r.status === "untracked") untracked++;
    else ok++;

    if (r.status === "critical" || r.status === "warning") {
      const ref = r.effectiveCritical ?? r.effectiveWarning;
      const ratio = ref && ref > 0 ? r.quantity / ref : r.quantity;
      if (ratio < worstRatio || (ratio === worstRatio && (!worst || r.quantity < worst.quantity))) {
        worstRatio = ratio;
        worst = r;
      }
    }
  }

  return {
    total: rows.length,
    critical,
    low,
    ok,
    untracked,
    belowThreshold: critical + low,
    worst,
  };
}

export function deriveOnHand(rows: CatalogStockRow[]): OnHand {
  let value = 0;
  let costedCount = 0;
  for (const r of rows) {
    if (r.effectiveCost != null) {
      value += r.quantity * r.effectiveCost;
      costedCount++;
    }
  }
  return { value, costedCount, total: rows.length };
}

export function useStockHealth(rows: CatalogStockRow[]): StockHealth {
  return useMemo(() => deriveStockHealth(rows), [rows]);
}

export function useOnHand(rows: CatalogStockRow[]): OnHand {
  return useMemo(() => deriveOnHand(rows), [rows]);
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export function useAdjustQuantity() {
  const queryClient = useQueryClient();
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const userId = currentUser?.id ?? null;
  const key = queryKeys.catalog.stock(companyId);

  return useMutation({
    mutationFn: (params: {
      variantId: string;
      mode: "set" | "delta";
      value: number;
    }) =>
      CatalogStockService.adjustQuantity({
        variantId: params.variantId,
        companyId,
        mode: params.mode,
        value: params.value,
        deductedBy: userId,
      }),
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<CatalogStockRow[]>(key);
      if (prev) {
        queryClient.setQueryData<CatalogStockRow[]>(
          key,
          prev.map((r) => {
            if (r.variantId !== params.variantId) return r;
            const target =
              params.mode === "set" ? params.value : r.quantity + params.value;
            return { ...r, quantity: Math.max(0, target) };
          }),
        );
      }
      return { prev };
    },
    onError: (_err, _params, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
    },
    onSettled: (_data, _err, params) => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({
        queryKey: queryKeys.catalog.adjustments(params.variantId, params.variantId),
      });
    },
  });
}

export function useUpdateVariant() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: ({
      variantId,
      patch,
    }: {
      variantId: string;
      patch: Parameters<typeof CatalogStockService.updateVariant>[1];
    }) => CatalogStockService.updateVariant(variantId, patch),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

export function useCreateFamily() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: (
      input: Omit<Parameters<typeof CatalogStockService.createFamily>[0], "companyId">,
    ) => CatalogStockService.createFamily({ ...input, companyId }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

export function useDeleteVariant() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: (variantId: string) => CatalogStockService.deleteVariant(variantId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

export function useBulkDeleteVariants() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: (variantIds: string[]) => CatalogStockService.bulkDelete(variantIds),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

export function useBulkAdjust() {
  const queryClient = useQueryClient();
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const userId = currentUser?.id ?? null;
  return useMutation({
    mutationFn: ({ variantIds, delta }: { variantIds: string[]; delta: number }) =>
      CatalogStockService.bulkAdjust({ variantIds, companyId, delta, deductedBy: userId }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

export function useBulkSetFamilyTags() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: ({ variantIds, tagIds }: { variantIds: string[]; tagIds: string[] }) =>
      CatalogStockService.bulkSetFamilyTags({ variantIds, companyId, tagIds }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

export function useVariantAdjustments(variantId: string | null, itemId: string | null) {
  return useQuery({
    queryKey: queryKeys.catalog.adjustments(variantId ?? "", itemId ?? ""),
    queryFn: () => CatalogStockService.fetchAdjustments(variantId!, itemId!),
    enabled: !!variantId && !!itemId,
  });
}

export function useVariantUsedIn(variantId: string | null, itemId: string | null) {
  return useQuery({
    queryKey: queryKeys.catalog.usedIn(variantId ?? "", itemId ?? ""),
    queryFn: () => CatalogStockService.fetchUsedIn(variantId!, itemId!),
    enabled: !!variantId && !!itemId,
  });
}
