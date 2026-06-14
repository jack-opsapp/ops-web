"use client";

// DEV PREVIEW — standalone harness for the catalog-setup SetupWizardShell.
//
// Renders the FULL wizard (header strip + ModuleRail + the single BUILD IT CTA +
// the [ set up later ] ghost exit + the two-pane body: DriverPane / ItemEditor on
// the left, CanvasPane on the right) wired to the real store + selectors +
// reducer, seeded with the foundations mock cards. It mounts WITHOUT auth or a
// database — pure component + mock store — so it can be screenshotted via the dev
// server at /catalog-setup-preview.
//
// The wizard mounts into /catalog after a later rebase; until then this route is
// the only way to see it. Not linked from anywhere — reach it directly. It sits
// OUTSIDE every protected prefix in middleware.ts, so no auth gate fires.
//
// A thin preview-only control bar toggles tracked-inventory (to demo the
// state-aware STOCK omission across both the rail and the canvas), swaps the
// left driver between the source picker and the guided-setup conversation, and
// reseeds the canvas. These controls are NOT part of the wizard surface.

import { useEffect, useState } from "react";
import { useCatalogSetupStore } from "@/stores/catalog-setup-store";
import type { StepContext } from "@/lib/catalog-setup/step-machine";
import {
  PREVIEW_STAGING_CARDS,
  PREVIEW_EXISTING_ROWS,
} from "@/lib/catalog-setup/__mocks__/preview-cards";
import { SetupWizardShell } from "@/components/catalog-setup/setup-wizard-shell";

export default function CatalogSetupPreviewPage() {
  const dispatch = useCatalogSetupStore((s) => s.dispatch);
  const reset = useCatalogSetupStore((s) => s.reset);
  // Gate the seed on rehydration: the store is `persist`-backed, and its async
  // rehydrate would clobber a seed dispatched on mount. Seeding only after
  // `_hydrated` (and resetting first) makes the demo deterministic — the
  // canonical full-state set every load, never a stale or half-cleared canvas.
  const hydrated = useCatalogSetupStore((s) => s._hydrated);

  const [inventoryTracked, setInventoryTracked] = useState(true);
  const [driverMode, setDriverMode] = useState<"picker" | "conversation">(
    "conversation",
  );

  useEffect(() => {
    if (!hydrated) return;
    reset();
    dispatch({ type: "ADD_CARDS", cards: PREVIEW_STAGING_CARDS });
  }, [hydrated, reset, dispatch]);

  const context: StepContext = {
    inventoryTracked,
    canSell: true,
    canStock: true,
    canTypes: true,
  };

  return (
    <div className="relative min-h-screen bg-background">
      {/* Preview-only control bar — pinned, not part of the wizard surface. */}
      <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-chip border border-glass-border bg-[rgba(18,18,20,0.92)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-3 backdrop-blur">
        <span aria-hidden>// preview</span>
        <button
          type="button"
          onClick={() => setInventoryTracked((v) => !v)}
          className="rounded-chip border border-glass-border px-2 py-[2px] text-text-2 transition-colors hover:bg-surface-hover hover:text-text"
        >
          stock: {inventoryTracked ? "tracked" : "off"}
        </button>
        <button
          type="button"
          onClick={() =>
            setDriverMode((m) => (m === "picker" ? "conversation" : "picker"))
          }
          className="rounded-chip border border-glass-border px-2 py-[2px] text-text-2 transition-colors hover:bg-surface-hover hover:text-text"
        >
          driver: {driverMode}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            dispatch({ type: "ADD_CARDS", cards: PREVIEW_STAGING_CARDS });
          }}
          className="rounded-chip border border-glass-border px-2 py-[2px] text-text-2 transition-colors hover:bg-surface-hover hover:text-text"
        >
          reset
        </button>
      </div>

      <SetupWizardShell
        context={context}
        inventoryTracked={inventoryTracked}
        existingRows={PREVIEW_EXISTING_ROWS}
        driverMode={driverMode}
        onPickSource={() => {
          // DEV PREVIEW — picking a source advances to the guided-setup
          // conversation (real source flows land in a later phase).
          setDriverMode("conversation");
        }}
        onSwitchToGuided={() => {
          // DEV PREVIEW — would route to the deterministic survey path.
          setDriverMode("picker");
        }}
        onBuild={() => {
          /* DEV PREVIEW — commit pipeline lands after rebase; no-op here. */
        }}
        onSetupLater={() => {
          /* DEV PREVIEW — would route away from setup. */
        }}
      />
    </div>
  );
}
