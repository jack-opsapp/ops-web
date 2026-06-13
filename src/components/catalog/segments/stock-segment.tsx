"use client";

/**
 * Catalog — STOCK segment. Serves the buy-run triage and count/receive flows
 * (Direction D). Flat per-variant rows by default (every column globally
 * sortable for triage); an opt-in GROUP::FAMILY mode clusters variants.
 * Inline QTY editing writes audited adjustments; row click opens the drawer.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { RegisterEmpty } from "@/components/ui/register-table";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { cn } from "@/lib/utils/cn";
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

const STATUS_TAG: Record<CatalogStatus, string> = {
  critical: "border-rose-line bg-rose-soft text-rose",
  warning: "border-tan-line bg-tan-soft text-tan",
  normal: "border-border bg-[rgba(255,255,255,0.05)] text-text-3",
  untracked: "border-border bg-transparent text-text-mute",
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
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-[4px] border px-[6px] py-[2px]",
        "font-mono text-[11px] font-medium uppercase tracking-[0.12em]",
        STATUS_TAG[status],
      )}
    >
      {label}
    </span>
  );
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
}: StockSegmentProps) {
  const { t } = useDictionary("catalog");
  const can = usePermissionStore((s) => s.can);
  const canManage = can("inventory.manage");

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
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.familyName.toLowerCase().includes(q) ||
          (r.variantLabel ?? "").toLowerCase().includes(q) ||
          (r.sku ?? "").toLowerCase().includes(q) ||
          (r.familyDescription ?? "").toLowerCase().includes(q),
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
  if (view === "counts") {
    return (
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
    );
  }

  const segmentControl = (
    <CatalogSegmentControl
      options={segmentOptions}
      value={activeSegment}
      onChange={onSegmentChange}
    />
  );

  return (
    <div className="space-y-[14px]">
      {/* Workbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {segmentControl}
        <div className="flex items-center gap-2">
          {drilled ? (
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
              <div className="w-[260px] max-w-full">
                <Input
                  placeholder={t("stock.search", "Search stock…")}
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
              <CatalogKebab segment="stock" rows={rows} />
            </>
          )}
        </div>
      </div>

      {/* Filter line */}
      <div className="flex flex-wrap items-center gap-[12px]">
        {drilled ? (
          <>
            <DrillChip label={t("filter.belowThreshold", "BELOW THRESHOLD")} onClear={onClearDrill} />
            <span className="font-mono text-[11px] text-text-3 tabular-nums">
              {t("stock.criticalFirst", { n: filtered.length, total: rows.length })}
            </span>
            {buyTotal && (
              <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-text-3 tabular-nums">
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
          <>
            <FilterChips options={categoryOptions} value={categoryFilter} onChange={setCategoryFilter} />
            <span className="font-mono text-[11px] text-text-3 tabular-nums">
              {t("stock.skuCount", { n: filtered.length })}
            </span>
            <button
              type="button"
              onClick={toggleGroup}
              className={cn(
                "ml-auto rounded-[4px] border px-[10px] py-[4px]",
                "font-mono text-[11px] font-medium uppercase tracking-[0.12em]",
                "transition-colors duration-150 ease-smooth",
                effectiveGroup
                  ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                  : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2",
              )}
            >
              {t("stock.group", "GROUP :: FAMILY")}
            </button>
          </>
        )}
      </div>

      {/* Bulk bar */}
      {selectedIds.size > 0 && canManage && (
        <div className="flex items-center gap-3 rounded-[8px] border border-border bg-[rgba(255,255,255,0.03)] px-3 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-2 tabular-nums">
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

      {/* Table + drawer */}
      <div
        className={cn(
          "grid gap-4",
          drawerRow ? "grid-cols-1 xl:grid-cols-[1fr_312px]" : "grid-cols-1",
        )}
      >
        <div className="glass-surface overflow-hidden">
          {loading ? (
            <div className="animate-pulse space-y-[2px] p-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[44px] rounded bg-fill-neutral-dim/40" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyStock filtered={!!search || categoryFilter !== "all" || drilled} />
          ) : effectiveGroup ? (
            <GroupedTable
              rows={filtered}
              onOpenDrawer={setDrawerVariantId}
            />
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
        </div>

        {drawerRow && (
          <StockDrawer row={drawerRow} canManage={canManage} onClose={() => setDrawerVariantId(null)} />
        )}
      </div>

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
    </div>
  );
}

// ─── Flat table ────────────────────────────────────────────────────────────────

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
  const th =
    "px-2 py-1.5 text-left font-mono text-[11px] font-normal uppercase tracking-[0.16em] text-text-3";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-border">
            {!drilled && canManage && (
              <th className="w-[36px] px-2 py-1.5">
                <Checkbox checked={allSelected} onCheckedChange={onToggleAll} aria-label="Select all" />
              </th>
            )}
            <th className={th}>{t("stock.col.item", "ITEM")}</th>
            <th className={cn(th, "text-right")}>{t("stock.col.qty", "QTY")}</th>
            {drilled && <th className={cn(th, "text-right")}>{t("stock.col.threshold", "THRESHOLD")}</th>}
            {drilled && <th className={cn(th, "text-right")}>{t("stock.col.short", "SHORT")}</th>}
            <th className={cn(th, "hidden sm:table-cell")}>{t("stock.col.sku", "SKU")}</th>
            <th className={th}>{t("stock.col.status", "STATUS")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ref = r.effectiveCritical ?? r.effectiveWarning;
            const short = ref != null ? Math.max(0, ref - r.quantity) : 0;
            const selected = selectedIds.has(r.variantId);
            return (
              <tr
                key={r.variantId}
                className={cn(
                  "border-b border-[rgba(255,255,255,0.05)] transition-colors last:border-b-0 hover:bg-surface-hover",
                  activeDrawerId === r.variantId && "bg-surface-active",
                )}
              >
                {!drilled && canManage && (
                  <td className="w-[36px] px-2 py-[11px]">
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => onToggleRow(r.variantId)}
                      aria-label={`Select ${r.familyName}`}
                    />
                  </td>
                )}
                <td
                  className="cursor-pointer px-2 py-[11px]"
                  onClick={() => onOpenDrawer(r.variantId)}
                >
                  <span className="block font-mohave text-[14px] text-text">{r.familyName}</span>
                  <span className="block font-mono text-[11px] uppercase tracking-[0.1em] text-text-3 tabular-nums">
                    {r.variantLabel ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-[11px] text-right">
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
                </td>
                {drilled && (
                  <td className="px-2 py-[11px] text-right font-mono text-[13px] text-text-3 tabular-nums">
                    {ref != null ? fmtQty(ref) : "—"}
                  </td>
                )}
                {drilled && (
                  <td
                    className={cn(
                      "px-2 py-[11px] text-right font-mono text-[13px] tabular-nums",
                      r.status === "critical" ? "text-rose" : "text-tan",
                    )}
                  >
                    {fmtQty(short)}
                  </td>
                )}
                <td className="hidden px-2 py-[11px] sm:table-cell">
                  <span className="font-mono text-[11px] text-text-3 tabular-nums">{r.sku ?? "—"}</span>
                </td>
                <td className="px-2 py-[11px]">
                  <StatusTag status={r.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Grouped (family) table ─────────────────────────────────────────────────────

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
    <div className="divide-y divide-[rgba(255,255,255,0.05)]">
      {families.map((variants) => {
        const head = variants[0];
        const totalQty = variants.reduce((s, v) => s + v.quantity, 0);
        return (
          <div key={head.itemId} className="px-3 py-2">
            <div className="flex items-center gap-3">
              <span className="font-mohave text-[15px] text-text">{head.familyName}</span>
              {head.categoryName && (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-mute">
                  {head.categoryName}
                </span>
              )}
              <span className="ml-auto font-mono text-[12px] text-text-2 tabular-nums">
                {fmtQty(totalQty)}{" "}
                <span className="text-[11px] uppercase text-text-mute">
                  {head.unitAbbreviation ?? head.unitDisplay ?? ""}
                </span>
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-mute tabular-nums">
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
                    <td className="py-1 pl-4 font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">
                      {v.variantLabel ?? "—"}
                    </td>
                    <td className="py-1 font-mono text-[11px] text-text-mute tabular-nums">{v.sku ?? "—"}</td>
                    <td className="py-1 text-right font-mono text-[13px] text-text tabular-nums">
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
  return (
    <RegisterEmpty noun={filtered ? t("stock.empty.matches") : t("stock.empty.noun")} />
  );
}
