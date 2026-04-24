"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { useDictionary } from "@/i18n/client";
import { useCalibrationDeck } from "./hooks/use-calibration-deck";
import { SectionBreadcrumb } from "./section-breadcrumb";
import { CorpusMobileFallback } from "./corpus-mobile-fallback";

// GalaxyScene wraps Three.js (~150KB) — must stay lazy-loaded.
const GalaxyScene = dynamic(
  () =>
    import("@/components/intel/galaxy-scene").then((m) => m.GalaxyScene),
  { ssr: false }
);

export function SectionCorpus() {
  const { t } = useDictionary("calibration");
  const { data: deck } = useCalibrationDeck();
  const [isMobile, setIsMobile] = useState(false);
  const [showFactsList, setShowFactsList] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (!deck) return null;

  const hasCorpus = deck.corpus.factCount > 0;

  if (!hasCorpus) {
    return (
      <div className="px-11 py-9 max-w-[1080px] mx-auto">
        <SectionBreadcrumb currentSection="corpus" />
        <div className="glass-surface rounded-panel p-12 flex flex-col items-center gap-4 text-center">
          <h3 className="font-cakemono font-light uppercase text-[22px] text-text">
            {t("sections.corpus.empty.heading")}
          </h3>
          <p className="font-mohave text-body-sm text-text-2 max-w-[420px]">
            {t("sections.corpus.empty.body")}
          </p>
          <a
            href="/calibration?section=inputs"
            className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors"
          >
            {t("sections.corpus.empty.cta")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="px-11 py-9 max-w-[1320px] mx-auto">
      <SectionBreadcrumb currentSection="corpus" />
      <div className="flex items-baseline justify-between mb-6">
        <h2 className="font-cakemono font-light uppercase text-[22px] text-text">
          <span className="text-text-mute mr-2">//</span>CORPUS
        </h2>
        <span className="font-mono text-data-sm text-text-2 tabular-nums">
          {t("sections.corpus.header")
            .replace("{facts}", deck.corpus.factCount.toLocaleString())
            .replace("{entities}", deck.corpus.entityCount.toLocaleString())}
        </span>
      </div>

      {isMobile && !showFactsList ? (
        <div className="glass-surface rounded-panel">
          <CorpusMobileFallback onViewFacts={() => setShowFactsList(true)} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr_320px] md:grid-cols-[1fr]">
          {/* FACTS drawer — scrollable list of extracted facts. */}
          <div className="glass-surface rounded-panel p-4 h-[600px] overflow-y-auto scrollbar-hide">
            <div className="font-mono text-micro uppercase tracking-wider text-text-3 mb-3">
              <span className="text-text-mute mr-[6px]">//</span>
              {t("sections.corpus.drawers.facts").slice(3).trim()}
            </div>
            <p className="font-mohave text-body-sm text-text-2">
              {deck.corpus.factCount.toLocaleString()} facts indexed.
            </p>
            <p className="font-mono text-micro uppercase tracking-wider text-text-mute mt-4">
              TODAY: {deck.corpus.todayFactCount}
            </p>
          </div>

          {/* Graph — lazy-loaded GalaxyScene. */}
          <div className="glass-surface rounded-panel h-[600px] overflow-hidden relative">
            <Suspense
              fallback={
                <div className="w-full h-full flex items-center justify-center">
                  <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
                    SYS :: LOADING GRAPH
                  </span>
                </div>
              }
            >
              <GalaxyScene />
            </Suspense>
          </div>

          {/* ENTITY drawer — selection detail. */}
          <div className="glass-surface rounded-panel p-4 h-[600px]">
            <div className="font-mono text-micro uppercase tracking-wider text-text-3 mb-3">
              <span className="text-text-mute mr-[6px]">//</span>
              {t("sections.corpus.drawers.entity").slice(3).trim()}
            </div>
            <p className="font-mono text-micro uppercase tracking-wider text-text-mute">
              {t("sections.corpus.entity.empty")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
