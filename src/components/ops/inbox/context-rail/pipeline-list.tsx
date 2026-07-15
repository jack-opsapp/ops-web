"use client";

/**
 * PipelineList — faithful to `reference/v4-context-tabs.jsx :: PipelineList`.
 *
 * Stages render in canonical order (Lead → Discovery → RFQ in → Quoted),
 * any other stages append in alphabetical order. Each stage shows the
 * stage label on the left and the count on the right.
 *
 * Linked-to-current-thread opps surface a quiet "[THIS THREAD]" metadata cue.
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

export type PipelinePriority = "low" | "medium" | "high";

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
  priority?: PipelinePriority | null;
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

const STAGE_ORDER = [
  "lead",
  "new_lead",
  "discovery",
  "qualifying",
  "rfq in",
  "rfq_in",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
  "won",
] as const;

const TNUM_ZERO = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

type TFn = (key: string, fallback: string) => string;

const formatCurrency = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

function compareStages(a: string, b: string): number {
  const ai = STAGE_ORDER.indexOf(
    normalizeStage(a) as (typeof STAGE_ORDER)[number]
  );
  const bi = STAGE_ORDER.indexOf(
    normalizeStage(b) as (typeof STAGE_ORDER)[number]
  );
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

function normalizeStage(stage: string): string {
  return stage.trim().toLowerCase();
}

function formatLooseLabel(value: string): string {
  return value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toUpperCase();
}

function formatStageLabel(stage: string): string {
  const normalized = normalizeStage(stage);
  const labels: Record<string, string> = {
    lead: "LEAD",
    new_lead: "LEAD",
    discovery: "DISCOVERY",
    qualifying: "QUALIFYING",
    "rfq in": "RFQ IN",
    rfq_in: "RFQ IN",
    quoting: "QUOTING",
    quoted: "QUOTED",
    follow_up: "FOLLOW UP",
    negotiation: "NEGOTIATION",
    won: "WON",
  };
  return labels[normalized] ?? formatLooseLabel(stage);
}

function formatSourceLabel(source: string): string {
  const normalized = source.trim().toLowerCase();
  const labels: Record<string, string> = {
    referral: "REFERRAL",
    website: "WEBSITE",
    email: "EMAIL",
    phone: "PHONE",
    walk_in: "WALK-IN",
    "walk in": "WALK-IN",
    social_media: "SOCIAL",
    "social media": "SOCIAL",
    repeat_client: "REPEAT CLIENT",
    "repeat client": "REPEAT CLIENT",
    voice_log: "VOICE LOG",
    "voice log": "VOICE LOG",
    other: "OTHER",
  };
  return labels[normalized] ?? formatLooseLabel(source);
}

function formatPriorityLabel(priority: PipelinePriority, t: TFn): string {
  const labels: Record<PipelinePriority, string> = {
    high: t("pipeline.priority.high", "HIGH"),
    medium: t("pipeline.priority.medium", "MED"),
    low: t("pipeline.priority.low", "LOW"),
  };
  return labels[priority];
}

function priorityTone(priority: PipelinePriority | null | undefined): string {
  switch (priority) {
    case "high":
      return "text-tan";
    case "medium":
      return "text-text-2";
    case "low":
      return "text-text-3";
    default:
      return "text-text-3";
  }
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
                {formatStageLabel(stage)}
              </h4>
              <span
                className="font-mono text-[11px] tracking-[0.18em] text-text-mute"
                style={TNUM_ZERO}
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
        className="inline-flex h-5 items-center justify-center gap-1.5 rounded border border-dashed border-line bg-transparent px-2 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-3 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-line-hi hover:text-text-2"
      >
        <Plus aria-hidden className="h-3 w-3" strokeWidth={1.5} />
        {t("pipeline.newOpportunity", "NEW OPPORTUNITY")}
      </button>
    </div>
  );
}

export interface PipelineOppCardProps {
  opp: PipelineOpp;
  /** When set, renders the quiet linked-thread metadata cue if opp.threadId
   *  matches. Pass an empty string to disable the linked treatment. */
  currentThreadId: string;
  /** "won" dims the row and renders an inline WON state tag.
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
    t("pipeline.untitledOpportunity", "[UNTITLED OPPORTUNITY]")
  );
  const stageLabel = formatStageLabel(opp.stage);
  const sourceLabel = opp.source ? formatSourceLabel(opp.source) : null;
  const priorityLabel = opp.priority
    ? formatPriorityLabel(opp.priority, t)
    : null;
  const valueLabel = opp.value != null ? formatCurrency(opp.value) : "—";

  return (
    <li
      data-testid={`pipeline-opp-${opp.id}`}
      data-current={isLinked ? "true" : "false"}
      data-variant={variant}
      className={cn(
        "rounded-chip border px-2.5 py-1.5",
        isWon ? "border-line/60 bg-transparent" : "border-line bg-transparent",
        isLinked && "border-line-hi bg-transparent"
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <div className="min-w-0">
          <span
            data-testid={`pipeline-opp-title-${opp.id}`}
            className={cn(
              "block min-w-0 truncate font-mohave text-[12px] font-medium leading-[1.08]",
              isWon ? "text-text-3" : "text-text"
            )}
          >
            {displayTitle}
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-3">
            {isLinked && (
              <span
                data-testid={`pipeline-opp-linked-${opp.id}`}
                className="inline-flex items-center gap-1 text-text-2"
              >
                <LinkIcon aria-hidden className="h-3 w-3" strokeWidth={1.5} />
                {t("pipeline.thisThread", "[THIS THREAD]")}
              </span>
            )}
            <span
              data-testid={`pipeline-opp-stage-${opp.id}`}
              className={isWon ? "text-text-mute" : "text-text-3"}
            >
              {isWon ? t("pipeline.wonTag", "WON") : stageLabel}
            </span>
            {priorityLabel && (
              <span
                data-testid={`pipeline-opp-priority-${opp.id}`}
                className={cn(
                  isWon ? "text-text-mute" : priorityTone(opp.priority)
                )}
              >
                {priorityLabel}
              </span>
            )}
            {sourceLabel && (
              <span
                data-testid={`pipeline-opp-source-${opp.id}`}
                className={isWon ? "text-text-mute" : "text-text-3"}
              >
                {sourceLabel}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span
            data-testid={`pipeline-opp-value-${opp.id}`}
            className={cn(
              "font-mono text-[12px] tabular-nums leading-none",
              isWon ? "text-text-3" : "text-text-2"
            )}
            style={TNUM_ZERO}
          >
            {valueLabel}
          </span>
          {opp.estimateRef && (
            <span
              className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-mute"
              style={TNUM_ZERO}
            >
              {opp.estimateRef}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
