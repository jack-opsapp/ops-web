"use client";

import { useState } from "react";
import {
  GatePanel,
  type GateReason,
} from "@/components/catalog-setup/prerequisite-gate";

const REASONS: GateReason[] = [
  "no_company",
  "baseline_not_seeded",
  "catalog_surface_absent",
  "subscription_locked",
  "session_locked",
];

/**
 * Interactive control bar + the GatePanel under test. `initialReason` lets the
 * server page deep-link a state (?reason=session_locked) so each blocked state
 * renders server-side (curl-verifiable) AND can be cycled in the browser.
 */
export function GatePreview({ initialReason }: { initialReason: GateReason }) {
  const [reason, setReason] = useState<GateReason>(initialReason);

  return (
    <div className="relative min-h-screen bg-background">
      <div className="fixed bottom-3 right-3 z-50 flex flex-wrap items-center gap-2 rounded-chip border border-glass-border bg-[rgba(18,18,20,0.92)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-3 backdrop-blur">
        <span aria-hidden>// gate preview</span>
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            data-active={r === reason}
            className="rounded-chip border border-glass-border px-2 py-[2px] text-text-2 transition-colors hover:bg-surface-hover hover:text-text data-[active=true]:text-text"
          >
            {r}
          </button>
        ))}
      </div>

      <GatePanel
        reason={reason}
        onReload={() => {
          /* DEV PREVIEW — would window.location.reload(). */
        }}
        onExit={() => {
          /* DEV PREVIEW — would route back to /catalog. */
        }}
      />
    </div>
  );
}
