"use client";

/**
 * Click → trial → activated → paid per keyword, spend, cost per trial and per
 * paying customer. The one place "which keyword produced a paying customer"
 * is answered. Full-bleed rows, mono numbers, `—` for what has not happened.
 */
import type { FunnelRow } from "@/lib/ads/engine/brief";
import { cn } from "@/lib/utils/cn";
import { BUTTONS, EMPTY, ERROR, FUNNEL_COLUMNS, LABELS } from "./copy";
import { integer, money } from "./format";
import { PanelLabel, PanelSkeleton, PanelStatus } from "./panel";

export interface FunnelTableProps {
  rows: FunnelRow[] | undefined;
  available: boolean;
  isPending: boolean;
  error: Error | null;
  onRetry?: () => void;
}

const HEADERS: Array<{ key: keyof typeof FUNNEL_COLUMNS; align: "left" | "right" }> = [
  { key: "keyword", align: "left" },
  { key: "clicks", align: "right" },
  { key: "trials", align: "right" },
  { key: "activated", align: "right" },
  { key: "paid", align: "right" },
  { key: "spend", align: "right" },
  { key: "costPerTrial", align: "right" },
  { key: "costPerPaid", align: "right" },
];

const count = (value: number | null) => (value == null || value === 0 ? "—" : integer(value));

export function FunnelTable({ rows, available, isPending, error, onRetry }: FunnelTableProps) {
  const sorted = [...(rows ?? [])].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  return (
    <section aria-labelledby="engine-funnel-label">
      <PanelLabel id="engine-funnel-label">{LABELS.funnel}</PanelLabel>
      {isPending ? (
        <PanelSkeleton rows={3} />
      ) : error ? (
        <PanelStatus tone="error" action={onRetry ? { label: BUTTONS.retry, onClick: onRetry } : undefined}>
          {ERROR.load}
        </PanelStatus>
      ) : !available || sorted.length === 0 ? (
        <PanelStatus>{EMPTY.funnel}</PanelStatus>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                {HEADERS.map((header) => (
                  <th key={header.key} className={cn("pb-1 pr-2 font-mono text-micro uppercase tracking-wider text-text-3", header.align === "right" ? "text-right" : "text-left")}>
                    {FUNNEL_COLUMNS[header.key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, index) => (
                <tr key={`${row.campaign_name}-${row.ad_group_name}-${row.keyword}-${index}`} className="border-b border-border-subtle">
                  <td className="py-1 pr-2">
                    <p className="font-mohave text-body-sm text-text">{row.keyword ?? "—"}</p>
                    <p className="font-mono text-micro text-text-3">
                      {[row.campaign_name, row.ad_group_name].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td className="py-1 pr-2 text-right font-mono text-data-sm tabular-nums text-text-2">{integer(row.clicks)}</td>
                  <td className="py-1 pr-2 text-right font-mono text-data-sm tabular-nums text-text">{count(row.trials)}</td>
                  <td className="py-1 pr-2 text-right font-mono text-data-sm tabular-nums text-text-2">{count(row.activated)}</td>
                  <td className="py-1 pr-2 text-right font-mono text-data-sm tabular-nums text-text">{count(row.paid)}</td>
                  <td className="py-1 pr-2 text-right font-mono text-data-sm tabular-nums text-text-2">{money(row.spend)}</td>
                  <td className="py-1 pr-2 text-right font-mono text-data-sm tabular-nums text-text-2">{money(row.cost_per_trial)}</td>
                  <td className="py-1 text-right font-mono text-data-sm tabular-nums text-text-2">{money(row.cost_per_paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
