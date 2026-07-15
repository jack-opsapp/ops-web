"use client";

/**
 * OPS Web — Collapsible map-backed lead summary strip.
 *
 * The persistent header of the lead-detail window (floating window + drawer).
 * Redesign (lead-detail audit, Direction A, 2026-07-09): the map no longer
 * rents a fixed 158px slab at the top of the window. By default the header is a
 * slim ~44px ADDRESS STRIP — address text + a small map glyph + an expand
 * control. Tapping it slides the full deal band (map backdrop + estimated-value
 * hero + win bar + priority + inline facts) open to its original height on
 * demand; tapping again collapses it. The ~114px reclaimed by the collapsed
 * default flows straight into the record scroller below, so the operator lands
 * on the story and the contact instead of on a picture.
 *
 * ── Composition ──────────────────────────────────────────────────────────────
 *  - Strip (always, 44px): a full-width toggle button — map glyph (only when the
 *    lead has coordinates) + address (or the `—` sentinel) + a chevron that
 *    rotates on expand. This is the sole persistent chrome.
 *  - Reveal (on demand, 114px): the original deal band — a non-interactive
 *    <ProjectMap expanded={false}> backdrop (ONLY when the lead has coordinates;
 *    a lead with no coordinates reveals the facts on the plain canvas — never a
 *    decorative grid), a bottom-weighted scrim, the estimated-value hero
 *    (CurrencyField), the read-only win readout + olive bar, the priority chip,
 *    and the inline-editable facts row (client · source · owner · close).
 *
 * A lead with no coordinates still expands: the value / priority / source /
 * owner / close editors live NOWHERE else, so the strip stays their one-tap
 * home — it just opens onto the plain dark canvas instead of a map, and the
 * strip drops the map glyph (there is nothing map-like to promise).
 *
 * ── Motion ───────────────────────────────────────────────────────────────────
 * The reveal animates height (0 ↔ 114) on the single OPS easing curve
 * (`EASE_SMOOTH`), 200ms. `prefers-reduced-motion` collapses it to an
 * opacity-only 150ms crossfade (no height tween, no chevron spin).
 *
 * ── Shared-edit contract ─────────────────────────────────────────────────────
 * This strip owns the SINGLE {@link useOpportunityFieldEdit} instance and
 * threads it (+ `canManage`) into every editor. The editors NEVER create their
 * own — one optimistic mutation engine per opportunity, many editors.
 *
 * ── Design tokens (traced to .interface-design/system.md) ─────────────────────
 *  - scrim / pill: `--map-fade-*`, `--scrim-overlay`, `--scrim-window-shadow`,
 *    `--map-canvas-bg`, `--fill-neutral-dim` — zero hex.
 *  - numbers: `font-mono` with `"tnum" 1, "zero" 1`; empty → the `—` sentinel.
 *  - win bar: `var(--olive)` (positive/probability semantic).
 *  - accent (`ops-accent`): focus rings ONLY (strip toggle + the editors).
 *  - voice: `//` + `▸` tactical prefixes, `[brackets]`, sentence case, no emoji.
 */

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, MapPin, ArrowUpRight } from "lucide-react";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import {
  OPPORTUNITY_STAGE_COLORS,
  type Opportunity,
} from "@/lib/types/pipeline";
import { useOpportunityFieldEdit } from "@/lib/hooks/use-opportunity-field-edit";
import { ProjectMap } from "@/components/ops/projects/workspace/map/project-map";
import {
  CurrencyField,
  DateField,
  OwnerField,
  PriorityField,
  SourceField,
} from "./lead-field-editors";

// ─── Tokens ──────────────────────────────────────────────────────────────────

/** Em-dash sentinel — never "N/A". */
const EMPTY = "—";

/**
 * Strip + reveal heights. The collapsed strip is the sole default chrome; the
 * reveal restores the band to roughly its original 158px total (44 strip +
 * ≥114 reveal) from spec §6 / Phase 3. The reveal is a `min-height`, not a
 * fixed height: its content (pill row → spacer → value hero + facts) is normal
 * flow, so when the facts row wraps at the window's 780px width the reveal
 * GROWS instead of letting a bottom-anchored block overflow into the
 * Open-in-Maps pill (the B2 collision). Collapsing hands the whole reveal back
 * to the record scroller.
 */
const STRIP_HEIGHT = 44;
const REVEAL_MIN_HEIGHT = 114;

/**
 * Bottom-weighted scrim (rendered only over a real map). Two stacked layers,
 * all from existing CSS vars:
 *  1. the MapHero fade idiom (transparent → `--map-fade-mid` → `--map-fade-end`)
 *     bridges the Mapbox tiles into the darkened base, and
 *  2. an extra bottom darkening (`--scrim-overlay` → `--scrim-window-shadow`)
 *     anchored to the lower ~45% so the value + facts read white over any tile.
 * The later gradient paints on top, so the bottom resolves to the deepest scrim.
 */
const SCRIM_BACKGROUND = [
  "linear-gradient(180deg, var(--scrim-overlay) 0%, transparent 18%, transparent 55%, var(--scrim-overlay) 78%, var(--scrim-window-shadow) 100%)",
  "linear-gradient(180deg, transparent 0%, transparent 48%, var(--map-fade-mid) 78%, var(--map-fade-end) 100%)",
].join(", ");

// ─── Open-in-Maps URL ─────────────────────────────────────────────────────────

/**
 * Build the external Google Maps search URL for a lead:
 *  - coordinates present → `query=${lat},${lng}` (most precise),
 *  - else an address     → `query=${encodeURIComponent(address)}`,
 *  - else                → `null` (render no link).
 */
function buildMapsUrl(
  latitude: number | null,
  longitude: number | null,
  address: string | null,
): string | null {
  if (latitude != null && longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }
  const trimmed = address?.trim();
  if (trimmed) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
  }
  return null;
}

// ─── Micro label ───────────────────────────────────────────────────────────────

/** A `// LABEL` mono micro-label, light tone — the OPS section-label voice. */
function FactLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[9px] uppercase leading-none tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"//"}</span> {children}
    </span>
  );
}

// ─── LeadMapBand ───────────────────────────────────────────────────────────────

export function LeadMapBand({
  opportunity,
  canManage,
}: {
  opportunity: Opportunity;
  canManage: boolean;
}) {
  const { t } = useDictionary("pipeline");
  const reduceMotion = useReducedMotion();
  // Collapsed by default — the reclaimed height is the entire point.
  const [expanded, setExpanded] = useState(false);

  // ONE shared optimistic-edit engine for the whole band — threaded into every
  // editor below. Editors never instantiate their own.
  const edit = useOpportunityFieldEdit(opportunity.id);

  const { latitude, longitude, address, stage, winProbability } = opportunity;
  const hasCoords = latitude != null && longitude != null;
  const pinColor = OPPORTUNITY_STAGE_COLORS[stage];

  const mapsUrl = useMemo(
    () => buildMapsUrl(latitude, longitude, address),
    [latitude, longitude, address],
  );

  // Read-only win probability, clamped to a sane 0–100 bar width.
  const winPct = Math.max(0, Math.min(100, Math.round(winProbability)));

  // Client > inline contact > sentinel — read-only in the band.
  const clientName = opportunity.client?.name ?? opportunity.contactName ?? null;

  const revealId = `lead-band-reveal-${opportunity.id}`;
  const toggleLabel = expanded
    ? hasCoords
      ? t("band.hideMap", "Hide map")
      : t("band.hideDetails", "Hide details")
    : hasCoords
      ? t("band.showMap", "Show map")
      : t("band.showDetails", "Show details");

  return (
    <div
      data-testid="lead-map-band"
      className="relative w-full overflow-hidden border-b border-border-subtle"
      style={{ background: "var(--map-canvas-bg)" }}
    >
      {/* Address strip — the sole persistent chrome; the whole bar is the toggle. */}
      <button
        type="button"
        data-testid="lead-map-strip"
        aria-expanded={expanded}
        aria-controls={revealId}
        aria-label={toggleLabel}
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "flex w-full items-center gap-2 px-[11px] text-left",
          "transition-colors duration-150 ease-smooth",
          "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ops-accent",
        )}
        style={{ height: STRIP_HEIGHT }}
      >
        {hasCoords ? (
          <MapPin
            size={12}
            strokeWidth={1.5}
            className="shrink-0 text-text-3"
            aria-hidden="true"
          />
        ) : null}

        {address ? (
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.14em] text-text-2">
            <span aria-hidden="true" className="text-text-mute">
              ▸
            </span>
            <span className="truncate">{address}</span>
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase leading-none tracking-[0.14em] text-text-3">
            {EMPTY}
          </span>
        )}

        <ChevronDown
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          className={cn(
            "ml-auto shrink-0 text-text-3 transition-transform duration-200 ease-smooth motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Reveal — the full deal band, opened on demand. */}
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="reveal"
            id={revealId}
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={
              reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }
            }
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{
              duration: reduceMotion ? 0.15 : 0.2,
              ease: EASE_SMOOTH,
            }}
            className="relative overflow-hidden border-t border-border-subtle"
          >
            {/* Flow column over the backdrop: pill row → spacer → content.
                Everything is normal flow (min-height, never fixed), so the
                pill and the facts can NEVER overlap — when the facts row wraps
                at drawer/window width, the reveal grows instead of colliding. */}
            <div
              className="relative flex flex-col"
              style={{ minHeight: REVEAL_MIN_HEIGHT }}
            >
              {/* Backdrop — real map ONLY when we have coordinates; otherwise the
                  plain canvas (no decorative grid). */}
              {hasCoords ? (
                <>
                  <div className="absolute inset-0" aria-hidden="true">
                    <ProjectMap
                      latitude={latitude}
                      longitude={longitude}
                      pinColor={pinColor}
                      expanded={false}
                    />
                  </div>
                  {/* Bottom-weighted scrim — guarantees the value + facts read white. */}
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{ background: SCRIM_BACKGROUND }}
                    aria-hidden="true"
                  />
                </>
              ) : null}

              {/* Open-in-Maps pill (top-right, in flow — structurally cannot
                  overlap the facts below). */}
              {mapsUrl ? (
                <div className="relative flex justify-end px-[11px] pt-[11px]">
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("band.openInMaps", "Open in Maps")}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-[5px] border border-glass-border px-2 py-1",
                      "font-mono text-[9px] uppercase tracking-[0.16em] text-text-2",
                      "transition-colors duration-150 ease-smooth hover:text-text",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                    )}
                    style={{
                      background: "var(--scrim-window-shadow)",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                    }}
                  >
                    <MapPin size={10} strokeWidth={1.5} aria-hidden="true" />
                    <span>{t("band.openInMaps", "Open in Maps")}</span>
                    <ArrowUpRight size={10} strokeWidth={1.5} aria-hidden="true" />
                  </a>
                </div>
              ) : null}

              {/* Spacer — flexes so the content sits at the bottom of the
                  min-height reveal (map showing through), but always keeps at
                  least 8px between the pill row and the value hero. */}
              <div className="min-h-2 flex-1" aria-hidden="true" />

              {/* band-content: value hero + win + priority + facts — bottom of
                  the reveal, in flow (grows the reveal when the facts wrap). */}
              <div className="relative flex flex-col gap-1.5 p-3">
                {/* Value hero row — `// ESTIMATED VALUE` + the big editable currency. */}
                <div className="flex items-end justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <FactLabel>{t("band.estimatedValue", "Estimated value")}</FactLabel>
                    <CurrencyField
                      edit={edit}
                      canManage={canManage}
                      value={opportunity.estimatedValue}
                      className="text-[30px] font-medium leading-none text-white"
                    />
                  </div>

                  {/* Win probability — READ-ONLY readout + olive bar. */}
                  <div className="flex shrink-0 flex-col items-end gap-1 pb-1">
                    <span className="font-mono text-[10px] uppercase leading-none tracking-[0.12em] tabular-nums text-text-2 [font-feature-settings:'tnum'_1,'zero'_1]">
                      {winPct}% {t("band.win", "win")}
                    </span>
                    <div
                      className="h-[2px] w-[72px] overflow-hidden rounded-bar"
                      style={{ background: "var(--fill-neutral-dim)" }}
                      role="presentation"
                    >
                      <div
                        className="h-full rounded-bar"
                        style={{ width: `${winPct}%`, background: "var(--olive)" }}
                      />
                    </div>
                  </div>
                </div>

                {/* Facts row — priority chip + the four inline-editable facts. Wraps at
                    drawer width; the value above never wraps. Each fact: `// LABEL` +
                    value, legible over the scrim. */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <FactLabel>{t("band.priorityLabel", "Priority")}</FactLabel>
                    <PriorityField
                      edit={edit}
                      canManage={canManage}
                      value={opportunity.priority}
                    />
                  </div>

                  <Fact label={t("band.clientLabel", "Client")}>
                    {clientName ? (
                      <span className="truncate font-mohave text-[13px] text-text">
                        {clientName}
                      </span>
                    ) : (
                      <span className="font-mohave text-[13px] text-text-3">{EMPTY}</span>
                    )}
                  </Fact>

                  <Fact label={t("band.sourceLabel", "Source")}>
                    <SourceField
                      edit={edit}
                      canManage={canManage}
                      value={opportunity.source}
                      className="text-text"
                    />
                  </Fact>

                  <Fact label={t("band.ownerLabel", "Owner")}>
                    <OwnerField
                      edit={edit}
                      canManage={canManage}
                      value={opportunity.assignedTo}
                      className="text-text"
                    />
                  </Fact>

                  <Fact label={t("band.closeDate", "Expected close")}>
                    <DateField
                      edit={edit}
                      canManage={canManage}
                      value={opportunity.expectedCloseDate}
                      className="text-text"
                    />
                  </Fact>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ─── Fact ──────────────────────────────────────────────────────────────────────

/** A single `// LABEL` + value pairing in the facts row. */
function Fact({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <FactLabel>{label}</FactLabel>
      <span className="flex min-w-0 items-center">{children}</span>
    </div>
  );
}
