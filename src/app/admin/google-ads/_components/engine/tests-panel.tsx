"use client";

/**
 * Ad tests: control against challenger, CTR as two neutral bars, days in,
 * OPS's verdict as the only colour. Running tests first, recent verdicts after.
 */
import { motion, useReducedMotion } from "framer-motion";
import { Tag } from "@/components/ui/tag";
import type { TestRow } from "@/lib/hooks/use-ads-engine";
import type { TestState } from "@/lib/ads/engine/types";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { EMPTY, ERROR, LABELS, TEST_STATE_TAGS, TESTS, BUTTONS } from "./copy";
import { integer, percent, shortDate } from "./format";
import { PanelLabel, PanelSkeleton, PanelStatus } from "./panel";

export interface TestsPanelProps {
  tests: TestRow[] | undefined;
  isPending: boolean;
  error: Error | null;
  onRetry?: () => void;
}

const VERDICT_VARIANT: Record<TestState, "olive" | "rose" | "tan" | "neutral" | "dim"> = {
  running: "dim",
  control_won: "neutral",
  challenger_won: "olive",
  no_verdict: "dim",
  cancelled: "dim",
};

interface Arm {
  impressions: number;
  clicks: number;
  ctr: number;
  trials: number;
}

function armsOf(test: TestRow): { control: Arm; challenger: Arm; days: number | null; p: number | null } {
  const stats = (test.stats ?? {}) as { control?: Partial<Arm>; challenger?: Partial<Arm>; days?: number; p?: number };
  const arm = (value: Partial<Arm> | undefined): Arm => ({
    impressions: value?.impressions ?? 0,
    clicks: value?.clicks ?? 0,
    ctr: value?.ctr ?? 0,
    trials: value?.trials ?? 0,
  });
  return { control: arm(stats.control), challenger: arm(stats.challenger), days: typeof stats.days === "number" ? stats.days : null, p: typeof stats.p === "number" ? stats.p : null };
}

function ArmRow({ label, arm, max, headline, reduced }: { label: string; arm: Arm; max: number; headline: string | null; reduced: boolean }) {
  const width = max > 0 ? Math.max(2, Math.round((arm.ctr / max) * 100)) : 0;
  return (
    <div className="grid grid-cols-[88px_1fr_auto] items-center gap-1">
      <div className="min-w-0">
        <p className="font-mono text-micro uppercase tracking-wider text-text-3">{label}</p>
        {headline && <p className="truncate font-mohave text-body-sm text-text-2">{headline}</p>}
      </div>
      <div className="h-1 overflow-hidden rounded-bar bg-fill-neutral-dim" aria-hidden>
        <motion.div
          className="h-full rounded-bar bg-fill-neutral"
          initial={reduced ? { width: `${width}%` } : { width: 0 }}
          animate={{ width: `${width}%` }}
          transition={reduced ? { duration: 0 } : { duration: 0.5, ease: EASE_SMOOTH }}
        />
      </div>
      <p className="whitespace-nowrap font-mono text-micro tabular-nums text-text-2">
        <span className="text-text">{percent(arm.ctr, 2)}</span> {TESTS.ctr} · {integer(arm.impressions)} {TESTS.impressions} · {integer(arm.clicks)} {TESTS.clicks} · {integer(arm.trials)} {TESTS.trials}
      </p>
    </div>
  );
}

export function TestsPanel({ tests, isPending, error, onRetry }: TestsPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const ordered = [...(tests ?? [])].sort((a, b) => (a.state === "running" ? -1 : 0) - (b.state === "running" ? -1 : 0) || b.started_at.localeCompare(a.started_at));
  return (
    <section aria-labelledby="engine-tests-label">
      <PanelLabel id="engine-tests-label" count={ordered.filter((t) => t.state === "running").length || undefined}>
        {LABELS.tests}
      </PanelLabel>
      {isPending ? (
        <PanelSkeleton rows={2} />
      ) : error ? (
        <PanelStatus tone="error" action={onRetry ? { label: BUTTONS.retry, onClick: onRetry } : undefined}>
          {ERROR.load}
        </PanelStatus>
      ) : ordered.length === 0 ? (
        <PanelStatus>{EMPTY.tests}</PanelStatus>
      ) : (
        <ul className="mt-1 space-y-1">
          {ordered.map((test) => {
            const { control, challenger, days, p } = armsOf(test);
            const max = Math.max(control.ctr, challenger.ctr);
            const variant = VERDICT_VARIANT[test.state];
            return (
              <li key={test.id} className="glass-surface rounded-panel p-2" data-testid="test-row" data-state={test.state}>
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div className="flex items-center gap-1">
                    <h3 className="font-mohave text-body text-text">{test.ad_group_name ?? test.ad_group_id}</h3>
                    <Tag variant={variant}>{TEST_STATE_TAGS[test.state]}</Tag>
                  </div>
                  <p className="font-mono text-micro tabular-nums text-text-3">
                    {days !== null ? TESTS.day(days, test.min_days) : shortDate(test.started_at)}
                    {p !== null && ` · p ${p.toFixed(3)}`}
                  </p>
                </div>
                <div className="mt-1 space-y-1">
                  <ArmRow label={TESTS.control} arm={control} max={max} headline={test.control?.headlines[0] ?? null} reduced={reduced} />
                  <ArmRow label={TESTS.challenger} arm={challenger} max={max} headline={test.challenger?.headlines[0] ?? null} reduced={reduced} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
