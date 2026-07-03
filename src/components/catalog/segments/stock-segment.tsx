"use client";

/**
 * Catalog — STOCK segment. Serves the buy-run triage and count/receive flows
 * (Direction D). Flat per-variant rows by default (every column globally
 * sortable for triage); an opt-in GROUP::FAMILY mode clusters variants.
 * Inline QTY editing writes audited adjustments; row click opens the drawer.
 *
 * The flat table is built on the shared `RegisterTable` row anatomy (WEB
 * OVERHAUL P4-2) — same primitive Books + Clients use — with the inline QTY
 * cell composed inside the shell and the drawer-open row tinted via the
 * primitive's `isRowActive`. The clustered GROUP::FAMILY view stays bespoke
 * (RegisterTable models flat rows, not grouping).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import {
  RegisterTable,
  RegisterEmpty,
  TablePrimary,
  Tag,
  type RegisterTableColumn,
  type TagProps,
} from "@/components/ui/register-table";
import { TableShell, Workbar, WorkbarButton, WorkbarCount } from "@/components/ui/table-shell";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { cn } from "@/lib/utils/cn";
import { matchesAllTokens } from "@/lib/utils/search";
import type { CatalogStockRow, CatalogStatus } from "@/lib/types/catalog";
import {
  useAdjustQuantity,
  useBulkDeleteVariants,
} from "@/lib/hooks/use-catalog-stock";
import { useCatalogCategories } from "@/lib/hooks/use-catalog-meta";
import {
  CatalogSegmentControl,
  FilterChips,
  DrillChip,
  type SegmentOption,
} from "../segment-toolbar";
import { InlineQtyCell } from "../cells";
import { fmtMoney, fmtQty } from "../format";
import { StockDrawer } from "../stock-drawer";
import { CatalogKebab } from "../catalog-kebab";
import { SnapshotsView } from "../snapshots-view";
import { AddStockDialog } from "../modals/add-stock-dialog";
import type { CatalogSegment } from "../catalog-page";

const STATUS_ORDER: Record<CatalogStatus, number> = {
  critical: 0,
  warning: 1,
  normal: 2,
  untracked: 3,
};

const STATUS_VARIANT: Record<CatalogStatus, TagProps["variant"]> = {
  critical: "rose",
  warning: "tan",
  normal: "neutral",
  untracked: "mute",
};

function StatusTag({ status }: { status: CatalogStatus }) {
  const { t } = useDictionary("catalog");
  const label =
    status === "critical"
      ? t("stock.status.critical", "CRITICAL")
      : status === "warning"
        ? t("stock.status.low", "LOW")
        : status === "untracked"
          ? t("stock.status.untracked", "UNTRACKED")
          : t("stock.status.ok", "OK");
  return <Tag variant={STATUS_VARIANT[status]}>{label}</Tag>;
}

export interface StockSegmentProps {
  visibleSegments: CatalogSegment[];
  activeSegment: CatalogSegment;
  segmentCounts: { products: number; stock: number };
  onSegmentChange: (s: CatalogSegment) => void;
  drilled: boolean;
  view: "list" | "counts";
  onClearDrill: () => void;
  onCloseCounts: () => void;
  openCreate: boolean;
  onCreateHandled: () => void;
  rows: CatalogStockRow[];
  loading: boolean;
  /** The shared supply MetricsStrip, pinned at the top of the TableShell. */
  metrics: ReactNode;
}

const GROUP_KEY = "catalog.groupByFamily";

export function StockSegment({
  visibleSegments,
  activeSegment,
  segmentCounts,
  onSegmentChange,
  drilled,
  view,
  onClearDrill,
  onCloseCounts,
  openCreate,
  onCreateHandled,
  rows,
  loading,
  metrics,
}: StockSegmentProps) {
  const { t } = useDictionary("catalog");
  const can = usePermissionStore((s) => s.can);
  const canManage = can("catalog.manage");

  const adjust = useAdjustQuantity();
  const bulkDelete = useBulkDeleteVariants();
  const { data: categories = [] } = useCatalogCategories();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [groupByFamily, setGroupByFamily] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [drawerVariantId, setDrawerVariantId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const g = window.localStorage.getItem(GROUP_KEY);
    if (g === "1") setGroupByFamily(true);
  }, []);

  // FAB / legacy /inventory?action=new deep link auto-opens the add dialog.
  useEffect(() => {
    if (openCreate && canManage) {
      setAddOpen(true);
      onCreateHandled();
    }
  }, [openCreate, canManage, onCreateHandled]);
  const toggleGroup = useCallback(() => {
    setGroupByFamily((prev) => {
      const next = !prev;
      window.localStorage.setItem(GROUP_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  // Any threshold filter/sort forces flat (group-by would break critical-first).
  const effectiveGroup = groupByFamily && !drilled;

  const segmentOptions = useMemo<SegmentOption<CatalogSegment>[]>(
    () =>
      visibleSegments.map((s) => ({
        value: s,
        label: s === "stock" ? t("segment.stock", "Stock") : t("segment.products", "Products"),
        count: s === "stock" ? segmentCounts.stock : segmentCounts.products,
      })),
    [visibleSegments, segmentCounts, t],
  );

  const categoryOptions = useMemo(
    () => [
      { value: "all", label: t("filter.all", "ALL") },
      ...categories
        .filter((c) => !c.parentId)
        .map((c) => ({ value: c.id, label: c.name.toUpperCase() })),
    ],
    [categories, t],
  );

  const filtered = useMemo(() => {
    let list = rows;
    if (drilled) {
      list = list.filter((r) => r.status === "critical" || r.status === "warning");
    }
    if (categoryFilter !== "all") {
      list = list.filter((r) => r.categoryId === categoryFilter);
    }
    if (search.trim()) {
      // Shared token-AND search grammar (lib/utils/search).
      list = list.filter((r) =>
        matchesAllTokens(
          [r.familyName, r.variantLabel ?? "", r.sku ?? "", r.familyDescription ?? ""]
            .join(" ")
            .toLowerCase(),
          search,
        ),
      );
    }
    if (drilled) {
      list = [...list].sort((a, b) => {
        const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (s !== 0) return s;
        return a.quantity - b.quantity;
      });
    }
    return list;
  }, [rows, drilled, categoryFilter, search]);

  // Buy-to-threshold total over costed below-threshold rows.
  const buyTotal = useMemo(() => {
    if (!drilled) return null;
    let total = 0;
    let uncosted = 0;
    for (const r of filtered) {
      const ref = r.effectiveCritical ?? r.effectiveWarning;
      const short = ref != null ? Math.max(0, ref - r.quantity) : 0;
      if (r.effectiveCost != null) total += short * r.effectiveCost;
      else uncosted += 1;
    }
    return { total, uncosted };
  }, [filtered, drilled]);

  // ── Inline qty commit + advance down the column ───────────────────────────
  const visibleOrder = useMemo(() => filtered.map((r) => r.variantId), [filtered]);
  const commitQty = useCallback(
    (variantId: string, result: { mode: "set" | "delta"; value: number }) => {
      adjust.mutate({ variantId, ...result });
      const idx = visibleOrder.indexOf(variantId);
      const next = visibleOrder[idx + 1] ?? null;
      setEditId(next);
    },
    [adjust, visibleOrder],
  );

  // ── Selection ─────────────────────────────────────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.variantId));
  const toggleAll = useCallback(() => {
    setSelectedIds(allSelected ? new Set() : new Set(filtered.map((r) => r.variantId)));
  }, [allSelected, filtered]);
  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Copy buy list (plain text, textable) ──────────────────────────────────
  const copyList = useCallback(async () => {
    const byCat = new Map<string, CatalogStockRow[]>();
    for (const r of filtered) {
      const key = r.categoryName ?? "—";
      const list = byCat.get(key) ?? [];
      list.push(r);
      byCat.set(key, list);
    }
    const lines: string[] = [];
    for (const [cat, list] of byCat) {
      lines.push(cat.toUpperCase());
      for (const r of list) {
        const ref = r.effectiveCritical ?? r.effectiveWarning;
        const short = ref != null ? Math.max(0, ref - r.quantity) : 0;
        const name = [r.familyName, r.variantLabel].filter(Boolean).join(" · ");
        lines.push(`  ${fmtQty(short)} ${r.unitDisplay ?? ""} — ${name}`.trimEnd());
      }
      lines.push("");
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n").trim());
      toast.success(t("stock.copied", "Buy list copied"));
    } catch {
      toast.error("// COPY FAILED");
    }
  }, [filtered, t]);

  const drawerRow = useMemo(
    () => rows.find((r) => r.variantId === drawerVariantId) ?? null,
    [rows, drawerVariantId],
  );

  // ── Counts view short-circuit ─────────────────────────────────────────────
  // The snapshots/counts flow is its own surface (not a register table), so it
  // doesn't host a TableShell — but it still scrolls inside the fixed-viewport
  // parent rather than growing the page (WEB OVERHAUL P6-2).
  if (view === "counts") {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <SnapshotsView
          segmentControl={
            <CatalogSegmentControl
              options={segmentOptions}
              value={activeSegment}
              onChange={onSegmentChange}
            />
          }
          rows={rows}
          onClose={onCloseCounts}
        />
      </div>
    );
  }

  const segmentControl = (
    <CatalogSegmentControl
      options={segmentOptions}
      value={activeSegment}
      onChange={onSegmentChange}
    />
  );

  const isBodyEmpty = loading || filtered.length === 0;

  return (
    <>
      <TableShell
        metrics={metrics}
        toolbar={
          // Canonical Workbar grammar. Normal: search left · category filters ·
          // GROUP + kebab tools · ADD create · PRODUCTS/STOCK tab strip. The
          // low-stock DRILL swaps search/create out for the drill readout + COPY
          // LIST/PRINT actions. The pinned bulk bar rides in the extra-row slot.
          <Workbar
            search={
              drilled ? undefined : (
                <SearchInput
                  placeholder={t("stock.search", "Search stock…")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  wrapperClassName="w-[240px] max-w-full"
                />
              )
            }
            filters={
              drilled ? (
                <>
                  <DrillChip label={t("filter.belowThreshold", "BELOW THRESHOLD")} onClear={onClearDrill} />
                  {buyTotal && (
                    <span className="font-mono text-micro uppercase tracking-[0.08em] text-text-3 tabular-nums">
                      {t("stock.buyToThreshold", "BUY TO THRESHOLD")} ::{" "}
                      <span className="text-text-2">{fmtMoney(buyTotal.total)}</span>
                      {buyTotal.uncosted > 0 && (
                        <>
                          {" · "}
                          <span className="text-tan">{t("stock.uncosted", { n: buyTotal.uncosted })}</span>
                        </>
                      )}
                    </span>
                  )}
                </>
              ) : (
                <FilterChips options={categoryOptions} value={categoryFilter} onChange={setCategoryFilter} />
              )
            }
            meta={
              <WorkbarCount>
                {drilled
                  ? t("stock.criticalFirst", { n: filtered.length, total: rows.length })
                  : t("stock.skuCount", { n: filtered.length })}
              </WorkbarCount>
            }
            tools={
              drilled ? (
                <>
                  <Button variant="secondary" size="sm" onClick={copyList}>
                    {t("stock.copyList", "COPY LIST")}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => window.print()}>
                    {t("stock.print", "PRINT")}
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleGroup}
                    className={cn(
                      "inline-flex h-3 items-center rounded-chip border px-1",
                      "font-mono text-micro font-medium uppercase tracking-[0.12em]",
                      "transition-colors duration-150 ease-smooth",
                      effectiveGroup
                        ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                        : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2",
                    )}
                  >
                    {t("stock.group", "GROUP :: FAMILY")}
                  </button>
                  <CatalogKebab segment="stock" rows={rows} />
                </>
              )
            }
            create={
              !drilled && canManage ? (
                <WorkbarButton onClick={() => setAddOpen(true)}>
                  <Plus className="h-[11px] w-[11px] shrink-0" strokeWidth={1.5} aria-hidden />
                  {t("stock.add", "ADD")}
                </WorkbarButton>
              ) : null
            }
            tabStrip={segmentControl}
          >
            {selectedIds.size > 0 && canManage && (
              <div className="flex items-center gap-3 rounded-panel border border-border bg-surface-hover-subtle px-3 py-1.5">
                <span className="font-mono text-micro uppercase tracking-[0.12em] text-text-2 tabular-nums">
                  {t("bulk.selected", { n: selectedIds.size })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose hover:text-rose"
                  onClick={() => setConfirmBulkDelete(true)}
                >
                  {t("bulk.delete", "DELETE")}
                </Button>
              </div>
            )}
          </Workbar>
        }
        isEmpty={isBodyEmpty}
        emptyState={
          loading ? (
            <div className="animate-pulse space-y-[2px] p-3 motion-reduce:animate-none">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-surface h-[44px]" />
              ))}
            </div>
          ) : (
            <EmptyStock filtered={!!search || categoryFilter !== "all" || drilled} />
          )
        }
      >
        {/* Table + drawer — the master-detail pair scrolls together in the body */}
        <div
          className={cn(
            "grid gap-4 p-px",
            drawerRow ? "grid-cols-1 xl:grid-cols-[1fr_312px]" : "grid-cols-1",
          )}
        >
          {effectiveGroup ? (
            <div className="glass-surface overflow-hidden">
              <GroupedTable rows={filtered} onOpenDrawer={setDrawerVariantId} />
            </div>
          ) : (
            <FlatTable
              rows={filtered}
              drilled={drilled}
              canManage={canManage}
              selectedIds={selectedIds}
              allSelected={allSelected}
              onToggleAll={toggleAll}
              onToggleRow={toggleRow}
              editId={editId}
              onRequestEdit={setEditId}
              onCommitQty={commitQty}
              onCancelEdit={() => setEditId(null)}
              onOpenDrawer={setDrawerVariantId}
              activeDrawerId={drawerVariantId}
            />
          )}

          {drawerRow && (
            <StockDrawer row={drawerRow} canManage={canManage} onClose={() => setDrawerVariantId(null)} />
          )}
        </div>
      </TableShell>

      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title="Delete variants?"
        description={`Permanently delete ${selectedIds.size} variant${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={bulkDelete.isPending}
        onConfirm={() => {
          bulkDelete.mutate(Array.from(selectedIds), {
            onSuccess: () => {
              setSelectedIds(new Set());
              setConfirmBulkDelete(false);
            },
          });
        }}
      />

      {addOpen && <AddStockDialog onClose={() => setAddOpen(false)} />}
    </>
  );
}

// ─── Flat table (shared RegisterTable) ───────────────────────────────────────

function FlatTable({
  rows,
  drilled,
  canManage,
  selectedIds,
  allSelected,
  onToggleAll,
  onToggleRow,
  editId,
  onRequestEdit,
  onCommitQty,
  onCancelEdit,
  onOpenDrawer,
  activeDrawerId,
}: {
  rows: CatalogStockRow[];
  drilled: boolean;
  canManage: boolean;
  selectedIds: Set<string>;
  allSelected: boolean;
  onToggleAll: () => void;
  onToggleRow: (id: string) => void;
  editId: string | null;
  onRequestEdit: (id: string) => void;
  onCommitQty: (id: string, r: { mode: "set" | "delta"; value: number }) => void;
  onCancelEdit: () => void;
  onOpenDrawer: (id: string) => void;
  activeDrawerId: string | null;
}) {
  const { t } = useDictionary("catalog");
  const showCheckbox = !drilled && canManage;

  const columns: RegisterTableColumn<CatalogStockRow>[] = [];

  if (showCheckbox) {
    columns.push({
      id: "select",
      className: "w-[34px]",
      header: (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={allSelected} onCheckedChange={onToggleAll} aria-label="Select all" />
        </span>
      ),
      cell: (r) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selectedIds.has(r.variantId)}
            onCheckedChange={() => onToggleRow(r.variantId)}
            aria-label={`Select ${r.familyName}`}
          />
        </span>
      ),
    });
  }

  columns.push({
    id: "item",
    header: t("stock.col.item", "ITEM"),
    cell: (r) => (
      <div className="min-w-0">
        <TablePrimary>{r.familyName}</TablePrimary>
        <span className="block font-mono text-micro uppercase tracking-[0.1em] text-text-3 tabular-nums">
          {r.variantLabel ?? "—"}
        </span>
      </div>
    ),
  });

  columns.push({
    id: "qty",
    header: t("stock.col.qty", "QTY"),
    align: "right",
    cell: (r) => (
      <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
        <InlineQtyCell
          value={r.quantity}
          unit={r.unitAbbreviation ?? r.unitDisplay}
          status={r.status}
          editable={canManage}
          editing={editId === r.variantId}
          onRequestEdit={() => onRequestEdit(r.variantId)}
          onCommit={(result) => onCommitQty(r.variantId, result)}
          onCancel={onCancelEdit}
        />
      </span>
    ),
  });

  if (drilled) {
    columns.push({
      id: "threshold",
      header: t("stock.col.threshold", "THRESHOLD"),
      align: "right",
      cell: (r) => {
        const ref = r.effectiveCritical ?? r.effectiveWarning;
        return (
          <span className="font-mono text-data-sm text-text-3 tabular-nums">
            {ref != null ? fmtQty(ref) : "—"}
          </span>
        );
      },
    });
    columns.push({
      id: "short",
      header: t("stock.col.short", "SHORT"),
      align: "right",
      cell: (r) => {
        const ref = r.effectiveCritical ?? r.effectiveWarning;
        const short = ref != null ? Math.max(0, ref - r.quantity) : 0;
        return (
          <span
            className={cn(
              "font-mono text-data-sm tabular-nums",
              r.status === "critical" ? "text-rose" : "text-tan",
            )}
          >
            {fmtQty(short)}
          </span>
        );
      },
    });
  }

  columns.push({
    id: "sku",
    header: t("stock.col.sku", "SKU"),
    className: "hidden sm:table-cell",
    cell: (r) => (
      <span className="font-mono text-micro text-text-3 tabular-nums">{r.sku ?? "—"}</span>
    ),
  });

  columns.push({
    id: "status",
    header: t("stock.col.status", "STATUS"),
    cell: (r) => <StatusTag status={r.status} />,
  });

  return (
    <RegisterTable<CatalogStockRow>
      columns={columns}
      rows={rows}
      getRowId={(r) => r.variantId}
      onRowClick={(r) => onOpenDrawer(r.variantId)}
      isRowActive={(r) => r.variantId === activeDrawerId}
      minWidth={640}
      ariaLabel={t("segment.stock", "Stock")}
      inShell
    />
  );
}

// ─── Grouped (family) table — bespoke clustered view, RegisterTable has no grouping ──

function GroupedTable({
  rows,
  onOpenDrawer,
}: {
  rows: CatalogStockRow[];
  onOpenDrawer: (id: string) => void;
}) {
  const families = useMemo(() => {
    const map = new Map<string, CatalogStockRow[]>();
    for (const r of rows) {
      const list = map.get(r.itemId) ?? [];
      list.push(r);
      map.set(r.itemId, list);
    }
    return Array.from(map.values());
  }, [rows]);

  return (
    <div className="divide-y divide-border-subtle">
      {families.map((variants) => {
        const head = variants[0];
        const totalQty = variants.reduce((s, v) => s + v.quantity, 0);
        return (
          <div key={head.itemId} className="px-3 py-2">
            <div className="flex items-center gap-3">
              <span className="font-mohave text-[15px] text-text">{head.familyName}</span>
              {head.categoryName && (
                <span className="font-mono text-micro uppercase tracking-[0.12em] text-text-mute">
                  {head.categoryName}
                </span>
              )}
              <span className="ml-auto font-mono text-[12px] text-text-2 tabular-nums">
                {fmtQty(totalQty)}{" "}
                <span className="text-micro uppercase text-text-mute">
                  {head.unitAbbreviation ?? head.unitDisplay ?? ""}
                </span>
              </span>
              <span className="font-mono text-micro uppercase tracking-[0.1em] text-text-mute tabular-nums">
                {variants.length} VARIANT{variants.length === 1 ? "" : "S"}
              </span>
            </div>
            <table className="mt-1 w-full">
              <tbody>
                {variants.map((v) => (
                  <tr
                    key={v.variantId}
                    className="cursor-pointer hover:bg-surface-hover"
                    onClick={() => onOpenDrawer(v.variantId)}
                  >
                    <td className="py-1 pl-4 font-mono text-micro uppercase tracking-[0.1em] text-text-3">
                      {v.variantLabel ?? "—"}
                    </td>
                    <td className="py-1 font-mono text-micro text-text-mute tabular-nums">{v.sku ?? "—"}</td>
                    <td className="py-1 text-right font-mono text-data-sm text-text tabular-nums">
                      {fmtQty(v.quantity)}
                    </td>
                    <td className="py-1 pl-3 text-right">
                      <StatusTag status={v.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyStock({ filtered }: { filtered: boolean }) {
  const { t } = useDictionary("catalog");
  return <RegisterEmpty noun={filtered ? t("stock.empty.matches") : t("stock.empty.noun")} />;
}
