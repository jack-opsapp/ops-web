"use client";

/**
 * PipelineList — faithful to `reference/v4-context-tabs.jsx :: PipelineList`.
 *
 * Stages render in canonical order (Lead → Discovery → RFQ in → Quoted),
 * any other stages append in alphabetical order. Each stage shows the
 * stage label on the left and the count on the right.
 *
 * Linked-to-current-thread opps get an inset 2px accent left bar AND
 * surface a "↗ This thread" tag at the start of the meta row.
 *
 * The card primitive is exported as `PipelineOppCard` so the WORK tab's
 * WON sub-section can reuse it with `variant="won"` for muted, tagged
 * closed-business rows.
 */

import { Link as LinkIcon, Plus } from "lucide-react";
import { useMemo } from "react";
import { useDictionary } from "@/i18n/client";
import { pipelineOppDisplayTitle } from "@/lib/inbox/opp-display";
import { cn } from "@/lib/utils/cn";
import { StateTag } from "../state-tag";

export type PipelineConfidence = "low" | "warm" | "high";

export interface PipelineOpp {
  id: string;
  title: string;
  /** Long-form description used as a fallback when `title` is empty
   *  (email-sourced opps frequently land with no subject). */
  description?: string | null;
  /** Null when the opportunity has no associated value yet. */
  value: number | null;
  stage: string;
  estimateRef?: string | null;
  confidence?: PipelineConfidence | null;
  source?: string | null;
  /** Thread id this opp was extracted from. Null when unattributed. */
  threadId?: string | null;
}

interface PipelineListProps {
  opps: PipelineOpp[];
  /** Current thread id. Opps with threadId === this surface a "This thread"
   *  indicator and an accent left bar. */
  threadId: string;
  onNewOpportunity: () => void;
  className?: string;
  /** When true, the "no open opportunities" empty message is hidden — the
   *  +New opportunity button still renders. Used by the WORK tab when a
   *  client has 0 open leads but ≥1 won deal: rendering both the empty
   *  message AND a populated WON section would contradict itself. */
  suppressEmpty?: boolean;
}

const PRIMARY_ORDER = ["Lead", "Discovery", "RFQ in", "Quoted"] as const;

const formatCurrency = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

function compareStages(a: string, b: string): number {
  const ai = PRIMARY_ORDER.indexOf(a as (typeof PRIMARY_ORDER)[number]);
  const bi = PRIMARY_ORDER.indexOf(b as (typeof PRIMARY_ORDER)[number]);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function PipelineList({
  opps,
  threadId,
  onNewOpportunity,
  className,
  suppressEmpty,
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
        suppressEmpty ? null : (
          <p className="font-mohave text-[12px] text-text-3">
            {t("pipeline.empty", "no open opportunities")}
          </p>
        )
      ) : (
        grouped.map(([stage, list]) => (
          <section key={stage}>
            <div className="flex items-baseline justify-between px-0.5 pb-1.5">
              <h4 className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
                {stage}
              </h4>
              <span
                className="font-mono text-[11px] tracking-[0.18em] text-text-mute"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {list.length}
              </span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {list.map((opp) => (
                <PipelineOppCard
                  key={opp.id}
                  opp={opp}
                  currentThreadId={threadId}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <button
        type="button"
        onClick={onNewOpportunity}
        className="inline-flex h-6 items-center justify-center gap-1.5 rounded-[2.5px] border border-dashed border-line bg-transparent px-2.5 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-3 hover:border-line-hi hover:text-text-2"
      >
        <Plus aria-hidden className="h-3 w-3" strokeWidth={1.5} />
        {t("pipeline.newOpportunity", "NEW OPPORTUNITY")}
      </button>
    </div>
  );
}

export interface PipelineOppCardProps {
  opp: PipelineOpp;
  /** When set, paints the accent left-bar + "This thread" tag if opp.threadId
   *  matches. Pass an empty string to disable the linked treatment. */
  currentThreadId: string;
  /** "won" dims the title to text-2 and renders an inline WON state tag.
   *  Won cards never participate in the linked-to-thread treatment (closed
   *  business is not the "current thread" by definition). */
  variant?: "open" | "won";
}

export function PipelineOppCard({
  opp,
  currentThreadId,
  variant = "open",
}: PipelineOppCardProps) {
  const { t } = useDictionary("inbox");
  const isWon = variant === "won";
  const isLinked = !isWon && opp.threadId === currentThreadId;
  const displayTitle = pipelineOppDisplayTitle(
    opp,
    t("pipeline.untitledOpportunity", "[UNTITLED OPPORTUNITY]"),
  );
  return (
    <li
      data-testid={`pipeline-opp-${opp.id}`}
      data-current={isLinked ? "true" : "false"}
      data-variant={variant}
      className={cn(
        "rounded-[5px] border bg-inbox-panel px-3 py-2.5",
        isLinked
          ? "border-line-hi shadow-[inset_2px_0_0_rgb(var(--ops-accent-rgb))]"
          : "border-line",
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mohave text-[12px] leading-tight",
            isWon ? "text-text-2" : "text-text",
          )}
        >
          {displayTitle}
        </span>
        {isWon && (
          <StateTag
            tone="olive"
            variant="solid"
            prefix={t("pipeline.wonTag", "WON")}
          />
        )}
        {opp.value != null && (
          <span
            className="shrink-0 font-mono text-[11px] tabular-nums text-text-2"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {formatCurrency(opp.value)}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] tracking-[0.18em] text-text-3">
        {isLinked && (
          <span className="inline-flex items-center gap-1 text-ops-accent">
            <LinkIcon aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("pipeline.thisThread", "This thread")}
          </span>
        )}
        {opp.estimateRef && (
          <span style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}>
            {opp.estimateRef}
          </span>
        )}
        {opp.confidence && (
          <span className="normal-case tracking-normal">
            {capitalize(opp.confidence)}
          </span>
        )}
        {opp.source && (
          <span className="text-text-mute normal-case tracking-normal">
            · {opp.source}
          </span>
        )}
      </div>
    </li>
  );
}
