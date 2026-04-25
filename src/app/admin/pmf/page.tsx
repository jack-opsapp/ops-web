import { Suspense } from "react";
import Link from "next/link";
import { getPmfState, PMF_STATE_TTL_SECONDS } from "@/lib/admin/pmf-queries";
import { MarkerCard } from "@/components/pmf/marker-card";
import { IndicatorCard } from "@/components/pmf/indicator-card";
import { PipelineKanban } from "@/components/pmf/pipeline-kanban";
import { MrrTrendChart } from "@/components/pmf/mrr-trend-chart";
import { CountdownChip } from "@/components/pmf/ui/countdown-chip";
import { PmfButton } from "@/components/pmf/ui/button";
import { SlashHeader } from "@/components/pmf/ui/slash-header";
import type { MarkerKey, IndicatorKey } from "@/lib/pmf/types";

// Next.js statically analyzes `revalidate` and requires a literal initializer.
// The literal-type annotation links this to PMF_STATE_TTL_SECONDS — TypeScript
// fails the build if either drifts, preserving the single-source-of-truth invariant.
export const revalidate: typeof PMF_STATE_TTL_SECONDS = 60;

const MARKER_KEYS: MarkerKey[] = ["marker_1", "marker_2", "marker_3", "marker_4"];
const INDICATOR_KEYS: IndicatorKey[] = [
  "indicator_a",
  "indicator_b",
  "indicator_c",
  "indicator_d",
  "indicator_e",
];

function indicatorSlug(key: IndicatorKey): string {
  return key.replace("indicator_", "");
}

function markerSlug(key: MarkerKey): string {
  return key.replace("marker_", "");
}

export default async function PmfDashboardPage() {
  const state = await getPmfState();

  const greenCount = Object.values(state.markers).filter(
    (m) => m.status === "green",
  ).length;

  return (
    <div className="space-y-8">
      {/* Hero strip */}
      <div className="flex items-center justify-between">
        <h1 className="font-cakemono font-light uppercase text-[22px] tracking-[0.02em] leading-none">
          <span className="text-[color:var(--text-mute)] font-mono mr-2">//</span>
          PMF TRACKING DECK
        </h1>
        <div className="flex items-center gap-4">
          <CountdownChip />
          <Link href="/admin/pmf/prospects/new">
            <PmfButton variant="primary">NEW PROSPECT</PmfButton>
          </Link>
        </div>
      </div>

      {/* Gate B markers */}
      <section className="space-y-4">
        <SlashHeader
          variant="section"
          trailing={
            <span className="font-mono text-[11px] tracking-[0.16em] uppercase text-[color:var(--text-3)]">
              <span className="text-[color:var(--text-3)]">[</span>
              {greenCount}/4 ON TARGET
              <span className="text-[color:var(--text-3)]">]</span>
            </span>
          }
        >
          GATE B · PRIMARY MARKERS
        </SlashHeader>
        <div className="grid grid-cols-4 gap-6">
          {MARKER_KEYS.map((key) => {
            const marker = state.markers[key];
            const isCurrency = key === "marker_4";
            return (
              <Link
                key={key}
                href={`/admin/pmf/marker/${markerSlug(key)}`}
                className="block transition-opacity duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:opacity-90"
              >
                <MarkerCard state={marker} asCurrency={isCurrency} />
              </Link>
            );
          })}
        </div>
      </section>

      {/* Indicators */}
      <section className="space-y-4">
        <SlashHeader variant="section">LEADING INDICATORS</SlashHeader>
        <div className="grid grid-cols-5 gap-4">
          {INDICATOR_KEYS.map((key) => {
            const indicator = state.indicators[key];
            return (
              <Link
                key={key}
                href={`/admin/pmf/indicator/${indicatorSlug(key)}`}
                className="block transition-opacity duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:opacity-90"
              >
                <IndicatorCard state={indicator} />
              </Link>
            );
          })}
        </div>
      </section>

      {/* Pipeline + MRR */}
      <section className="grid grid-cols-5 gap-6">
        <div className="col-span-3">
          {/* Suspense boundary anticipates server-data fetching in Task 19 */}
          <Suspense
            fallback={
              <div className="glass-surface h-[560px] animate-pulse rounded-[10px]" />
            }
          >
            <PipelineKanban />
          </Suspense>
        </div>
        <div className="col-span-2">
          {/* Suspense boundary anticipates server-data fetching in Task 20 */}
          <Suspense
            fallback={
              <div className="glass-surface h-[560px] animate-pulse rounded-[10px]" />
            }
          >
            <MrrTrendChart />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
