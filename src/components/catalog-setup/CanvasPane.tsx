"use client";

/**
 * CanvasPane — the right pane of the catalog-setup wizard: the live-building
 * canvas. Composes the running-totals header, the three module sections
 * (SELL · STOCK · TYPES), each with its StagingCardView list, and a per-section
 * empty treatment.
 *
 * Intent: a trades owner watching their catalog assemble. ONE surface — they never
 * see the products-vs-catalog-items table split underneath (spec §5,§7,§8). Cards
 * arrive, get a verdict, and the totals tick. The pane scrolls (ScrollFade — no
 * hard cutoffs) so a long import never clips.
 *
 * STATE-AWARE: the STOCK section is omitted entirely when inventory isn't tracked
 * (matches the rail). Section headers use the `//` slash voice. Numbers are mono.
 * No accent anywhere. Strings via useDictionary("catalog-setup").
 */

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { ScrollFade } from "@/components/dashboard/widgets/shared/scroll-fade";
import type {
  StagingCard,
  RunningTotals as RunningTotalsModel,
} from "@/lib/catalog-setup/staging-card";
import type { OnFileProduct } from "@/lib/catalog-setup/existing-rows";
import { useCatalogSetupMotion } from "@/lib/catalog-setup/motion";
import { StagingCardView, type DiffField } from "./StagingCardView";
import { RunningTotals } from "./RunningTotals";
import { formatMoney } from "./format";

type SectionKey = "sell" | "stock" | "types";

const SECTION_ORDER: SectionKey[] = ["sell", "stock", "types"];

const SECTION_TITLE_KEY: Record<SectionKey, string> = {
  sell: "section.sell",
  stock: "section.stock",
  types: "section.types",
};
const SECTION_TITLE_FALLBACK: Record<SectionKey, string> = {
  sell: "SELL",
  stock: "STOCK",
  types: "TYPES",
};
const SECTION_CAPTION_KEY: Record<SectionKey, string> = {
  sell: "section.sell.caption",
  stock: "section.stock.caption",
  types: "section.types.caption",
};
const SECTION_CAPTION_FALLBACK: Record<SectionKey, string> = {
  sell: "what you charge for",
  stock: "what you keep on hand",
  types: "the work you do",
};
const SECTION_EMPTY_KEY: Record<SectionKey, string> = {
  sell: "section.sell.empty",
  stock: "section.stock.empty",
  types: "section.types.empty",
};
const SECTION_EMPTY_FALLBACK: Record<SectionKey, string> = {
  sell: "Nothing to sell yet. Import a price list or add a line.",
  stock: "Nothing tracked yet. Import a count or add an item.",
  types: "No types yet. Pick your trade or add one.",
};
const SECTION_ADD_KEY: Record<SectionKey, string> = {
  sell: "section.sell.add",
  stock: "section.stock.add",
  types: "section.types.add",
};
const SECTION_ADD_FALLBACK: Record<SectionKey, string> = {
  sell: "add a line",
  stock: "add an item",
  types: "add a type",
};

export interface CardCallbacks {
  onAccept?: (id: string) => void;
  onEdit?: (id: string) => void;
  onReject?: (id: string) => void;
  onMerge?: (id: string) => void;
  onToggleDiffField?: (id: string, field: string, accepted: boolean) => void;
}

export interface CanvasPaneProps {
  /** Non-rejected cards grouped by module (from selectByModule). */
  byModule: Record<SectionKey, StagingCard[]>;
  /** Header counters (from selectRunningTotals). */
  totals: RunningTotalsModel;
  /** Whether the STOCK section renders at all (state-aware). */
  inventoryTracked: boolean;
  /** On-file values a merge card matched, keyed by matchedExistingId. */
  existingRows?: Record<string, OnFileProduct>;
  callbacks?: CardCallbacks;
  /** Manual lane: add a blank row of the given module to the canvas. */
  onAddRow?: (module: SectionKey) => void;
  className?: string;
}

export interface DiffLabels {
  name: string;
  price: string;
  taxable: string;
  taxableYes: string;
  taxableNo: string;
}

/**
 * Build the per-field old→new diff for a merge (duplicate) SELL card. ONLY the
 * fields a MERGE actually overwrites appear here — name, price
 * (base_price/default_price), and taxable. `unit_cost` is DELIBERATELY excluded:
 * a merge sends the on-file cost straight back, and catalog_setup_save resolves
 * unit_cost on conflict via coalesce(excluded.unit_cost, products.unit_cost), so
 * the on-file cost is preserved either way — there is no cost change to accept or
 * reject, and a toggle would imply control the merge can't exercise. (A newly
 * CREATED product's cost IS persisted — the RPC writes unit_cost on insert — but a
 * create has no diff. The merge data row shows the on-file cost, which is what
 * stands after commit.)
 */
export function buildDiff(
  card: StagingCard,
  existing: OnFileProduct | undefined,
  labels: DiffLabels,
): DiffField[] {
  if (!existing || card.module !== "sell") return [];
  const incoming = card.fields;
  const out: DiffField[] = [];
  // `field` is the canonical snake_case key — it ties each toggle to
  // `StagingCard.fieldSelections` and the commit adapter's per-field revert.
  if ((incoming.name ?? "") !== (existing.name ?? "")) {
    out.push({
      field: "name",
      label: labels.name,
      oldValue: existing.name ?? "—",
      newValue: incoming.name ?? "—",
    });
  }
  if (incoming.defaultPrice !== existing.defaultPrice) {
    out.push({
      field: "base_price",
      label: labels.price,
      oldValue: formatMoney(existing.defaultPrice),
      newValue: formatMoney(incoming.defaultPrice),
    });
  }
  if (incoming.isTaxable !== existing.isTaxable) {
    out.push({
      field: "is_taxable",
      label: labels.taxable,
      oldValue: existing.isTaxable ? labels.taxableYes : labels.taxableNo,
      newValue: incoming.isTaxable ? labels.taxableYes : labels.taxableNo,
    });
  }
  return out;
}

function SectionEmpty({ section }: { section: SectionKey }) {
  const { t } = useDictionary("catalog-setup");
  return (
    <p
      data-testid={`section-empty-${section}`}
      className="rounded-panel border border-dashed border-glass-border px-1.5 py-2 font-mohave text-body-sm font-normal text-text-3"
    >
      {t(SECTION_EMPTY_KEY[section], SECTION_EMPTY_FALLBACK[section])}
    </p>
  );
}

export function CanvasPane({
  byModule,
  totals,
  inventoryTracked,
  existingRows,
  callbacks,
  onAddRow,
  className,
}: CanvasPaneProps) {
  const { t } = useDictionary("catalog-setup");
  const m = useCatalogSetupMotion();

  const diffLabels = useMemo(
    () => ({
      name: t("data.name", "NAME"),
      price: t("data.price", "PRICE"),
      taxable: t("data.taxable", "TAX"),
      taxableYes: t("data.taxableYes", "taxable"),
      taxableNo: t("data.taxableNo", "not taxable"),
    }),
    [t],
  );

  // STATE-AWARE: drop STOCK from the rendered sections when untracked.
  const sections = useMemo(
    () => SECTION_ORDER.filter((s) => (s === "stock" ? inventoryTracked : true)),
    [inventoryTracked],
  );

  return (
    <div
      data-testid="canvas-pane"
      className={cn("flex h-full min-h-0 flex-col", className)}
    >
      {/* Header: running totals */}
      <div className="flex items-center justify-between border-b border-glass-border px-1 pb-3">
        <RunningTotals totals={totals} />
      </div>

      {/* Scrollable section stack (ScrollFade — no hard cutoffs) */}
      <ScrollFade className="pt-3">
        <div className="flex flex-col gap-6 px-1 pb-6">
          {sections.map((section) => {
            const cards = byModule[section] ?? [];
            return (
              <section key={section} data-testid={`canvas-section-${section}`}>
                {/* Section header — `//` slash voice + a quiet manual add */}
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-cakemono text-cake-button font-light uppercase leading-none text-text">
                      <span aria-hidden className="mr-[6px] font-mono text-text-mute">
                        {"//"}
                      </span>
                      {t(SECTION_TITLE_KEY[section], SECTION_TITLE_FALLBACK[section])}
                    </h3>
                    <span className="font-mohave text-caption-sm text-text-3">
                      {t(SECTION_CAPTION_KEY[section], SECTION_CAPTION_FALLBACK[section])}
                    </span>
                    {section === "stock" ? (
                      <span
                        data-testid="canvas-stock-tracked-tag"
                        className="rounded-chip border border-glass-border px-[5px] py-[1px] font-mono text-micro-sm uppercase tracking-wider text-text-3"
                      >
                        {t("state.tracked", "tracked")}
                      </span>
                    ) : null}
                  </div>
                  {onAddRow ? (
                    <button
                      type="button"
                      data-testid={`canvas-add-${section}`}
                      onClick={() => onAddRow(section)}
                      className="flex shrink-0 items-center gap-1 font-mono text-micro lowercase tracking-[0.04em] text-text-3 transition-colors duration-150 hover:text-text-2"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      {t(SECTION_ADD_KEY[section], SECTION_ADD_FALLBACK[section])}
                    </button>
                  ) : null}
                </div>

                {/* Cards or empty treatment */}
                {cards.length === 0 ? (
                  <SectionEmpty section={section} />
                ) : (
                  <motion.div
                    className="flex flex-col gap-2"
                    variants={m.cardEnterContainer}
                    initial="hidden"
                    animate="visible"
                  >
                    <AnimatePresence initial={false}>
                      {cards.map((card, i) => (
                        <StagingCardView
                          key={card.id}
                          card={card}
                          // ENTRY stagger index — StagingCardView passes it as
                          // `custom` to its motion root for the 50ms cascade.
                          index={i}
                          diff={
                            card.state === "merge"
                              ? buildDiff(
                                  card,
                                  existingRows?.[card.matchedExistingId ?? ""],
                                  diffLabels,
                                )
                              : undefined
                          }
                          onFile={
                            card.state === "merge"
                              ? existingRows?.[card.matchedExistingId ?? ""]
                              : undefined
                          }
                          onAccept={callbacks?.onAccept}
                          onEdit={callbacks?.onEdit}
                          onReject={callbacks?.onReject}
                          onMerge={callbacks?.onMerge}
                          onToggleDiffField={callbacks?.onToggleDiffField}
                        />
                      ))}
                    </AnimatePresence>
                  </motion.div>
                )}
              </section>
            );
          })}
        </div>
      </ScrollFade>
    </div>
  );
}
