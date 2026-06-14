"use client";

/**
 * Stock detail drawer — quick-adjust first, detail second (iOS pattern). The
 * table stays visible alongside it. Quantity edits + the unit-cost field write
 * through the audited mutations; the ADJUSTMENTS ledger reads web + iOS rows.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type {
  CatalogStockRow,
  ThresholdSource,
  CatalogAdjustment,
} from "@/lib/types/catalog";
import {
  useAdjustQuantity,
  useUpdateVariant,
  useDeleteVariant,
  useVariantAdjustments,
  useVariantUsedIn,
} from "@/lib/hooks/use-catalog-stock";
import { fmtQty, fmtMoneyPrecise, parseQtyInput, parseMoneyInput } from "./format";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border py-[10px]">
      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        <span className="text-text-mute">{"// "}</span>
        {title}
      </span>
      {children}
    </div>
  );
}

function SourceTag({ source, dict }: { source: ThresholdSource; dict: (k: string, f: string) => string }) {
  const label =
    source === "variant"
      ? dict("drawer.sourceVariant", "[OVERRIDE]")
      : source === "family"
        ? dict("drawer.sourceFamily", "[FAMILY]")
        : source === "category"
          ? dict("drawer.sourceCategory", "[CATEGORY]")
          : dict("drawer.sourceNone", "[NONE]");
  return <span className="ml-1 font-mono text-[11px] tracking-[0.08em] text-text-3">{label}</span>;
}

function ledgerLabel(
  a: CatalogAdjustment,
  t: (k: string, p?: Record<string, string | number>) => string,
): { text: string; tone: "pos" | "neg" } {
  const tone = a.quantityDelta >= 0 ? "pos" : "neg";
  if (a.reason === "task_completion" || a.reason === "task_reopened") {
    return { text: t("drawer.task", { name: a.taskLabel ?? "Task" }), tone };
  }
  return {
    text: a.quantityDelta >= 0 ? t("drawer.received", {}) : t("drawer.removed", {}),
    tone,
  };
}

export function StockDrawer({
  row,
  canManage,
  onClose,
}: {
  row: CatalogStockRow;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useDictionary("catalog");
  const adjust = useAdjustQuantity();
  const updateVariant = useUpdateVariant();
  const deleteVariant = useDeleteVariant();
  const { data: adjustments = [] } = useVariantAdjustments(row.variantId, row.itemId);
  const { data: usedIn = [] } = useVariantUsedIn(row.variantId, row.itemId);

  const [qtyDraft, setQtyDraft] = useState("");
  const [costDraft, setCostDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const statusTone =
    row.status === "critical" ? "text-rose" : row.status === "warning" ? "text-tan" : "text-text";

  const applyDelta = (delta: number) =>
    adjust.mutate({ variantId: row.variantId, mode: "delta", value: delta });

  const commitQtyDraft = () => {
    const parsed = parseQtyInput(qtyDraft);
    if (parsed) adjust.mutate({ variantId: row.variantId, ...parsed });
    setQtyDraft("");
  };

  const commitCost = () => {
    if (costDraft == null) return;
    updateVariant.mutate({
      variantId: row.variantId,
      patch: { unitCostOverride: parseMoneyInput(costDraft) },
    });
    setCostDraft(null);
  };

  return (
    <aside className="glass-surface px-[18px] pb-[18px] pt-[16px]">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mohave text-[16px] font-medium text-text">{row.familyName}</h3>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-mute hover:text-text-2"
        >
          ESC <X className="inline h-[11px] w-[11px]" />
        </button>
      </div>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 tabular-nums">
        {[row.variantLabel, row.sku].filter(Boolean).join(" · ") || "—"}
      </span>

      <div className={cn("mt-3 font-mono text-[26px] font-semibold tabular-nums", statusTone)}>
        {fmtQty(row.quantity)}
        <span className="ml-1 font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">
          {row.unitAbbreviation ?? row.unitDisplay ?? ""}
          {row.status === "critical" && (
            <> · <span className="text-rose">{t("stock.status.critical", "CRITICAL")}</span></>
          )}
        </span>
      </div>

      {canManage && (
        <>
          <div className="mt-[10px] flex gap-[4px]">
            {[-10, -1, 1, 10].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => applyDelta(d)}
                className="h-9 flex-1 rounded-[5px] border border-border bg-transparent font-mono text-[12px] tabular-nums text-text-2 transition-colors hover:bg-surface-hover"
              >
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
          </div>
          <div className="mb-1 mt-[6px] flex gap-[6px]">
            <Input
              value={qtyDraft}
              onChange={(e) => setQtyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitQtyDraft();
                }
              }}
              placeholder={t("drawer.setExact", "Set count or +/- delta…")}
              className="flex-1 font-mono text-[12px]"
            />
            <Button variant="secondary" size="sm" onClick={commitQtyDraft} disabled={qtyDraft.trim() === ""}>
              {t("drawer.save", "SAVE")}
            </Button>
          </div>
        </>
      )}

      {/* Cost */}
      <Section title={t("drawer.cost", "COST")}>
        <div className="flex items-center justify-between font-mono text-[11px] text-text-2 tabular-nums">
          <span className="uppercase tracking-[0.08em] text-text-3">{t("drawer.unitCost", "UNIT COST")}</span>
          {costDraft != null ? (
            <input
              autoFocus
              value={costDraft}
              onChange={(e) => setCostDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCost();
                if (e.key === "Escape") setCostDraft(null);
              }}
              onBlur={commitCost}
              inputMode="decimal"
              className="w-[80px] rounded-[5px] border border-line-hi bg-surface-input px-2 py-[2px] text-right font-mono text-[12px] text-text tabular-nums focus:outline-none"
            />
          ) : (
            <button
              type="button"
              disabled={!canManage}
              onClick={() => setCostDraft(row.unitCostOverride != null ? String(row.unitCostOverride) : "")}
              className={cn(
                "font-mono text-[12px] tabular-nums",
                row.effectiveCost == null ? "text-rose" : "text-text-2",
                canManage && "border-b border-dashed border-fill-neutral hover:bg-surface-hover",
              )}
            >
              {fmtMoneyPrecise(row.effectiveCost)}
              {row.unitCostOverride == null && row.effectiveCost != null && (
                <SourceTag source="family" dict={t} />
              )}
            </button>
          )}
        </div>
      </Section>

      {/* Thresholds */}
      <Section title={t("drawer.thresholds", "THRESHOLDS")}>
        <div className="flex items-center justify-between py-[3px] font-mono text-[11px] text-text-2 tabular-nums">
          <span className="uppercase tracking-[0.08em] text-text-3">{t("drawer.warn", "WARN")}</span>
          <span>
            {row.effectiveWarning != null ? fmtQty(row.effectiveWarning) : "—"}
            <SourceTag source={row.warningSource} dict={t} />
          </span>
        </div>
        <div className="flex items-center justify-between py-[3px] font-mono text-[11px] text-text-2 tabular-nums">
          <span className="uppercase tracking-[0.08em] text-text-3">{t("drawer.critical", "CRITICAL")}</span>
          <span>
            {row.effectiveCritical != null ? fmtQty(row.effectiveCritical) : "—"}
            <SourceTag source={row.criticalSource} dict={t} />
          </span>
        </div>
      </Section>

      {/* Used in */}
      {usedIn.length > 0 && (
        <Section title={t("drawer.usedIn", "USED IN")}>
          {usedIn.map((u) => (
            <span key={u.productId} className="block py-[3px] font-mohave text-[14px] text-text-2">
              {u.productName} →
            </span>
          ))}
        </Section>
      )}

      {/* Adjustments ledger */}
      <Section title={t("drawer.adjustments", "ADJUSTMENTS")}>
        {adjustments.length === 0 ? (
          <span className="font-mono text-[11px] text-text-mute">{t("drawer.noMovement", "")}</span>
        ) : (
          adjustments.map((a) => {
            const { text, tone } = ledgerLabel(a, t);
            return (
              <div
                key={a.id}
                className="flex items-center justify-between py-[3px] font-mono text-[11px] tabular-nums"
              >
                <span className="uppercase tracking-[0.08em] text-text-3">
                  {a.at.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}
                </span>
                <span className={tone === "pos" ? "text-olive" : "text-rose"}>
                  {a.quantityDelta >= 0 ? "+" : "−"}
                  {fmtQty(Math.abs(a.quantityDelta))} · {text}
                </span>
              </div>
            );
          })
        )}
      </Section>

      {canManage && (
        <div className="border-t border-border pt-[10px]">
          <Button
            variant="ghost"
            size="sm"
            className="text-rose hover:text-rose"
            onClick={() => setConfirmDelete(true)}
          >
            {t("drawer.delete", "DELETE VARIANT")}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete variant?"
        description={`Permanently delete "${[row.familyName, row.variantLabel].filter(Boolean).join(" · ")}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteVariant.isPending}
        onConfirm={() =>
          deleteVariant.mutate(row.variantId, {
            onSuccess: () => {
              setConfirmDelete(false);
              onClose();
            },
          })
        }
      />
    </aside>
  );
}
