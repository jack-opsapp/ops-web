"use client";

/* eslint-disable @next/next/no-img-element -- Deck thumbnails are arbitrary S3 URLs outside the Next image allowlist. */

/**
 * `DeckDesignRow` — one deck design, as a row.
 *
 * The same row serves the lead's `// DECK DESIGN` section and the project
 * workspace's: a deck drawn on a site visit is the same object before and
 * after the lead converts, and an operator who learned to recognise it on one
 * surface must recognise it on the other.
 *
 * Glyph priority is deliberate: the wireframe of the ACTUAL outline first
 * (crisp at 40px and unmistakably this deck), then the raster thumbnail, then
 * the icon. The thumbnail is CONTAINED, never cropped — a deck cropped to a
 * square is a different deck (`b130d23f`).
 */

import { useMemo } from "react";
import { Maximize2, PencilRuler } from "lucide-react";

import type { OpportunityDeckDesign } from "@/lib/api/services/deck-design-service";
import { buildWireframeModel, type WireframeModel } from "@/lib/utils/deck-wireframe";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";

import { DeckWireframe } from "./deck-wireframe";

export function DeckDesignRow({
  design,
  onOpen,
  openLabel,
}: {
  design: OpportunityDeckDesign;
  onOpen: () => void;
  openLabel: string;
}) {
  const model = useMemo(
    () => buildWireframeModel(design.vertices, design.edges),
    [design.vertices, design.edges],
  );

  const meta = `V${design.version} · ${formatDate(
    design.updatedAt ?? design.createdAt,
    "MMM d",
  )}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${openLabel} — ${design.title}`}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded px-1.5 py-1.5 text-left",
        "transition-colors duration-150 hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ops-accent",
      )}
    >
      <DeckGlyph model={model} thumbnailUrl={design.thumbnailUrl} />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="min-w-0 truncate font-mohave text-caption text-text-2 transition-colors group-hover:text-text">
          {design.title}
        </span>
        <span className="font-mono text-micro tabular-nums text-text-mute [font-feature-settings:'tnum'_1,'zero'_1]">
          {meta}
        </span>
      </span>

      <Maximize2
        className="h-icon-16 w-icon-16 shrink-0 text-text-mute transition-colors group-hover:text-text-2"
        strokeWidth={1.5}
      />
    </button>
  );
}

function DeckGlyph({
  model,
  thumbnailUrl,
}: {
  model: WireframeModel | null;
  thumbnailUrl: string | null;
}) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-fill-neutral-dim">
      {model ? (
        <DeckWireframe model={model} className="h-full w-full p-1 text-text-2" />
      ) : thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" className="h-full w-full object-contain" />
      ) : (
        <PencilRuler className="h-icon-20 w-icon-20 text-text-3" strokeWidth={1.5} />
      )}
    </span>
  );
}
