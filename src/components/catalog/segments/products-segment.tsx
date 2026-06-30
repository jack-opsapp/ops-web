"use client";

/**
 * Catalog — PRODUCTS segment. The price book: tri-coupled COST/PRICE/MARGIN
 * inline cells (the upkeep flow), CONFIG counts, NO-COST worklist filter.
 * Row click opens the full product editor at /catalog/products/[id] — which
 * also honours the iOS "VIEW ON WEB →" deep link that 404s today.
 *
 * Built on the shared `RegisterTable` row anatomy (WEB OVERHAUL P4-2) — the
 * same primitive Books + Clients use. The inline-edit cells are composed
 * *inside* the table shell (RegisterTable stays presentational); the bare
 * config/trash icons collapse to one labelled ACTIONS overflow (DESIGN.md §11).
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Package, Sliders, Trash2, Star, Plus } from "lucide-react";
import {
  RegisterTable,
  RegisterEmpty,
  TablePrimary,
  Tag,
  type RegisterTableColumn,
} from "@/components/ui/register-table";
import { TableShell, TableWorkbar } from "@/components/ui/table-shell";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
  /** The shared supply MetricsStrip, pinned at the top of the TableShell. */
  metrics: ReactNode;
}

export function ProductsSegment({
  visibleSegments,
  activeSegment,
  segmentCounts,
  onSegmentChange,
  initialFilter,
  configCounts,
  metrics,
}: ProductsSegmentProps) {
  const { t } = useDictionary("catalog");
  const router = useRouter();
  const can = usePermissionStore((s) => s.can);
  const canManage = can("catalog.products.manage");

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

  // Rows are data; verbs live in one labelled overflow (DESIGN.md §11 — the
  // bare Sliders+Trash icons retired). Stop propagation so the menu never also
  // opens the editor (which the row click owns).
  const renderActions = (p: Product) => {
    if (!canManage) return null;
    return (
      <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-[24px] items-center gap-[4px] rounded-chip border border-border px-1 font-mono text-micro font-medium uppercase tracking-[0.12em] text-text-3 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
            >
              {t("actions.menu", "ACTIONS")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/catalog/products/${p.id}`)}>
              <Sliders className="h-[14px] w-[14px] text-text-3" />
              {t("products.options", "OPTIONS & PRICING")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-rose focus:bg-rose-soft focus:text-rose"
              onClick={() => setToDelete(p)}
            >
              <Trash2 className="h-[14px] w-[14px] text-rose" />
              {t("bulk.delete", "DELETE")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const columns: RegisterTableColumn<Product>[] = [
    {
      id: "product",
      header: t("products.col.product", "PRODUCT"),
      cell: (p) => (
        <div className="flex items-center gap-[10px]">
          <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center overflow-hidden rounded-chip border border-border bg-surface-input">
            {p.thumbnailUrl ? (
              <Image src={p.thumbnailUrl} alt="" width={32} height={32} className="object-cover" />
            ) : (
              <Package className="h-[14px] w-[14px] text-text-mute" />
            )}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1">
              {p.isFavorite && <Star className="h-[12px] w-[12px] shrink-0 text-text-3" aria-label="Favorite" />}
              <TablePrimary>{p.name}</TablePrimary>
            </span>
            {p.description && (
              <span className="block max-w-[260px] truncate font-mono text-micro text-text-mute">
                {p.description}
              </span>
            )}
          </span>
        </div>
      ),
    },
    {
      id: "unit",
      header: t("products.col.unit", "UNIT"),
      className: "hidden sm:table-cell",
      cell: (p) => <span className="font-mono text-micro uppercase text-text-3">{p.unit}</span>,
    },
    {
      id: "task",
      header: t("products.col.task", "TASK"),
      className: "hidden lg:table-cell",
      cell: (p) => {
        const tt = p.taskTypeId ? taskTypeMap.get(p.taskTypeId) : null;
        return tt ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[8px] w-[8px] rounded-full" style={{ backgroundColor: tt.color }} />
            <span className="font-mono text-micro text-text-2">{tt.display}</span>
          </span>
        ) : (
          <span className="font-mono text-micro text-text-mute">—</span>
        );
      },
    },
    {
      id: "cost",
      header: t("products.col.cost", "COST"),
      align: "right",
      cell: (p) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
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
        </span>
      ),
    },
    {
      id: "price",
      header: t("products.col.price", "PRICE"),
      align: "right",
      cell: (p) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <InlineMoneyCell
            value={p.defaultPrice}
            editable={canManage}
            editing={editCell?.id === p.id && editCell.field === "price"}
            onRequestEdit={() => setEditCell({ id: p.id, field: "price" })}
            onCommit={(v) => commitMoney(p.id, "price", v)}
            onCancel={() => setEditCell(null)}
          />
        </span>
      ),
    },
    {
      id: "margin",
      header: t("products.col.margin", "MARGIN"),
      align: "right",
      cell: (p) => {
        const margin = productMargin(p.defaultPrice, p.unitCost);
        return (
          <span
            className={cn(
              "font-mono text-data-sm tabular-nums",
              margin != null ? "text-olive" : "text-text-mute",
            )}
          >
            {fmtMargin(margin)}
          </span>
        );
      },
    },
    {
      id: "tax",
      header: t("products.col.tax", "TAX"),
      className: "hidden md:table-cell",
      cell: (p) => (
        <Tag variant={p.isTaxable ? "olive" : "dim"}>
          {p.isTaxable ? t("products.tax.yes", "YES") : t("products.tax.no", "NO")}
        </Tag>
      ),
    },
    {
      id: "config",
      header: t("products.col.config", "CONFIG"),
      className: "hidden lg:table-cell",
      cell: (p) => {
        const cfg = configCounts?.get(p.id);
        return cfg && (cfg.options > 0 || cfg.materials > 0) ? (
          <span className="font-mono text-micro uppercase tracking-[0.08em] text-text-3 tabular-nums">
            {[
              cfg.options > 0 ? t("products.config.options", { n: cfg.options }) : null,
              cfg.materials > 0 ? t("products.config.materials", { n: cfg.materials }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : (
          <span className="font-mono text-micro text-text-mute">—</span>
        );
      },
    },
    { id: "actions", header: "", align: "right", className: "w-[84px]", cell: renderActions },
  ];

  return (
    <>
      <TableShell
        metrics={metrics}
        toolbar={
          <TableWorkbar>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CatalogSegmentControl options={segmentOptions} value={activeSegment} onChange={onSegmentChange} />
              <div className="flex items-center gap-2">
                <SearchInput
                  placeholder={t("products.search", "Search products…")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  wrapperClassName="w-[220px] max-w-full"
                />
                {canManage && (
                  <Button variant="primary" size="sm" type="button" onClick={() => setAddOpen(true)}>
                    <Plus className="h-[14px] w-[14px]" strokeWidth={1.5} aria-hidden />
                    {t("stock.add", "ADD")}
                  </Button>
                )}
                <CatalogKebab segment="products" rows={[]} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-[12px]">
              <FilterChips options={filterOptions} value={filter} onChange={setFilter} />
              <span className="font-mono text-micro text-text-3 tabular-nums">
                {t("products.count", { n: filtered.length })}
              </span>
            </div>
          </TableWorkbar>
        }
        isEmpty={isLoading || filtered.length === 0}
        emptyState={
          isLoading ? (
            <div className="animate-pulse space-y-[2px] p-3 motion-reduce:animate-none">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-surface h-[48px]" />
              ))}
            </div>
          ) : (
            <RegisterEmpty
              noun={search || filter !== "all" ? t("products.empty.matches") : t("products.empty.noun")}
            />
          )
        }
      >
        <RegisterTable<Product>
          columns={columns}
          rows={filtered}
          getRowId={(p) => p.id}
          onRowClick={(p) => router.push(`/catalog/products/${p.id}`)}
          ariaLabel={t("segment.products", "Products")}
          inShell
        />
      </TableShell>

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
    </>
  );
}
