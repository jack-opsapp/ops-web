"use client";

/**
 * Catalog "Saved counts" view — variant-aware point-in-time stock captures,
 * the year-end-count exit (Direction D). Reached via the ON-HAND tile drill
 * or the kebab. Writes go to catalog_snapshots directly (the legacy view path
 * is read-only).
 */

import { useState } from "react";
import { ChevronRight, Camera, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RegisterEmpty } from "@/components/ui/register-table";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { fmtQty } from "./format";
import type { CatalogStockRow, CatalogSnapshot } from "@/lib/types/catalog";
import {
  useCatalogSnapshots,
  useSnapshotItems,
  useCreateSnapshot,
} from "@/lib/hooks/use-catalog-meta";
import { usePermissionStore } from "@/lib/store/permissions-store";

export function SnapshotsView({
  segmentControl,
  rows,
  onClose,
}: {
  segmentControl: React.ReactNode;
  rows: CatalogStockRow[];
  onClose: () => void;
}) {
  const { t } = useDictionary("catalog");
  const can = usePermissionStore((s) => s.can);
  const canManage = can("inventory.manage");
  const { data: snapshots = [], isLoading } = useCatalogSnapshots();
  const create = useCreateSnapshot();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {segmentControl}
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={onClose}>
            <ArrowLeft className="h-[14px] w-[14px]" />
            {t("filter.all", "STOCK")}
          </Button>
          {canManage && (
            <Button variant="primary" size="sm" className="gap-[6px]" onClick={() => setCreateOpen(true)}>
              <Camera className="h-[14px] w-[14px]" aria-hidden />
              {t("snapshots.create", "TAKE COUNT")}
            </Button>
          )}
        </div>
      </div>

      <span className="block font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        <span className="text-text-mute">{"// "}</span>
        {t("snapshots.title", "// SAVED COUNTS")}
      </span>

      {isLoading ? (
        <div className="animate-pulse space-y-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-surface h-[44px]" />
          ))}
        </div>
      ) : snapshots.length === 0 ? (
        <RegisterEmpty noun={t("snapshots.empty.noun", "Counts")} />
      ) : (
        <div className="glass-surface overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="w-[32px] px-2 py-1.5" />
                {["date", "items", "type", "notes"].map((c, i) => (
                  <th
                    key={c}
                    className={cn(
                      "px-2 py-1.5 text-left font-mono text-[11px] font-normal uppercase tracking-[0.16em] text-text-3",
                      i === 1 && "text-right",
                      c === "notes" && "hidden md:table-cell",
                    )}
                  >
                    {t(`snapshots.col.${c}`, c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <SnapshotRow
                  key={s.id}
                  snapshot={s}
                  expanded={expanded.has(s.id)}
                  onToggle={() => toggle(s.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-cakemono text-[18px] font-light uppercase tracking-[0.02em] text-text">
              {t("snapshots.create", "TAKE COUNT")}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("snapshots.notesPlaceholder", "Notes (optional)…")}
            rows={3}
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              {t("add.cancel", "CANCEL")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              loading={create.isPending}
              onClick={() =>
                create.mutate(
                  { notes: notes.trim() || null, rows },
                  {
                    onSuccess: () => {
                      setNotes("");
                      setCreateOpen(false);
                    },
                  },
                )
              }
            >
              <Camera className="h-[14px] w-[14px]" />
              {t("snapshots.create", "TAKE COUNT")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SnapshotRow({
  snapshot,
  expanded,
  onToggle,
}: {
  snapshot: CatalogSnapshot;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useDictionary("catalog");
  const { data: items = [], isLoading } = useSnapshotItems(expanded ? snapshot.id : null);

  return (
    <>
      <tr
        className="cursor-pointer border-b border-border-subtle transition-colors last:border-b-0 hover:bg-surface-hover"
        onClick={onToggle}
      >
        <td className="px-2 py-[11px] text-center">
          <ChevronRight
            className={cn("h-[14px] w-[14px] text-text-3 transition-transform", expanded && "rotate-90")}
          />
        </td>
        <td className="px-2 py-[11px] font-mohave text-[14px] text-text">
          {snapshot.createdAt
            ? snapshot.createdAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "—"}
        </td>
        <td className="px-2 py-[11px] text-right font-mono text-[13px] text-text tabular-nums">
          {snapshot.itemCount}
        </td>
        <td className="px-2 py-[11px]">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
            {snapshot.isAutomatic ? t("snapshots.auto", "AUTO") : t("snapshots.manual", "MANUAL")}
          </span>
        </td>
        <td className="hidden px-2 py-[11px] md:table-cell">
          <span className="block max-w-[220px] truncate font-mono text-[11px] text-text-3">
            {snapshot.notes ?? "—"}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="bg-surface-hover-subtle px-2 py-2">
            {isLoading ? (
              <span className="font-mono text-[11px] text-text-mute">{t("loading", "Loading…")}</span>
            ) : (
              <table className="w-full">
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b border-border-subtle last:border-b-0">
                      <td className="py-1 pl-6 font-mohave text-[13px] text-text">{it.familyName}</td>
                      <td className="py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">
                        {it.variantLabel ?? "—"}
                      </td>
                      <td className="py-1 text-right font-mono text-[13px] text-text tabular-nums">
                        {fmtQty(it.quantity)}{" "}
                        <span className="text-[11px] uppercase text-text-mute">{it.unitDisplay ?? ""}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
