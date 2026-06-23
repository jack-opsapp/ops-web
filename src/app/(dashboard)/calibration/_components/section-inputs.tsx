"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { useCalibrationDeck } from "./hooks/use-calibration-deck";
import { SectionBreadcrumb } from "./section-breadcrumb";
import { ReRunConfirmPopover } from "./re-run-confirm-popover";
import { AiIntakeInterview } from "@/components/settings/ai-intake-interview";
import { AiDatabaseMining } from "@/components/settings/ai-database-mining";
import { EmailScanRunner } from "./email-scan-runner";
import type {
  InputState,
  InputSource,
  InputStatus,
} from "@/lib/types/calibration";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import { cn } from "@/lib/utils/cn";

const STATUS_COLOR: Record<InputStatus, string> = {
  complete: "#9DB582",
  running: "#C4A868",
  failed: "#B58289",
  not_run: "#6A6A6A",
  skipped: "#6A6A6A",
};

const SOURCE_TITLE: Record<InputSource, string> = {
  interview: "INTERVIEW",
  scan: "EMAIL SCAN",
  mining: "DATABASE MINING",
};

function ctaKey(source: InputSource, status: InputStatus): string {
  if (status === "complete") {
    if (source === "interview") return "reInterview";
    if (source === "scan") return "reScan";
    return "reMine";
  }
  if (status === "failed") return "retry";
  if (status === "running") return "viewProgress";
  if (source === "interview") return "initiateInterview";
  if (source === "scan") return "initiateScan";
  return "initiateMine";
}

function renderStatusLabel(state: InputState, t: (k: string) => string) {
  switch (state.status) {
    case "not_run":
      return t("sections.inputs.statusLabels.notRun");
    case "running":
      return t("sections.inputs.statusLabels.running").replace(
        "{percent}",
        String(state.percent)
      );
    case "complete":
      return t("sections.inputs.statusLabels.complete");
    case "failed":
      return t("sections.inputs.statusLabels.failed");
    case "skipped":
      return t("sections.inputs.statusLabels.skipped");
  }
}

interface SubsectionProps {
  source: InputSource;
  state: InputState;
  isExpanded: boolean;
  renderCta: () => React.ReactNode;
  onCollapse: () => void;
  children?: React.ReactNode;
}

function InputsSubsection({
  source,
  state,
  isExpanded,
  renderCta,
  onCollapse,
  children,
}: SubsectionProps) {
  const { t } = useDictionary("calibration");
  return (
    <motion.div
      className="glass-surface rounded-panel overflow-hidden"
      layout
      transition={{ duration: 0.25, ease: CAL_EASE }}
    >
      <div className="flex items-center gap-4 p-6">
        <div className="flex-1 min-w-0">
          <h3 className="font-cakemono font-light uppercase text-[20px] leading-tight text-text">
            {SOURCE_TITLE[source]}
          </h3>
          <div className="mt-1 flex items-center gap-3">
            <span
              className="font-mono text-micro uppercase tracking-wider"
              style={{ color: STATUS_COLOR[state.status] }}
            >
              {renderStatusLabel(state, t)}
            </span>
            {state.lastRunAt && (
              <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
                · LAST RUN {new Date(state.lastRunAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {renderCta()}
          {isExpanded && (
            <button
              onClick={onCollapse}
              className="font-cakemono font-light uppercase text-[14px] px-3 py-2 rounded text-text-mute hover:text-text-2 transition-colors"
            >
              CLOSE
            </button>
          )}
        </div>
      </div>
      {state.status === "running" && state.percent > 0 && (
        <div
          className="h-[3px] mx-6 mb-4 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden"
          aria-hidden="true"
        >
          <motion.div
            className="h-full"
            style={{ backgroundColor: STATUS_COLOR.running }}
            animate={{ width: `${state.percent}%` }}
            transition={{ duration: 0.4, ease: CAL_EASE }}
          />
        </div>
      )}
      <AnimatePresence>
        {isExpanded && children && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: CAL_EASE }}
            className={cn("px-6 pb-6 overflow-hidden")}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function SectionInputs() {
  const { t } = useDictionary("calibration");
  const { data: deck } = useCalibrationDeck();
  const [expandedSource, setExpandedSource] = useState<InputSource | null>(
    null
  );
  const [reRunTarget, setReRunTarget] = useState<InputSource | null>(null);

  if (!deck) return null;

  const renderCta = (src: InputSource, state: InputState) => {
    const actionKey = ctaKey(src, state.status);
    const primary = state.status !== "running";
    return (
      <button
        onClick={() => {
          if (state.status === "complete") setReRunTarget(src);
          else if (state.status !== "running") setExpandedSource(src);
        }}
        className={
          primary
            ? "font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors"
            : "font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded text-text-2 hover:text-text transition-colors"
        }
      >
        {t(`sections.inputs.actions.${actionKey}`)}
      </button>
    );
  };

  const content: Record<InputSource, React.ReactNode> = {
    interview: (
      <AiIntakeInterview onComplete={() => setExpandedSource(null)} />
    ),
    scan: (
      <EmailScanRunner
        onComplete={() => setExpandedSource(null)}
        onSkip={() => setExpandedSource(null)}
      />
    ),
    mining: <AiDatabaseMining onComplete={() => setExpandedSource(null)} />,
  };

  return (
    <div className="px-11 py-9 max-w-[1080px] mx-auto">
      <SectionBreadcrumb currentSection="inputs" />
      <h2 className="font-cakemono font-light uppercase text-[22px] text-text mb-6">
        <span className="text-text-mute mr-2">{"//"}</span>INPUTS
      </h2>
      <div className="flex flex-col gap-4">
        {(["interview", "scan", "mining"] as const).map((src) => (
          <InputsSubsection
            key={src}
            source={src}
            state={deck.inputs[src]}
            isExpanded={expandedSource === src}
            renderCta={() => renderCta(src, deck.inputs[src])}
            onCollapse={() => setExpandedSource(null)}
          >
            {content[src]}
          </InputsSubsection>
        ))}
      </div>
      <hr className="my-6 border-t border-[rgba(255,255,255,0.08)]" />
      <p className="font-mohave text-body-sm text-text-2 max-w-[640px]">
        {t("sections.inputs.accumulation")}
      </p>
      {reRunTarget && (
        <ReRunConfirmPopover
          source={reRunTarget}
          onConfirm={() => {
            const target = reRunTarget;
            setReRunTarget(null);
            setExpandedSource(target);
          }}
          onCancel={() => setReRunTarget(null)}
        />
      )}
    </div>
  );
}
