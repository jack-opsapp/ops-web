"use client";

/**
 * The engine's inbox: everything waiting for Jackson, one card each, with a
 * batch bar when several negative lists wait at once. Skeleton while pending
 * (a paused fetch must never read as empty), a quiet line when nothing waits.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AdminProposalRow } from "@/lib/ads/engine/admin";
import type { ReviewOutcome, ReviewResponse } from "@/lib/hooks/use-ads-engine";
import { BUTTONS, EMPTY, ERROR, LABELS } from "./copy";
import { ProposalCard } from "./proposal-card";
import { PanelLabel, PanelSkeleton, PanelStatus } from "./panel";

export interface ProposalPanelProps {
  proposals: AdminProposalRow[] | undefined;
  isPending: boolean;
  error: Error | null;
  onReview: (input: { id: string; decision: "approve" | "reject"; notes?: string }) => Promise<ReviewResponse>;
  onRetry?: () => void;
  now?: Date;
}

export function ProposalPanel({ proposals, isPending, error, onReview, onRetry, now = new Date() }: ProposalPanelProps) {
  const [outcomes, setOutcomes] = useState<Record<string, ReviewOutcome>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const review = async (id: string, decision: "approve" | "reject", notes?: string) => {
    setBusy((current) => new Set(current).add(id));
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      const response = await onReview({ id, decision, notes });
      setOutcomes((current) => ({ ...current, [id]: response.outcome }));
    } catch (failure) {
      setErrors((current) => ({ ...current, [id]: failure instanceof Error && failure.message ? failure.message : ERROR.review }));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const waiting = (proposals ?? []).filter((p) => p.state === "proposed" && !outcomes[p.id]);
  const negatives = waiting.filter((p) => p.kind === "add_negatives");
  const approveAllNegatives = async () => {
    for (const proposal of negatives) await review(proposal.id, "approve");
  };

  return (
    <section id="proposals" aria-labelledby="engine-proposals-label" className="scroll-mt-4">
      <div className="flex items-center justify-between gap-2">
        <PanelLabel id="engine-proposals-label" count={waiting.length || undefined}>
          {LABELS.proposals}
        </PanelLabel>
        {negatives.length >= 2 && (
          <div className="flex items-center gap-1" data-testid="batch-bar">
            <span className="font-mono text-micro text-text-3">{negatives.length} negative lists waiting</span>
            <Button variant="primary" size="sm" disabled={busy.size > 0} onClick={approveAllNegatives}>
              {BUTTONS.approveAll(negatives.length)}
            </Button>
          </div>
        )}
      </div>

      {isPending ? (
        <PanelSkeleton rows={2} />
      ) : error ? (
        <PanelStatus tone="error" action={onRetry ? { label: BUTTONS.retry, onClick: onRetry } : undefined}>
          {ERROR.load}
        </PanelStatus>
      ) : (proposals ?? []).length === 0 ? (
        <PanelStatus>{EMPTY.proposals}</PanelStatus>
      ) : (
        <ul className="mt-1 space-y-1">
          {(proposals ?? []).map((proposal) => (
            <li key={proposal.id}>
              <ProposalCard proposal={proposal} outcome={outcomes[proposal.id] ?? null} busy={busy.has(proposal.id)} error={errors[proposal.id] || null} onReview={review} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
