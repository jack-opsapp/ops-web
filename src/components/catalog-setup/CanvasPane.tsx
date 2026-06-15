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
  SellFields,
  RunningTotals as RunningTotalsModel,
} from "@/lib/catalog-setup/staging-card";
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
  onKeep?: (id: string) => void;
  onMerge?: (id: string) => void;
}

export interface CanvasPaneProps {
  /** Non-rejected cards grouped by module (from selectByModule). */
  byModule: Record<SectionKey, StagingCard[]>;
  /** Header counters (from selectRunningTotals). */
  totals: RunningTotalsModel;
  /** Whether the STOCK section renders at all (state-aware). */
  inventoryTracked: boolean;
  /** Live catalog rows a merge card matched, keyed by matchedExistingId. */
  existingRows?: Record<string, SellFields>;
  callbacks?: CardCallbacks;
  /** Manual lane: add a blank row of the given module to the canvas. */
  onAddRow?: (module: SectionKey) => void;
  className?: string;
}

export interface DiffLabels {
  name: string;
  price: string;
  cost: string;
  taxable: string;
  taxableYes: string;
  taxableNo: string;
}

/**
 * Build the per-field old→new diff for a merge (duplicate) SELL card. Covers
 * every field a MERGE overwrites on the live row — name, price, cost, taxable —
 * not just price/cost: a re-import that renames or re-taxes a matched product
 * must SHOW that change before BUILD IT applies it (the panel only renders when
 * there's at least one diff row, so a pure rename was previously silent).
 */
export function buildDiff(
  card: StagingCard,
  existing: SellFields | undefined,
  labels: DiffLabels,
): DiffField[] {
  if (!existing || card.module !== "sell") return [];
  const incoming = card.fields;
  const out: DiffField[] = [];
  if ((incoming.name ?? "") !== (existing.name ?? "")) {
    out.push({
      label: labels.name,
      oldValue: existing.name ?? "—",
      newValue: incoming.name ?? "—",
    });
  }
  if (incoming.defaultPrice !== existing.defaultPrice) {
    out.push({
      label: labels.price,
      oldValue: formatMoney(existing.defaultPrice),
      newValue: formatMoney(incoming.defaultPrice),
    });
  }
  if (incoming.unitCost !== existing.unitCost) {
    out.push({
      label: labels.cost,
      oldValue: formatMoney(existing.unitCost),
      newValue: formatMoney(incoming.unitCost),
    });
  }
  if (incoming.isTaxable !== existing.isTaxable) {
    out.push({
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
      className="rounded-panel border border-dashed border-glass-border px-3 py-4 font-mohave text-[13px] text-text-3"
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
      cost: t("data.cost", "COST"),
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
        <div className="flex flex-col gap-6 px-1 pb-4">
          {sections.map((section) => {
            const cards = byModule[section] ?? [];
            return (
              <section key={section} data-testid={`canvas-section-${section}`}>
                {/* Section header — `//` slash voice + a quiet manual add */}
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-cakemono text-[14px] font-light uppercase leading-none text-text">
                      <span aria-hidden className="mr-[6px] font-mono text-text-mute">
                        //
                      </span>
                      {t(SECTION_TITLE_KEY[section], SECTION_TITLE_FALLBACK[section])}
                    </h3>
                    <span className="font-mohave text-[12px] text-text-3">
                      {t(SECTION_CAPTION_KEY[section], SECTION_CAPTION_FALLBACK[section])}
                    </span>
                    {section === "stock" ? (
                      <span
                        data-testid="canvas-stock-tracked-tag"
                        className="rounded-chip border border-glass-border px-[5px] py-[1px] font-mono text-[10px] uppercase tracking-wider text-text-3"
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
                      className="flex shrink-0 items-center gap-1 font-mono text-[11px] lowercase tracking-[0.04em] text-text-3 transition-colors duration-150 hover:text-text-2"
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
                          onAccept={callbacks?.onAccept}
                          onEdit={callbacks?.onEdit}
                          onReject={callbacks?.onReject}
                          onKeep={callbacks?.onKeep}
                          onMerge={callbacks?.onMerge}
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
