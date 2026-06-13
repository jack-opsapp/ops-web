"use client";

/**
 * Catalog — PRODUCTS segment. The price book: tri-coupled COST/PRICE/MARGIN
 * inline cells (the upkeep flow), CONFIG counts, NO-COST worklist filter.
 * Row click opens the full product editor at /catalog/products/[id] — which
 * also honours the iOS "VIEW ON WEB →" deep link that 404s today.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, Package, Sliders, Trash2, Star } from "lucide-react";
import { RegisterEmpty } from "@/components/ui/register-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { cn } from "@/lib/utils/cn";
import {
  useProducts,
  useUpdateProduct,
  useDeleteProduct,
  useTaskTypes,
} from "@/lib/hooks";
import { productMargin } from "@/lib/types/catalog";
import type { Product } from "@/lib/types/pipeline";
import type { ProductConfigCount } from "@/lib/api/services";
import {
  CatalogSegmentControl,
  FilterChips,
  type SegmentOption,
} from "../segment-toolbar";
import { InlineMoneyCell } from "../cells";
import { CatalogKebab } from "../catalog-kebab";
import { ProductQuickAdd } from "../modals/product-quick-add";
import { fmtMargin } from "../format";
import type { CatalogSegment } from "../catalog-page";

type ProductFilter = "all" | "services" | "goods" | "hasOptions" | "noCost" | "favorites";

export interface ProductsSegmentProps {
  visibleSegments: CatalogSegment[];
  activeSegment: CatalogSegment;
  segmentCounts: { products: number; stock: number };
  onSegmentChange: (s: CatalogSegment) => void;
  initialFilter: string | null;
  configCounts: Map<string, ProductConfigCount> | undefined;
}

export function ProductsSegment({
  visibleSegments,
  activeSegment,
  segmentCounts,
  onSegmentChange,
  initialFilter,
  configCounts,
}: ProductsSegmentProps) {
  const { t } = useDictionary("catalog");
  const router = useRouter();
  const can = usePermissionStore((s) => s.can);
  const canManage = can("products.manage");

  const { data: products = [], isLoading } = useProducts(false);
  const { data: taskTypes = [] } = useTaskTypes();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProductFilter>(
    initialFilter === "nocost" ? "noCost" : "all",
  );
  const [editCell, setEditCell] = useState<{ id: string; field: "cost" | "price" } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Product | null>(null);

  const taskTypeMap = useMemo(() => {
    const m = new Map<string, { display: string; color: string }>();
    for (const tt of taskTypes) m.set(tt.id, { display: tt.display, color: tt.color });
    return m;
  }, [taskTypes]);

  const filterOptions = useMemo<{ value: ProductFilter; label: string }[]>(
    () => [
      { value: "all", label: t("filter.all", "ALL") },
      { value: "services", label: t("filter.services", "SERVICES") },
      { value: "goods", label: t("filter.goods", "GOODS") },
      { value: "hasOptions", label: t("filter.hasOptions", "HAS OPTIONS") },
      { value: "noCost", label: t("filter.noCost", "NO COST") },
      { value: "favorites", label: t("filter.favorites", "FAVORITES") },
    ],
    [t],
  );

  const filtered = useMemo(() => {
    let list = products.filter((p) => !p.deletedAt);
    if (filter === "services") list = list.filter((p) => p.kind === "service");
    else if (filter === "goods") list = list.filter((p) => p.kind === "good");
    else if (filter === "noCost") list = list.filter((p) => p.unitCost == null);
    else if (filter === "favorites") list = list.filter((p) => p.isFavorite);
    else if (filter === "hasOptions")
      list = list.filter((p) => (configCounts?.get(p.id)?.options ?? 0) > 0);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q),
      );
    }
    // favorites first, then name.
    return [...list].sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [products, filter, search, configCounts]);

  const segmentOptions = useMemo<SegmentOption<CatalogSegment>[]>(
    () =>
      visibleSegments.map((s) => ({
        value: s,
        label: s === "stock" ? t("segment.stock", "Stock") : t("segment.products", "Products"),
        count: s === "stock" ? segmentCounts.stock : segmentCounts.products,
      })),
    [visibleSegments, segmentCounts, t],
  );

  const commitMoney = useCallback(
    (id: string, field: "cost" | "price", value: number | null) => {
      updateProduct.mutate({
        id,
        data: field === "cost" ? { unitCost: value } : { defaultPrice: value ?? 0 },
      });
      setEditCell(null);
    },
    [updateProduct],
  );

  const th =
    "px-2 py-1.5 text-left font-mono text-[11px] font-normal uppercase tracking-[0.16em] text-text-3";

  return (
    <div className="space-y-[14px]">
      {/* Workbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CatalogSegmentControl options={segmentOptions} value={activeSegment} onChange={onSegmentChange} />
        <div className="flex items-center gap-2">
          <div className="w-[260px] max-w-full">
            <Input
              placeholder={t("products.search", "Search products…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              prefixIcon={<Search className="h-[16px] w-[16px]" />}
            />
          </div>
          {canManage && (
            <Button
              variant="secondary"
              className="gap-[6px] border-ops-accent bg-transparent font-cakemono font-light uppercase text-ops-accent hover:border-ops-accent hover:bg-ops-accent hover:text-black"
              onClick={() => setAddOpen(true)}
            >
              {t("stock.add", "+ ADD")}
            </Button>
          )}
          <CatalogKebab segment="products" rows={[]} />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-[12px]">
        <FilterChips options={filterOptions} value={filter} onChange={setFilter} />
        <span className="font-mono text-[11px] text-text-3 tabular-nums">
          {t("products.count", { n: filtered.length })}
        </span>
      </div>

      {/* Table */}
      <div className="glass-surface overflow-hidden">
        {isLoading ? (
          <div className="animate-pulse space-y-[2px] p-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[48px] rounded bg-fill-neutral-dim/40" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <RegisterEmpty
            noun={
              search || filter !== "all"
                ? t("products.empty.matches")
                : t("products.empty.noun")
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-border">
                  <th className={th}>{t("products.col.product", "PRODUCT")}</th>
                  <th className={cn(th, "hidden sm:table-cell")}>{t("products.col.unit", "UNIT")}</th>
                  <th className={cn(th, "hidden lg:table-cell")}>{t("products.col.task", "TASK")}</th>
                  <th className={cn(th, "text-right")}>{t("products.col.cost", "COST")}</th>
                  <th className={cn(th, "text-right")}>{t("products.col.price", "PRICE")}</th>
                  <th className={cn(th, "text-right")}>{t("products.col.margin", "MARGIN")}</th>
                  <th className={cn(th, "hidden md:table-cell")}>{t("products.col.tax", "TAX")}</th>
                  <th className={cn(th, "hidden lg:table-cell")}>{t("products.col.config", "CONFIG")}</th>
                  <th className={cn(th, "w-[84px] text-right")} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const margin = productMargin(p.defaultPrice, p.unitCost);
                  const tt = p.taskTypeId ? taskTypeMap.get(p.taskTypeId) : null;
                  const cfg = configCounts?.get(p.id);
                  return (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-b border-[rgba(255,255,255,0.05)] transition-colors last:border-b-0 hover:bg-surface-hover"
                      onClick={() => router.push(`/catalog/products/${p.id}`)}
                    >
                      {/* Product */}
                      <td className="px-2 py-[11px]">
                        <div className="flex items-center gap-[10px]">
                          <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-border bg-surface-input">
                            {p.thumbnailUrl ? (
                              <Image src={p.thumbnailUrl} alt="" width={32} height={32} className="object-cover" />
                            ) : (
                              <Package className="h-[14px] w-[14px] text-text-mute" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1 font-mohave text-[14px] text-text">
                              {p.isFavorite && <Star className="h-[12px] w-[12px] text-text-3" aria-label="Favorite" />}
                              <span className="truncate">{p.name}</span>
                            </span>
                            {p.description && (
                              <span className="block max-w-[260px] truncate font-mono text-[11px] text-text-mute">
                                {p.description}
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      {/* Unit */}
                      <td className="hidden px-2 py-[11px] sm:table-cell">
                        <span className="font-mono text-[11px] uppercase text-text-3">{p.unit}</span>
                      </td>
                      {/* Task */}
                      <td className="hidden px-2 py-[11px] lg:table-cell">
                        {tt ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-[8px] w-[8px] rounded-full"
                              style={{ backgroundColor: tt.color }}
                            />
                            <span className="font-mono text-[11px] text-text-2">{tt.display}</span>
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-text-mute">—</span>
                        )}
                      </td>
                      {/* Cost (editable) */}
                      <td className="px-2 py-[11px] text-right" onClick={(e) => e.stopPropagation()}>
                        <InlineMoneyCell
                          value={p.unitCost}
                          dim
                          emptyTone="rose"
                          editable={canManage}
                          editing={editCell?.id === p.id && editCell.field === "cost"}
                          onRequestEdit={() => setEditCell({ id: p.id, field: "cost" })}
                          onCommit={(v) => commitMoney(p.id, "cost", v)}
                          onCancel={() => setEditCell(null)}
                        />
                      </td>
                      {/* Price (editable) */}
                      <td className="px-2 py-[11px] text-right" onClick={(e) => e.stopPropagation()}>
                        <InlineMoneyCell
                          value={p.defaultPrice}
                          editable={canManage}
                          editing={editCell?.id === p.id && editCell.field === "price"}
                          onRequestEdit={() => setEditCell({ id: p.id, field: "price" })}
                          onCommit={(v) => commitMoney(p.id, "price", v)}
                          onCancel={() => setEditCell(null)}
                        />
                      </td>
                      {/* Margin (derived) */}
                      <td className="px-2 py-[11px] text-right">
                        <span
                          className={cn(
                            "font-mono text-[13px] tabular-nums",
                            margin != null ? "text-olive" : "text-text-mute",
                          )}
                        >
                          {fmtMargin(margin)}
                        </span>
                      </td>
                      {/* Tax */}
                      <td className="hidden px-2 py-[11px] md:table-cell">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-[4px] border px-[6px] py-[2px] font-mono text-[11px] font-medium uppercase tracking-[0.12em]",
                            p.isTaxable
                              ? "border-olive-line bg-olive-soft text-olive"
                              : "border-border bg-transparent text-text-mute",
                          )}
                        >
                          {p.isTaxable ? t("products.tax.yes", "YES") : t("products.tax.no", "NO")}
                        </span>
                      </td>
                      {/* Config */}
                      <td className="hidden px-2 py-[11px] lg:table-cell">
                        {cfg && (cfg.options > 0 || cfg.materials > 0) ? (
                          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-3 tabular-nums">
                            {[
                              cfg.options > 0 ? t("products.config.options", { n: cfg.options }) : null,
                              cfg.materials > 0 ? t("products.config.materials", { n: cfg.materials }) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-text-mute">—</span>
                        )}
                      </td>
                      {/* Actions */}
                      <td className="px-2 py-[11px] text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => router.push(`/catalog/products/${p.id}`)}
                              className="rounded p-[4px] text-text-3 transition-colors hover:bg-surface-active hover:text-text"
                              title={t("products.options", "OPTIONS & PRICING")}
                            >
                              <Sliders className="h-[14px] w-[14px]" />
                            </button>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => setToDelete(p)}
                              className="rounded p-[4px] text-text-mute transition-colors hover:bg-rose-soft hover:text-rose"
                              title="Delete"
                            >
                              <Trash2 className="h-[14px] w-[14px]" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete product?"
        description={toDelete ? `Permanently delete "${toDelete.name}"? This cannot be undone.` : ""}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteProduct.isPending}
        onConfirm={() => {
          if (!toDelete) return;
          deleteProduct.mutate(toDelete.id, { onSuccess: () => setToDelete(null) });
        }}
      />

      {addOpen && (
        <ProductQuickAdd
          onClose={() => setAddOpen(false)}
          onCreated={(id) => {
            setAddOpen(false);
            router.push(`/catalog/products/${id}`);
          }}
        />
      )}
    </div>
  );
}
