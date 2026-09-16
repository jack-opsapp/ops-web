"use client";

/**
 * `// DECK DESIGN` — the crew's on-site deck sketch, attached to the lead
 * via `deck_designs.opportunity_id` (iOS lead-detail START DECK DESIGN /
 * site-visit sketch — bible 03 § deck_designs, Lead attachment).
 *
 * State-aware: renders NOTHING when the lead has no deck — zero footprint
 * for the overwhelming majority of leads. When present it sits between the
 * job site (Location) and the paper trail (Linked): the thing drawn for the
 * site. View-only; each row opens the fullscreen {@link DeckViewer}.
 */

import { useState } from "react";

import { useDictionary } from "@/i18n/client";
import { useOpportunityDeckDesigns } from "@/lib/hooks/use-opportunity-deck-designs";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { DeckDesignRow } from "@/components/ops/deck/deck-design-row";
import { DeckViewer } from "@/components/ops/deck/deck-viewer";

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
        <DeckViewer
          designId={openDesign.id}
          title={openDesign.title}
          version={openDesign.version}
          stamp={openDesign.updatedAt ?? openDesign.createdAt}
          onClose={() => setOpenId(null)}
        />
      )}
    </Section>
  );
}
