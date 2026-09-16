"use client";

/**
 * `// DECK DESIGN` — the project's own deck drawing (report `acc0d021`).
 *
 * `deck_designs.project_id` is written the moment a lead converts, so the
 * drawing the crew made on the site visit already belongs to the job — it just
 * had nowhere to appear. Without it the one document the whole build is measured
 * from lived only on the closed lead, and the person running the job could not
 * reach it.
 *
 * State-aware, like the lead section: a project with no deck renders NOTHING.
 * Most jobs are not decks, and an empty "no deck design" block on every job
 * would cost every operator a line of scanning to learn nothing.
 *
 * It sits directly under Scope in the dossier: scope says what the job is, the
 * deck IS the job, and Team and Tasks (who and when) follow.
 */

import { useState } from "react";

import { useDictionary } from "@/i18n/client";
import { useProjectDeckDesigns } from "@/lib/hooks/use-deck-design-drawing";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { DeckDesignRow } from "@/components/ops/deck/deck-design-row";
import { DeckViewer } from "@/components/ops/deck/deck-viewer";

export function ProjectDeckSection({ projectId }: { projectId: string }) {
  const { t } = useDictionary("project-workspace");
  const { data: designs } = useProjectDeckDesigns(projectId);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!designs || designs.length === 0) return null;

  const openDesign = openId
    ? designs.find((design) => design.id === openId)
    : undefined;

  return (
    <Section
      title={t("deck.title", "Deck design")}
      data-testid="project-deck-design"
    >
      <Stack gap={0.5}>
        {designs.map((design) => (
          <DeckDesignRow
            key={design.id}
            design={design}
            onOpen={() => setOpenId(design.id)}
            openLabel={t("deck.open", "View deck design")}
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
