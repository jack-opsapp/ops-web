"use client";

/**
 * StagingCardView — the accept / edit / reject card on the catalog-setup canvas.
 *
 * Intent: a trades owner mid-build, watching their catalog assemble. Each card is
 * one thing they sell, stock, or schedule, surfaced from an import / their trade
 * template / the guided assistant / their own hand. The card's job is a one-glance
 * read — "what is this, where did it come from, what does it cost / earn / count"
 * — and a one-click verdict (accept / edit / reject). Nothing goes live until they
 * build, so the card is a holding pen, not a commit.
 *
 * SIGNATURE: the left state dot is the assembly-line "approved" stamp. On accept it
 * fills olive (cardAcceptDot) while the card border pulses once (cardAccept) — a
 * stamp, not a parade (animation-architect Achievement beat).
 *
 * Five visual states (driven by props/variants, all from the model — never invented):
 *   accepted/edited        olive dot, olive accepted border        → counts as "added"
 *   proposed (needs review) tan dot, hairline border               → awaiting a verdict
 *   new (fresh, unacted)    hollow dot                              → just arrived
 *   agent-proposed          lavender provenance (source === "agent") + SUGGESTED tag
 *   duplicate (merge)       tan DUPLICATE tag + per-field verdict toggles (take incoming / keep on file)
 *
 * Every value traces to a token. Accent (#6F94B0) appears NOWHERE here — earth tones
 * carry semantics (rose cost / olive margin·positive / tan attention), lavender is
 * reserved for agent provenance only. Strings via useDictionary("catalog-setup").
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Check, Pencil, X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type {
  StagingCard,
  SellFields,
  StockFields,
} from "@/lib/catalog-setup/staging-card";
import type { OnFileProduct } from "@/lib/catalog-setup/existing-rows";
import { getTradeLabel, isWizardTrade } from "@/lib/catalog-setup/trade-list";
import { useCatalogSetupMotion } from "@/lib/catalog-setup/motion";
import { formatMoney, formatMargin, formatCount } from "./format";

/** Mono tabular-lining / slashed-zero — every numeric readout on the card. */
const MONO_NUM: React.CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "zero" 1',
};

/** The dot's resting fill per visual state (accept animates over this). */
type DotKind = "accepted" | "review" | "new";

function dotKindFor(card: StagingCard): DotKind {
  if (card.state === "accepted" || card.state === "edited" || card.state === "merge") {
    return "accepted";
  }
  // proposed: a SELL row with no price needs review (tan); otherwise it's fresh.
  if (card.module === "sell" && card.fields.defaultPrice == null) return "review";
  if (card.module === "stock") {
    const f = card.fields;
    const low =
      f.reorderPoint != null && f.quantity != null && f.quantity <= f.reorderPoint;
    return low ? "review" : "new";
  }
  return "new";
}

const DOT_STYLES: Record<DotKind, { className: string; ariaKey: string }> = {
  accepted: { className: "bg-olive border-olive", ariaKey: "state.accepted" },
  review: { className: "bg-tan border-tan", ariaKey: "state.needsPrice" },
  new: { className: "bg-transparent border-[rgba(255,255,255,0.30)]", ariaKey: "state.proposed" },
};

/** Source → dictionary tag key. Agent provenance shows SUGGESTED (lavender). */
const SOURCE_TAG_KEY: Record<StagingCard["source"], string> = {
  import: "source.import",
  agent: "source.suggested",
  template: "source.template",
  manual: "source.manual",
};
const SOURCE_TAG_FALLBACK: Record<StagingCard["source"], string> = {
  import: "IMPORT",
  agent: "SUGGESTED",
  template: "TEMPLATE",
  manual: "MANUAL",
};

/**
 * Card name across modules (SELL/STOCK use `name`, TYPES uses `display`). A trade
 * card stores the stable SLUG in `display` (the commit contract) but the canvas
 * presents the human LABEL ("roofing" → "Roofing") — data vs. presentation
 * (OPS design law: never render the data model literally). Unknown slugs / a
 * label-bearing trade card fall through to the stored display unchanged.
 */
function cardName(card: StagingCard): string {
  if (card.module !== "types") return card.fields.name;
  const { display, isTrade } = card.fields;
  if (isTrade && isWizardTrade(display)) return getTradeLabel(display);
  return display;
}

/** Config chip text, e.g. "3 SIZES" / "ROLL" / "TRADE". Null = no chip. */
function configChip(card: StagingCard): string | null {
  if (card.module === "sell") {
    return card.fields.pricingUnit ? `PER ${card.fields.pricingUnit.toUpperCase()}` : null;
  }
  if (card.module === "stock") {
    return card.fields.unitId ? card.fields.unitId.toUpperCase() : null;
  }
  // types
  return card.fields.isTrade ? "TRADE" : "TYPE";
}

export interface DiffField {
  /**
   * Canonical snake_case field key (`name` / `base_price` / `unit_cost` /
   * `is_taxable`) — the toggle's identity, matching `StagingCard.fieldSelections`
   * and the commit adapter so a verdict here maps straight to what overwrites the
   * live row.
   */
  field: string;
  /** Field label, already localized by the caller. */
  label: string;
  /** Value on the live row. Struck when taking incoming; live when kept. */
  oldValue: string;
  /** Incoming value. Olive (live) when taken; struck when kept on file. */
  newValue: string;
}

export interface StagingCardViewProps {
  card: StagingCard;
  /** Index in its batch — drives the 50ms ENTRY stagger cascade (custom). */
  index?: number;
  /** For a duplicate (merge) card: the per-field diff old→new. */
  diff?: DiffField[];
  /** On-file values for a merge card — the COST/MARGIN row reads the on-file cost
   *  (the RPC never changes it on a merge) so the row matches what BUILD IT commits. */
  onFile?: OnFileProduct;
  onAccept?: (id: string) => void;
  onEdit?: (id: string) => void;
  onReject?: (id: string) => void;
  /** Duplicate-resolution: take every incoming change over the live row (bulk). */
  onMerge?: (id: string) => void;
  /** Per-field show-diff: toggle one changed field between take-incoming / keep-on-file. */
  onToggleDiffField?: (id: string, field: string, accepted: boolean) => void;
  className?: string;
}

/** Neutral focus ring for the card's controls (WCAG 2.4.7). Never the steel
 *  accent — that is reserved for the BUILD IT CTA and would trip the no-accent
 *  card rule. A quiet white/40 hairline keeps keyboard focus visible on the dark
 *  card (the OPS text tones live in `textColor`, not the base `colors` the ring
 *  utility reads, so a named `ring-text-*` silently falls back to Tailwind blue). */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-white/40";

/** One mono data cell: LABEL over a colored value. */
function DataCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "cost" | "price" | "margin";
}) {
  const toneClass =
    tone === "cost" ? "text-rose" : tone === "margin" ? "text-olive" : "text-text";
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">
        {label}
      </span>
      <span className={cn("font-mono text-[13px]", toneClass)} style={MONO_NUM}>
        {value}
      </span>
    </div>
  );
}

export function StagingCardView({
  card,
  index = 0,
  diff,
  onFile,
  onAccept,
  onEdit,
  onReject,
  onMerge,
  onToggleDiffField,
  className,
}: StagingCardViewProps) {
  const { t } = useDictionary("catalog-setup");
  const m = useCatalogSetupMotion();

  const isAgent = card.source === "agent";
  const isDuplicate = card.state === "merge";
  const isAccepted =
    card.state === "accepted" || card.state === "edited" || card.state === "merge";
  const dotKind = dotKindFor(card);
  const dotMeta = DOT_STYLES[dotKind];

  const sourceTag = t(SOURCE_TAG_KEY[card.source], SOURCE_TAG_FALLBACK[card.source]);
  const chip = configChip(card);
  const name = cardName(card);

  // The mono data row — SELL shows COST/PRICE/MARGIN, STOCK shows ON HAND/REORDER.
  const dataCells = useMemo(() => {
    if (card.module === "sell") {
      const f = card.fields as SellFields;
      // On a merge the doc carries the on-file cost straight back (the RPC's
      // coalesce re-writes the same value), so the live cost stands — show the
      // ON-FILE cost (and a margin derived from it) so the row matches what BUILD
      // IT commits, not the incoming cost (cost isn't a merge-diff field).
      const cost = onFile ? onFile.unitCost : f.unitCost;
      return [
        { label: t("data.cost", "COST"), value: formatMoney(cost), tone: "cost" as const },
        { label: t("data.price", "PRICE"), value: formatMoney(f.defaultPrice), tone: "price" as const },
        {
          label: t("data.margin", "MARGIN"),
          value: formatMargin(f.defaultPrice, cost),
          tone: "margin" as const,
        },
      ];
    }
    if (card.module === "stock") {
      const f = card.fields as StockFields;
      return [
        { label: t("data.onHand", "ON HAND"), value: formatCount(f.quantity), tone: "price" as const },
        { label: t("data.reorder", "REORDER"), value: formatCount(f.reorderPoint), tone: "margin" as const },
      ];
    }
    return [];
  }, [card, onFile, t]);

  return (
    <motion.div
      data-testid="staging-card"
      data-module={card.module}
      data-state={card.state}
      data-source={card.source}
      data-dot={dotKind}
      data-agent={isAgent ? "true" : undefined}
      data-duplicate={isDuplicate ? "true" : undefined}
      // ENTRY beat: arrives from +8px with a fade, stagger-ready via `custom`.
      custom={index}
      variants={m.cardEnter}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={cn(
        "group relative flex flex-col gap-2 rounded-panel border p-3",
        // Agent provenance = lavender tint + border; everything else = glass + hairline.
        isAgent
          ? "border-agent-border bg-agent-bg"
          : "border-glass-border bg-[rgba(255,255,255,0.02)]",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {/* State dot — ACHIEVEMENT stamp on accept (fills olive). */}
        <motion.span
          data-testid="staging-card-dot"
          aria-label={t(dotMeta.ariaKey, dotMeta.ariaKey)}
          variants={m.cardAcceptDot}
          animate={isAccepted ? "accepted" : "idle"}
          className={cn(
            "mt-[5px] h-[8px] w-[8px] shrink-0 rounded-full border",
            // Resting fill; the variant drives the olive stamp when accepted.
            isAccepted ? "bg-olive border-olive" : dotMeta.className,
          )}
        />

        <div className="min-w-0 flex-1">
          {/* Name (Mohave, sentence case) */}
          <p
            className={cn(
              "truncate font-mohave text-[14px] leading-tight",
              isAgent ? "text-agent-text" : "text-text",
            )}
          >
            {name}
          </p>

          {/* Chips: config + source tag */}
          <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
            {chip ? (
              <span
                data-testid="staging-card-config-chip"
                className="rounded-chip border border-glass-border px-[6px] py-[1px] font-mono text-[11px] uppercase tracking-wider text-text-2"
                style={MONO_NUM}
              >
                {chip}
              </span>
            ) : null}
            <span
              data-testid="staging-card-source-tag"
              className={cn(
                "rounded-chip px-[6px] py-[1px] font-mono text-[11px] uppercase tracking-wider",
                isAgent
                  ? "border border-agent-border bg-agent-bg-hi text-agent-text"
                  : "border border-glass-border text-text-3",
              )}
            >
              {sourceTag}
            </span>
            {isDuplicate ? (
              <span
                data-testid="staging-card-duplicate-tag"
                className="rounded-chip border border-tan-line bg-tan-soft px-[6px] py-[1px] font-mono text-[11px] uppercase tracking-wider text-tan"
              >
                {t("state.duplicate", "duplicate")}
              </span>
            ) : null}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex shrink-0 items-center gap-[6px]">
          <button
            type="button"
            data-testid="staging-card-reject"
            aria-label={t("action.reject", "REJECT")}
            onClick={() => onReject?.(card.id)}
            className={cn(
              "flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-text-3 transition-colors hover:bg-surface-hover hover:text-text-2",
              FOCUS_RING,
            )}
          >
            <X size={14} strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            data-testid="staging-card-edit"
            aria-label={t("action.edit", "EDIT")}
            onClick={() => onEdit?.(card.id)}
            className={cn(
              "flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-text-3 transition-colors hover:bg-surface-hover hover:text-text-2",
              FOCUS_RING,
            )}
          >
            <Pencil size={14} strokeWidth={1.75} aria-hidden />
          </button>
          <motion.button
            type="button"
            data-testid="staging-card-accept"
            aria-label={t("action.accept", "ACCEPT")}
            aria-pressed={isAccepted}
            onClick={() => onAccept?.(card.id)}
            // ACHIEVEMENT stamp: the accept box border pulses once into olive.
            variants={m.cardAccept}
            animate={isAccepted ? "accepted" : "idle"}
            className={cn(
              "flex h-[22px] w-[22px] items-center justify-center rounded-[5px] border transition-colors",
              FOCUS_RING,
              isAccepted
                ? "border-olive-line bg-olive-soft text-olive"
                : "border-glass-border text-text-3 hover:bg-surface-hover hover:text-text-2",
            )}
          >
            <Check size={14} strokeWidth={2} aria-hidden />
          </motion.button>
        </div>
      </div>

      {/* Mono data row — earth-tone semantics (cost rose / price text / margin olive) */}
      {dataCells.length > 0 ? (
        <div
          data-testid="staging-card-data-row"
          className="flex items-end gap-5 border-t border-glass-border pt-2"
        >
          {dataCells.map((cell) => (
            <DataCell key={cell.label} label={cell.label} value={cell.value} tone={cell.tone} />
          ))}
        </div>
      ) : null}

      {/* Duplicate diff — a per-field decision ledger. Each changed field carries
          a verdict toggle: TAKE INCOMING (olive check, overwrites the live row) or
          KEEP ON FILE (hollow, the live value stands). A fresh merge defaults to
          take-incoming on every field, so doing nothing = the old take-all merge. */}
      {isDuplicate && diff && diff.length > 0 ? (
        <div
          data-testid="staging-card-diff"
          className="flex flex-col gap-[6px] border-t border-tan-line pt-2"
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">
            {t("dedupe.title", "// matched a row you already have")}
          </span>
          <span className="font-mono text-[10px] tracking-wide text-text-3">
            {t("dedupe.fieldHint", "[ pick what to overwrite — the rest stays on file ]")}
          </span>
          {diff.map((d) => {
            // true / absent ⇒ take the incoming value; false ⇒ keep the on-file row.
            const accepted = card.fieldSelections?.[d.field] ?? true;
            return (
              <div
                key={d.field}
                className="flex items-center gap-2 font-mono text-[12px]"
                style={MONO_NUM}
              >
                <span className="w-[58px] shrink-0 text-[10px] uppercase tracking-wider text-text-3">
                  {d.label}
                </span>
                {/* The LIVE value (what commits) is always the un-struck one. */}
                <span
                  data-testid="diff-old"
                  className={cn(
                    accepted ? "text-text-mute line-through" : "text-text-2",
                  )}
                >
                  {d.oldValue}
                </span>
                <span aria-hidden className="text-text-mute">
                  →
                </span>
                <span
                  data-testid="diff-new"
                  className={cn(
                    accepted ? "text-olive" : "text-text-mute line-through",
                  )}
                >
                  {d.newValue}
                </span>
                <span className="flex-1" />
                {/* Verdict toggle — olive check = take incoming, hollow = keep mine.
                    Olive is the positive semantic, never the steel accent. */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={accepted}
                  data-testid={`staging-card-diff-toggle-${d.field}`}
                  aria-label={`${d.label} — ${
                    accepted
                      ? t("dedupe.takeIncoming", "TAKE INCOMING")
                      : t("dedupe.keepExisting", "KEEP ON FILE")
                  }`}
                  onClick={() => onToggleDiffField?.(card.id, d.field, !accepted)}
                  className={cn(
                    "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-chip border transition-colors duration-150",
                    FOCUS_RING,
                    accepted
                      ? "border-olive-line bg-olive-soft text-olive"
                      : "border-glass-border text-transparent hover:bg-surface-hover",
                  )}
                >
                  <Check size={12} strokeWidth={2.5} aria-hidden />
                </button>
              </div>
            );
          })}
          {/* Bulk shortcuts — symmetric "set every toggle" controls, one vocabulary
              with the per-field toggles + the ON FILE / INCOMING columns:
                KEEP ON FILE → every field reverts to the live value (non-destructive,
                  the card stays visible + fully re-decidable — never a one-click drop).
                TAKE INCOMING → re-bind + clear verdicts (overwrite every changed field).
              To discard the whole dup, the card's REJECT (×) action stays available. */}
          <div className="mt-[2px] flex items-center justify-between gap-2">
            <button
              type="button"
              data-testid="staging-card-keep"
              onClick={() => diff.forEach((d) => onToggleDiffField?.(card.id, d.field, false))}
              className={cn(
                "rounded-chip border border-glass-border px-2 py-[2px] font-cakemono text-[11px] font-light uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text",
                FOCUS_RING,
              )}
            >
              {t("dedupe.keepExisting", "KEEP ON FILE")}
            </button>
            <button
              type="button"
              data-testid="staging-card-merge"
              onClick={() => onMerge?.(card.id)}
              className={cn(
                "rounded-chip border border-olive-line bg-olive-soft px-2 py-[2px] font-cakemono text-[11px] font-light uppercase text-olive transition-colors hover:bg-olive/[0.16]",
                FOCUS_RING,
              )}
            >
              {t("dedupe.takeIncoming", "TAKE INCOMING")}
            </button>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}
