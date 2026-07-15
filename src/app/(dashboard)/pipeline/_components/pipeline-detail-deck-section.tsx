"use client";

/* eslint-disable @next/next/no-img-element -- Deck thumbnails are arbitrary S3 URLs outside the Next image allowlist. */

/**
 * `// DECK DESIGN` — the crew's on-site deck sketch, attached to the lead
 * via `deck_designs.opportunity_id` (iOS lead-detail START DECK DESIGN /
 * site-visit sketch — bible 03 § deck_designs, Lead attachment).
 *
 * State-aware: renders NOTHING when the lead has no deck — zero footprint
 * for the overwhelming majority of leads. When present it sits between the
 * job site (Location) and the paper trail (Linked): the thing drawn for the
 * site. View-only; each row opens the {@link DeckDesignViewer}.
 *
 * Glyph priority: wireframe of the actual outline (crisp at 40px, unmistakably
 * this deck) → raster thumbnail → pencil-ruler icon.
 */

import { useMemo, useState } from "react";
import { Maximize2, PencilRuler } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { useOpportunityDeckDesigns } from "@/lib/hooks/use-opportunity-deck-designs";
import type { OpportunityDeckDesign } from "@/lib/api/services/deck-design-service";
import { buildWireframeModel, type WireframeModel } from "@/lib/utils/deck-wireframe";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { DeckWireframe } from "./deck-wireframe";
import { DeckDesignViewer } from "./deck-design-viewer";

export function PipelineDetailDeckSection({
  opportunityId,
}: {
  opportunityId: string;
}) {
  const { t } = useDictionary("pipeline");
  const { data: designs } = useOpportunityDeckDesigns(opportunityId);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!designs || designs.length === 0) return null;

  const openDesign = openId
    ? designs.find((design) => design.id === openId)
    : undefined;

  return (
    <Section
      title={t("overview.deckDesign", "Deck design")}
      data-testid="overview-deck-design"
    >
      <Stack gap={0.5}>
        {designs.map((design) => (
          <DeckDesignRow
            key={design.id}
            design={design}
            onOpen={() => setOpenId(design.id)}
            openLabel={t("overview.deckOpen", "View deck design")}
          />
        ))}
      </Stack>

      {openDesign && (
        <DeckDesignViewer
          design={openDesign}
          onClose={() => setOpenId(null)}
        />
      )}
    </Section>
  );
}

function DeckDesignRow({
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
    [design.vertices, design.edges]
  );

  const meta = `V${design.version} · ${formatDate(
    design.updatedAt ?? design.createdAt,
    "MMM d"
  )}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${openLabel} — ${design.title}`}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded px-1.5 py-1.5 text-left",
        "transition-colors duration-150 hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
      )}
    >
      <DeckGlyph model={model} thumbnailUrl={design.thumbnailUrl} />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="min-w-0 truncate font-mohave text-[14px] text-text-2 transition-colors group-hover:text-text">
          {design.title}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-text-mute [font-feature-settings:'tnum'_1,'zero'_1]">
          {meta}
        </span>
      </span>

      <Maximize2
        className="h-3 w-3 shrink-0 text-text-mute transition-colors group-hover:text-text-2"
        strokeWidth={1.75}
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
        <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <PencilRuler className="h-4 w-4 text-text-3" strokeWidth={1.75} />
      )}
    </span>
  );
}
