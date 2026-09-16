"use client";

/**
 * The 3D pane's host.
 *
 * Three.js is ~150KB and almost nobody switches to 3D — so the scene is a
 * `dynamic(..., { ssr: false })` import and the plan view never pays for it.
 * The slot exists so the viewer can own the LAYOUT of the 3D pane (and its
 * empty state) without importing the renderer to do it.
 *
 * The massing is gated on a closed outline, exactly as iOS gates it
 * (`DeckFullscreenViewer.swift`): there is nothing honest to extrude from an
 * unfinished run of edges, and a half-built box would read as a real deck.
 */

import dynamic from "next/dynamic";
import { Suspense } from "react";

import { useDictionary } from "@/i18n/client";
import type { DeckDrawing } from "@/lib/deck/drawing-data";

const DeckScene3D = dynamic(
  () => import("./deck-scene-3d").then((module) => module.DeckScene3D),
  { ssr: false },
);

export function DeckScene3DSlot({
  drawing,
  isolatedLevelId,
}: {
  drawing: DeckDrawing;
  isolatedLevelId: string | null;
}) {
  const { t } = useDictionary("pipeline");

  return (
    <div data-testid="deck-scene-3d-slot" className="h-full w-full">
      {drawing.hasClosedSurface ? (
        <Suspense fallback={<ScenePlaceholder label={t("deck.viewer.loading", "Loading drawing")} />}>
          <DeckScene3D drawing={drawing} isolatedLevelId={isolatedLevelId} />
        </Suspense>
      ) : (
        <ScenePlaceholder label={t("deck.viewer.empty", "[ no closed outline ]")} />
      )}
    </div>
  );
}

function ScenePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className="font-mono text-micro uppercase tracking-authority text-text-3">
        {label}
      </span>
    </div>
  );
}
