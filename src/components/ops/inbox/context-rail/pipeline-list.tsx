"use client";

import { LinkIcon, Plus } from "lucide-react";
import { useMemo } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface PipelineOpp {
  id: string;
  title: string;
  value: number;
  stage: string;
  estimateRef: string | null;
  /** 0–1 model confidence. Rendered as a rounded percentage. */
  confidence: number;
  source: string;
  /** Thread id this opp was extracted from. Null when unattributed. */
  threadId: string | null;
}

interface PipelineListProps {
  opps: PipelineOpp[];
  /** Current thread id. Opps with threadId === this surface a "This thread"
   *  indicator and an accent left bar. */
  threadId: string;
  onNewOpportunity: () => void;
  className?: string;
}

const PRIMARY_ORDER = ["Lead", "Discovery", "RFQ in", "Quoted"] as const;

const formatCurrency = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

function compareStages(a: string, b: string): number {
  const ai = PRIMARY_ORDER.indexOf(a as (typeof PRIMARY_ORDER)[number]);
  const bi = PRIMARY_ORDER.indexOf(b as (typeof PRIMARY_ORDER)[number]);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

export function PipelineList({
  opps,
  threadId,
  onNewOpportunity,
  className,
}: PipelineListProps) {
  const { t } = useDictionary("inbox");
  const grouped = useMemo(() => {
    const map = new Map<string, PipelineOpp[]>();
    for (const opp of opps) {
      const existing = map.get(opp.stage) ?? [];
      existing.push(opp);
      map.set(opp.stage, existing);
    }
    return Array.from(map.entries()).sort((a, b) => compareStages(a[0], b[0]));
  }, [opps]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {grouped.length === 0 ? (
        <p className="font-mohave text-[12px] text-text-3">
          {t("pipeline.empty", "no open opportunities")}
        </p>
      ) : (
        grouped.map(([stage, list]) => (
          <section key={stage} className="flex flex-col gap-1.5">
            <h4 className="font-cakemono text-[9.5px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
              {stage}
            </h4>
            <ul className="flex flex-col gap-1.5">
              {list.map((opp) => {
                const isCurrent = opp.threadId === threadId;
                return (
                  <li
                    key={opp.id}
                    data-testid={`pipeline-opp-${opp.id}`}
                    data-current={isCurrent ? "true" : "false"}
                    className={cn(
                      "rounded-sidebar border border-line bg-inbox-panel px-2.5 py-2",
                      isCurrent && "shadow-[inset_2px_0_0_rgb(var(--ops-accent-rgb))]",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mohave text-[12px] text-text">
                        {opp.title}
                      </span>
                      <span
                        className="font-mono text-[11px] tabular-nums text-text-2"
                        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                      >
                        {formatCurrency(opp.value)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
                      {opp.estimateRef && <span>{opp.estimateRef}</span>}
                      <span
                        className="tabular-nums"
                        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                      >
                        {Math.round(opp.confidence * 100)}%
                      </span>
                      <span>{opp.source}</span>
                      {isCurrent && (
                        <span className="ml-auto inline-flex items-center gap-1 text-ops-accent">
                          <LinkIcon
                            aria-hidden
                            className="h-2.5 w-2.5"
                            strokeWidth={1.75}
                          />
                          {t("pipeline.thisThread", "This thread")}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <button
        type="button"
        onClick={onNewOpportunity}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-dashed border-line bg-transparent px-3 font-cakemono text-[10px] font-light uppercase tracking-[0.14em] text-text-3 hover:border-border-medium hover:text-text-2"
      >
        <Plus aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        {t("pipeline.newOpportunity", "New opportunity")}
      </button>
    </div>
  );
}
