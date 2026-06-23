"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import type { ImportPayload, ImportResult } from "@/lib/types/email-import";

type ActivationWarning = { step: string; message: string };

const EASE = [0.22, 1, 0.36, 1] as const;
const staggerContainer = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const staggerItem = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } } };

const INTERVAL_OPTIONS = [
  { value: 15, labelKey: "activate.interval.15" },
  { value: 60, labelKey: "activate.interval.60" },
  { value: 120, labelKey: "activate.interval.120" },
  { value: 1440, labelKey: "activate.interval.1440" },
  { value: 0, labelKey: "activate.interval.0" },
];

interface ActivateStepProps {
  connectionId: string;
  companyId: string;
  syncProfile: ImportPayload["syncProfile"];
  importResult: ImportResult;
  onActivate: (interval: number) => Promise<{ warnings?: ActivationWarning[] }>;
  onComplete: () => void;
}

export function ActivateStep({
  importResult,
  onActivate,
  onComplete,
}: ActivateStepProps) {
  const { t } = useDictionary("import-wizard");
  const [selectedInterval, setSelectedInterval] = useState(60);
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);
  const [warnings, setWarnings] = useState<ActivationWarning[]>([]);

  const [activationError, setActivationError] = useState<string | null>(null);

  const handleActivate = useCallback(async () => {
    setActivating(true);
    setActivationError(null);
    try {
      const result = await onActivate(selectedInterval);
      setWarnings(result?.warnings || []);
      setActivated(true);
    } catch (err) {
      console.error("Activation failed:", err);
      setActivationError(err instanceof Error ? err.message : t("activate.failed"));
    } finally {
      setActivating(false);
    }
  }, [selectedInterval, onActivate, t]);

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show">
      {/* Import summary */}
      <motion.div
        variants={staggerItem}
        className="p-4 border border-olive-line bg-olive-soft mb-6 rounded-[4px]"
      >
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle size={16} className="text-olive" />
          <span className="font-mono text-micro tracking-[0.15em] uppercase text-olive">
            {t("activate.importComplete")}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="font-mono text-[22px] font-semibold text-text tabular-nums">
              {importResult.leadsCreated}
            </p>
            <p className="font-mohave text-[11px] text-text-3">{t("activate.leadsCreated")}</p>
          </div>
          <div>
            <p className="font-mono text-[22px] font-semibold text-text tabular-nums">
              {importResult.clientsCreated}
            </p>
            <p className="font-mohave text-[11px] text-text-3">{t("activate.newClients")}</p>
          </div>
          {(importResult.imagesExtracted ?? 0) > 0 && (
            <div>
              <p className="font-mono text-[22px] font-semibold text-text tabular-nums">
                {importResult.imagesExtracted}
              </p>
              <p className="font-mohave text-[11px] text-text-3">{t("activate.photosExtracted")}</p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Label info */}
      <motion.div variants={staggerItem} className="mb-4">
        <p className="font-mohave text-[14px] text-text mb-1">
          {(() => {
            const [before, after] = t("confirmPipeline.labeledNotice").split("{label}");
            return (
              <>
                {before}
                <span className="text-text font-medium">OPS Pipeline</span>
                {after}
              </>
            );
          })()}
        </p>
      </motion.div>

      {/* How ongoing sync works */}
      <motion.div
        variants={staggerItem}
        className="mb-6 p-3 border border-border bg-white/[0.02] rounded-[5px]"
      >
        <p className="font-mono text-micro tracking-[0.15em] uppercase text-text-3 mb-2">
          {t("confirmPipeline.captureTitle")}
        </p>
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="font-mono text-[12px] text-text-3 mt-0.5 flex-shrink-0 tabular-nums">1.</span>
            <p className="font-mohave text-[12px] text-text-2">
              <span className="text-text">{t("confirmPipeline.patternTitle")}</span> — {t("confirmPipeline.patternDesc")}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-mono text-[12px] text-text-3 mt-0.5 flex-shrink-0 tabular-nums">2.</span>
            <p className="font-mohave text-[12px] text-text-2">
              <span className="text-text">{t("confirmPipeline.aiTitle")}</span> — {t("confirmPipeline.aiDesc")}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-mono text-[12px] text-text-3 mt-0.5 flex-shrink-0 tabular-nums">3.</span>
            <p className="font-mohave text-[12px] text-text-2">
              {(() => {
                const [before, after] = t("confirmPipeline.manualDesc").split("{label}");
                return (
                  <>
                    <span className="text-text">{t("confirmPipeline.manualTitle")}</span> — {before}
                    <span className="text-text">OPS Pipeline</span>
                    {after}
                  </>
                );
              })()}
            </p>
          </div>
        </div>
        <p className="font-mohave text-[11px] text-text-mute mt-2">
          {t("confirmPipeline.captureNote")}
        </p>
      </motion.div>

      {/* Sync frequency */}
      {!activated && (
        <motion.div variants={staggerItem} className="mb-6">
          <p className="font-mono text-micro tracking-[0.15em] uppercase text-text-3 mb-3">
            {t("activate.syncFrequency")}
          </p>
          <div className="flex gap-2 flex-wrap">
            {INTERVAL_OPTIONS.map((opt) => {
              const active = selectedInterval === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setSelectedInterval(opt.value)}
                  className={
                    "px-3 py-1.5 border rounded-[4px] transition-all font-mohave text-[12px] " +
                    (active
                      ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                      : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2")
                  }
                >
                  {t(opt.labelKey)}
                </button>
              );
            })}
          </div>
          <p className="font-mohave text-[11px] text-text-3 mt-2">
            {t("activate.syncNote")}
          </p>
        </motion.div>
      )}

      {/* Activation error */}
      {activationError && (
        <motion.div
          variants={staggerItem}
          className="mb-4 p-3 border border-brick-line bg-rose-soft rounded-[5px]"
        >
          <p className="font-mohave text-[13px] text-rose">{activationError}</p>
        </motion.div>
      )}

      {/* Partial-success warnings — rendered only after activation so the user
          sees what did/didn't complete. Typically: webhook setup failed but
          the connection is live and scheduled sync is running. */}
      {activated && warnings.length > 0 && (
        <motion.div
          variants={staggerItem}
          className="mb-4 p-3 border border-tan-line bg-tan-soft rounded-[5px]"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-tan" />
            <span className="font-mono text-micro tracking-[0.15em] uppercase text-tan">
              {t("activate.partialActivation")}
            </span>
          </div>
          <div className="space-y-1 mb-2">
            {warnings.map((w, i) => (
              <p key={i} className="font-mohave text-[13px] text-text-2">
                <span className="text-tan font-medium">{w.step}:</span>{" "}
                {w.message}
              </p>
            ))}
          </div>
          <p className="font-mohave text-[11px] text-text-3">
            {t("activate.partialNote")}
          </p>
        </motion.div>
      )}

      {/* Activate / Done */}
      <motion.div variants={staggerItem}>
        {activated ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-olive" />
              <span className="font-mohave text-[13px] text-olive">
                {t("activate.syncActive")}
              </span>
            </div>
            <Button onClick={onComplete} variant="primary" size="default">
              {t("activate.done")}
            </Button>
          </div>
        ) : (
          <Button
            onClick={handleActivate}
            disabled={activating}
            loading={activating}
            variant="primary"
            size="default"
            className="w-full"
          >
            {activating ? t("activate.activating") : t("activate.cta")}
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}
