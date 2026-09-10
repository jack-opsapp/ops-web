"use client";

/**
 * What the engine changed on Google and whether it helped, with the honest
 * caveat baked in: only CTR is measurable at this volume, and a change is
 * scored only after its fourteen-day window closes.
 */
import { Tag } from "@/components/ui/tag";
import type { AdminChangeRow } from "@/lib/ads/engine/admin";
import type { ChangeVerdict } from "@/lib/ads/engine/types";
import { BUTTONS, EMPTY, ERROR, KIND_TAGS, LABELS, LEDGER, VERDICT_TAGS } from "./copy";
import { daysBetween, money, shortDate } from "./format";
import { PanelLabel, PanelSkeleton, PanelStatus } from "./panel";

export interface ChangeLedgerProps {
  changes: AdminChangeRow[] | undefined;
  isPending: boolean;
  error: Error | null;
  today?: string;
  onRetry?: () => void;
}

const VERDICT_VARIANT: Record<ChangeVerdict, "olive" | "rose" | "neutral" | "dim"> = {
  pending: "dim",
  better: "olive",
  worse: "rose",
  flat: "neutral",
  no_verdict: "dim",
};

const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

function describe(change: AdminChangeRow): string {
  const before = (change.before ?? {}) as Record<string, unknown>;
  const after = (change.after ?? {}) as Record<string, unknown>;
  switch (change.kind) {
    case "add_negatives":
      return `${(after.added as string[] | undefined)?.length ?? 0} negatives added`;
    case "pause_keyword":
      return `"${str(before.text)}" paused`;
    case "add_keywords":
      return `${(after.added as string[] | undefined)?.length ?? 0} keywords added`;
    case "create_rsa_challenger":
      return `Challenger ad live · ${str(after.hypothesis)}`;
    case "promote_challenger":
      return "Challenger promoted, control paused";
    case "pause_ad":
      return `Ad paused · ${str(after.reason)}`;
    case "adjust_budget":
      return `Budget ${money(Number(before.dailyBudget), true)} → ${money(Number(after.dailyBudget), true)} per day`;
    case "adjust_cpc_cap":
      return `CPC cap ${money(Number(before.cpcCeiling))} → ${money(Number(after.cpcCeiling))}`;
    case "set_bidding_strategy":
      return `${str(before.strategy).replaceAll("_", " ").toLowerCase()} → ${str(after.strategy).replaceAll("_", " ").toLowerCase()}`;
    case "add_ad_group":
      return `Ad group "${str(after.name)}" created`;
    case "observation":
      return "Noted";
  }
}

export function ChangeLedger({ changes, isPending, error, today = new Date().toISOString().slice(0, 10), onRetry }: ChangeLedgerProps) {
  const rows = [...(changes ?? [])].sort((a, b) => b.applied_at.localeCompare(a.applied_at));
  return (
    <section aria-labelledby="engine-ledger-label">
      <PanelLabel id="engine-ledger-label">{LABELS.ledger}</PanelLabel>
      {isPending ? (
        <PanelSkeleton rows={3} />
      ) : error ? (
        <PanelStatus tone="error" action={onRetry ? { label: BUTTONS.retry, onClick: onRetry } : undefined}>
          {ERROR.load}
        </PanelStatus>
      ) : rows.length === 0 ? (
        <PanelStatus>{EMPTY.ledger}</PanelStatus>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="pb-1 pr-2 text-left font-mono text-micro uppercase tracking-wider text-text-3">{LEDGER.applied}</th>
                <th className="pb-1 pr-2 text-left font-mono text-micro uppercase tracking-wider text-text-3">{LEDGER.change}</th>
                <th className="pb-1 text-right font-mono text-micro uppercase tracking-wider text-text-3">{LEDGER.outcome}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((change) => {
                const post = (change.post_metrics ?? {}) as { deltaPct?: number | null };
                const daysLeft = change.verdict === "pending" ? daysBetween(today, change.measure_to) : null;
                return (
                  <tr key={change.id} className="border-b border-border-subtle" data-testid="ledger-row" data-verdict={change.verdict}>
                    <td className="py-1 pr-2 align-top font-mono text-micro tabular-nums text-text-3">{shortDate(change.applied_at)}</td>
                    <td className="py-1 pr-2 align-top">
                      <div className="flex flex-wrap items-center gap-0.5">
                        <Tag variant="neutral">{KIND_TAGS[change.kind]}</Tag>
                        <span className="font-mohave text-body-sm text-text">{describe(change)}</span>
                      </div>
                      {change.proposal?.rationale && <p className="mt-0.5 font-mono text-micro text-text-3">{change.proposal.rationale}</p>}
                    </td>
                    <td className="py-1 text-right align-top">
                      <div className="flex flex-col items-end gap-0.5">
                        <Tag variant={VERDICT_VARIANT[change.verdict]}>{VERDICT_TAGS[change.verdict]}</Tag>
                        <span className="font-mono text-micro tabular-nums text-text-3">
                          {change.verdict === "pending" && daysLeft !== null
                            ? LEDGER.daysLeft(daysLeft)
                            : typeof post.deltaPct === "number"
                              ? LEDGER.ctrDelta(post.deltaPct)
                              : "—"}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
