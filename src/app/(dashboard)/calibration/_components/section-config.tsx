"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDictionary } from "@/i18n/client";
import { useCalibrationDeck } from "./hooks/use-calibration-deck";
import { SectionBreadcrumb } from "./section-breadcrumb";
import { CommsConfigOverlay } from "./comms-config-overlay";
import { ArrowRight } from "lucide-react";

const ORDER = ["auto_send", "auto_draft", "draft", "off"] as const;
const COLOR: Record<(typeof ORDER)[number], string> = {
  auto_send: "#9DB582",
  auto_draft: "#B5B5B5",
  draft: "#8A8A8A",
  off: "#6A6A6A",
};

function levelLabelKey(level: (typeof ORDER)[number]) {
  if (level === "auto_send") return "auto_send";
  if (level === "auto_draft") return "auto_draft";
  return level;
}

export function SectionConfig() {
  const { t } = useDictionary("calibration");
  const { data: deck } = useCalibrationDeck();
  const searchParams = useSearchParams();
  const [wizardOpen, setWizardOpen] = useState(false);

  // Deep-link support: ?wizard=open (hit from the /agent/comms-config redirect).
  useEffect(() => {
    if (searchParams.get("wizard") === "open") setWizardOpen(true);
  }, [searchParams]);

  if (!deck) return null;

  const total =
    Object.values(deck.config.emailTypeCounts).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="px-11 py-9 max-w-[1080px] mx-auto">
      <SectionBreadcrumb currentSection="config" />
      <h2 className="font-cakemono font-light uppercase text-[22px] text-text mb-6">
        <span className="text-text-mute mr-2">{"//"}</span>CONFIG
      </h2>

      {/* AUTONOMY panel — summary + RE-RUN WIZARD */}
      <div className="glass-surface rounded-panel p-6 mb-4">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-cakemono font-light uppercase text-[20px] text-text">
            {t("sections.config.autonomy.title")}
          </h3>
          <button
            onClick={() => setWizardOpen(true)}
            className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors"
          >
            {t("sections.config.autonomy.reRunWizard")}
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {ORDER.map((level) => {
            const count = deck.config.emailTypeCounts[level];
            const pct = (count / total) * 100;
            return (
              <div key={level} className="flex items-center gap-3">
                <span
                  className="font-mono text-micro uppercase tracking-wider text-text-3 shrink-0"
                  style={{ width: 120 }}
                >
                  {t(`sections.config.autonomyLevels.${levelLabelKey(level)}`)}
                </span>
                <div
                  className="relative rounded-bar bg-[rgba(255,255,255,0.06)] flex-1"
                  style={{ height: 6 }}
                >
                  <div
                    className="rounded-bar h-full transition-[width] duration-500 ease-out"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: COLOR[level],
                    }}
                  />
                </div>
                <span
                  className="font-mono text-data-sm tabular-nums shrink-0"
                  style={{ color: COLOR[level], minWidth: 40, textAlign: "right" }}
                >
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* FILTERS panel */}
      <div className="glass-surface rounded-panel p-6 mb-4">
        <div className="flex items-baseline justify-between">
          <h3 className="font-cakemono font-light uppercase text-[20px] text-text">
            {t("sections.config.filters.title")}
          </h3>
        </div>
        <p className="mt-2 font-mono text-micro uppercase tracking-wider text-text-2">
          {t("sections.config.filters.summary")
            .replace("{rules}", String(deck.config.rulesCount))
            .replace("{excl}", "0")}
        </p>
      </div>

      {/* CATEGORIES panel */}
      <div className="glass-surface rounded-panel p-6 mb-4">
        <h3 className="font-cakemono font-light uppercase text-[20px] text-text">
          {t("sections.config.categories.title")}
        </h3>
        <p className="mt-2 font-mono text-micro uppercase tracking-wider text-text-2">
          {deck.config.categoriesCount} CATEGORIES TRACKED
        </p>
      </div>

      {/* EXTERNAL links — per V6, only TASK TYPES. Duplicate Detection dropped. */}
      <div className="mt-6">
        <h4 className="font-mono text-micro uppercase tracking-wider text-text-mute mb-3">
          <span className="mr-[6px]">{"//"}</span>
          {t("sections.config.external.heading")}
        </h4>
        <a
          href="/settings?tab=task-types"
          className="inline-flex items-center gap-2 font-mono text-micro uppercase tracking-wider text-text-2 hover:text-text transition-colors"
        >
          {t("sections.config.external.taskTypes").replace("→", "").trim()}
          <ArrowRight className="w-3 h-3" />
        </a>
      </div>

      <CommsConfigOverlay open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
