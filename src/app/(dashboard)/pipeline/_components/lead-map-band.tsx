"use client";

/**
 * OPS Web — Map-backed lead summary band.
 *
 * The persistent header of the lead-detail window (floating window + drawer).
 * It makes a deal glanceable the instant the window opens: a tactical map
 * backdrop, a bottom-weighted scrim, and along the bottom the estimated-value
 * hero plus the inline-editable facts row (value · source · owner · close) and
 * a read-only win-probability readout + priority chip.
 *
 * ── Composition ──────────────────────────────────────────────────────────────
 *  - Backdrop: <ProjectMap expanded={false}> (non-interactive — `interactive` is
 *    driven by `expanded` inside ProjectMap, so a collapsed map is a true
 *    backdrop). When the lead has no coordinates we paint a tactical-grid
 *    placeholder instead — never a naked/empty map.
 *  - Scrim: a `pointer-events-none` bottom-weighted gradient built ONLY from the
 *    map-scoped + scrim CSS vars (no raw rgba). It guarantees the value + facts
 *    read white over any map tile.
 *  - band-top: address (mono micro, `▸` prefix, ellipsis) + an "Open in Maps"
 *    glass pill (real external link).
 *  - band-content: `// ESTIMATED VALUE` + the value hero (CurrencyField sized up
 *    to ~30px), the win bar, the priority chip, and the facts row.
 *
 * ── Shared-edit contract ─────────────────────────────────────────────────────
 * This band owns the SINGLE {@link useOpportunityFieldEdit} instance and threads
 * it (+ `canManage`) into every editor. The editors NEVER create their own — one
 * optimistic mutation engine per opportunity, many editors.
 *
 * ── Design tokens (traced to .interface-design/system.md) ─────────────────────
 *  - scrim / grid / pill: `--map-fade-*`, `--scrim-overlay`,
 *    `--scrim-window-shadow`, `--map-canvas-bg`, `--fill-neutral-dim` — zero hex.
 *  - numbers: `font-mono` with `"tnum" 1, "zero" 1`; empty → the `—` sentinel.
 *  - win bar: `var(--olive)` (positive/probability semantic).
 *  - accent (`ops-accent`): focus rings ONLY (owned by the editors).
 *  - voice: `//` + `▸` tactical prefixes, `[brackets]`, sentence case, no emoji.
 */

import { useMemo } from "react";
import { MapPin, ArrowUpRight } from "lucide-react";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
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

/** Band height per spec §6 / Phase 3 plan. */
const BAND_HEIGHT = 158;

/**
 * Bottom-weighted scrim. Two stacked layers, all from existing CSS vars:
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

/**
 * Tactical-grid placeholder painted when the lead has no coordinates. A faint
 * `--fill-neutral-dim` hairline grid over the map canvas — the same dark base
 * the real map paints, so there's no jarring fallback. No raw rgba.
 */
const GRID_BACKGROUND = [
  "repeating-linear-gradient(0deg, var(--fill-neutral-dim) 0 1px, transparent 1px 28px)",
  "repeating-linear-gradient(90deg, var(--fill-neutral-dim) 0 1px, transparent 1px 28px)",
  "var(--map-canvas-bg)",
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

  return (
    <div
      data-testid="lead-map-band"
      className="relative w-full overflow-hidden border-b border-border-subtle"
      style={{ height: BAND_HEIGHT, background: "var(--map-canvas-bg)" }}
    >
      {/* Backdrop — real map when we have coordinates, tactical grid otherwise. */}
      <div className="absolute inset-0" aria-hidden="true">
        {hasCoords ? (
          <ProjectMap
            latitude={latitude}
            longitude={longitude}
            pinColor={pinColor}
            expanded={false}
          />
        ) : (
          <div
            data-testid="lead-map-grid-fallback"
            className="h-full w-full"
            style={{ background: GRID_BACKGROUND }}
          />
        )}
      </div>

      {/* Bottom-weighted scrim — guarantees the value + facts read white. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: SCRIM_BACKGROUND }}
        aria-hidden="true"
      />

      {/* band-top: address (left) + Open-in-Maps pill (right). */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-[11px]">
        {address ? (
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.14em] text-text-2">
            <span aria-hidden="true" className="text-text-mute">
              ▸
            </span>
            <span className="truncate">{address}</span>
          </span>
        ) : (
          <span aria-hidden="true" />
        )}

        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("band.openInMaps", "Open in Maps")}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-[5px] border border-glass-border px-2 py-1",
              "font-mono text-[9px] uppercase tracking-[0.16em] text-text-2",
              "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text",
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
        ) : null}
      </div>

      {/* band-content: value hero + win + priority + facts, anchored to bottom. */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-3">
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
