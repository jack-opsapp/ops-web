"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { FirstRunStation } from "./first-run-station";
import { useCalibrationFirstRun } from "./hooks/use-calibration-first-run";
import { useCalibrationDeck } from "./hooks/use-calibration-deck";
import { AiIntakeInterview } from "@/components/settings/ai-intake-interview";
import { AiDatabaseMining } from "@/components/settings/ai-database-mining";
import { EmailScanRunner } from "./email-scan-runner";
import { CAL_EASE } from "@/lib/utils/calibration-motion";

type ExpandedSource = "interview" | "scan" | "mining" | null;
type ResolvedSet = Set<"interview" | "scan" | "mining">;

interface Props {
  onDone: () => void;
}

export function FirstRunWizard({ onDone }: Props) {
  const { t } = useDictionary("calibration");
  const { data: deck } = useCalibrationDeck();
  const { dismiss } = useCalibrationFirstRun();

  const [expanded, setExpanded] = useState<ExpandedSource>(null);
  const [localResolved, setLocalResolved] = useState<ResolvedSet>(new Set());

  const resolveAll = useCallback(() => {
    dismiss();
    onDone();
  }, [dismiss, onDone]);

  const resolveStation = useCallback(
    (src: "interview" | "scan" | "mining") => {
      setLocalResolved((prev) => {
        const next = new Set(prev);
        next.add(src);
        setExpanded(null);
        // Show SCOPE COMPLETE for ~900ms before handing control to deck.
        if (next.size === 3) setTimeout(resolveAll, 900);
        return next;
      });
    },
    [resolveAll]
  );

  if (!deck) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          SYS :: LOADING
        </span>
      </div>
    );
  }

  const doneCount =
    (localResolved.has("interview") ||
    deck.inputs.interview.status === "complete"
      ? 1
      : 0) +
    (localResolved.has("scan") || deck.inputs.scan.status === "complete"
      ? 1
      : 0) +
    (localResolved.has("mining") || deck.inputs.mining.status === "complete"
      ? 1
      : 0);

  return (
    <div className="max-w-[720px] mx-auto px-6 py-10 w-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-cakemono font-light uppercase text-[22px] text-text">
          <span className="text-text-mute mr-2">{"//"}</span>
          {t("firstRun.header").replace("// ", "")}
        </h1>
        <span className="font-mono text-micro uppercase tracking-wider text-text-2 tabular-nums">
          {t("firstRun.progress").replace("{done}", String(doneCount))}
        </span>
      </div>

      <p className="font-mohave text-body-sm text-text-2 mb-6 max-w-[560px]">
        {t("firstRun.body")}
      </p>

      <div className="flex flex-col gap-4">
        {(["interview", "scan", "mining"] as const).map((src) => (
          <FirstRunStation
            key={src}
            source={src}
            state={deck.inputs[src]}
            isExpanded={expanded === src}
            onEngage={() => setExpanded(src)}
            onSkip={() => resolveStation(src)}
          >
            {src === "interview" && (
              <AiIntakeInterview
                onComplete={() => resolveStation("interview")}
              />
            )}
            {src === "scan" && (
              <EmailScanRunner
                onComplete={() => resolveStation("scan")}
                onSkip={() => resolveStation("scan")}
              />
            )}
            {src === "mining" && (
              <AiDatabaseMining
                onComplete={() => resolveStation("mining")}
              />
            )}
          </FirstRunStation>
        ))}
      </div>

      <AnimatePresence>
        {doneCount === 3 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: CAL_EASE }}
            className="mt-6 text-center"
          >
            <span
              className="font-mono text-micro uppercase tracking-wider"
              style={{ color: "#9DB582" }}
            >
              {t("firstRun.completeLine")}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
