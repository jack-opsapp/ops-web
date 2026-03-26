"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Check, CheckCircle, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImportPayload, ImportResult } from "@/lib/types/email-import";

const EASE = [0.22, 1, 0.36, 1] as const;
const staggerContainer = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const staggerItem = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } } };

const INTERVAL_OPTIONS = [
  { value: 15, label: "Every 15 min" },
  { value: 60, label: "Every hour" },
  { value: 120, label: "Every 2 hours" },
  { value: 1440, label: "Once daily" },
  { value: 0, label: "Manual only" },
];

interface ActivateStepProps {
  connectionId: string;
  companyId: string;
  syncProfile: ImportPayload["syncProfile"];
  importResult: ImportResult;
  onActivate: (interval: number) => Promise<void>;
  onComplete: () => void;
}

export function ActivateStep({
  importResult,
  onActivate,
  onComplete,
}: ActivateStepProps) {
  const [selectedInterval, setSelectedInterval] = useState(60);
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);

  const [activationError, setActivationError] = useState<string | null>(null);

  const handleActivate = useCallback(async () => {
    setActivating(true);
    setActivationError(null);
    try {
      await onActivate(selectedInterval);
      setActivated(true);
    } catch (err) {
      console.error("Activation failed:", err);
      setActivationError(err instanceof Error ? err.message : "Activation failed. Try again.");
    } finally {
      setActivating(false);
    }
  }, [selectedInterval, onActivate]);

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show">
      {/* Import summary */}
      <motion.div
        variants={staggerItem}
        className="p-4 border border-[#9DB582]/20 bg-[#9DB582]/5 mb-6"
        style={{ borderRadius: 3 }}
      >
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle size={16} className="text-[#9DB582]" />
          <span className="font-kosugi text-[9px] tracking-[0.15em] uppercase text-[#9DB582]">
            Import Complete
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="font-mohave text-[22px] font-semibold text-white">
              {importResult.leadsCreated}
            </p>
            <p className="font-mohave text-[11px] text-[#666]">Leads created</p>
          </div>
          <div>
            <p className="font-mohave text-[22px] font-semibold text-white">
              {importResult.clientsCreated}
            </p>
            <p className="font-mohave text-[11px] text-[#666]">New clients</p>
          </div>
          {(importResult.imagesExtracted ?? 0) > 0 && (
            <div>
              <p className="font-mohave text-[22px] font-semibold text-white">
                {importResult.imagesExtracted}
              </p>
              <p className="font-mohave text-[11px] text-[#666]">Photos extracted</p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Label info */}
      <motion.div variants={staggerItem} className="mb-4">
        <p className="font-mohave text-[14px] text-white mb-1">
          Your imported leads have been labeled as{" "}
          <span className="text-[#597794] font-medium">OPS Pipeline</span>{" "}
          in your inbox.
        </p>
      </motion.div>

      {/* How ongoing sync works */}
      <motion.div
        variants={staggerItem}
        className="mb-6 p-3 border border-white/10 bg-white/[0.02]"
        style={{ borderRadius: 3 }}
      >
        <p className="font-kosugi text-[9px] tracking-[0.15em] uppercase text-[#597794] mb-2">
          How new leads are captured
        </p>
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="font-mohave text-[12px] text-[#597794] mt-0.5 flex-shrink-0">1.</span>
            <p className="font-mohave text-[12px] text-[#999]">
              <span className="text-white">Pattern matching</span> — emails from new contacts that match your detected patterns (form submissions, estimate requests, inquiry subjects) are automatically classified as leads.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-mohave text-[12px] text-[#597794] mt-0.5 flex-shrink-0">2.</span>
            <p className="font-mohave text-[12px] text-[#999]">
              <span className="text-white">AI classification</span> — new inbound emails are analyzed to detect potential leads, even if they don&apos;t match an existing pattern.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-mohave text-[12px] text-[#597794] mt-0.5 flex-shrink-0">3.</span>
            <p className="font-mohave text-[12px] text-[#999]">
              <span className="text-white">Manual label</span> — apply the{" "}
              <span className="text-[#597794]">OPS Pipeline</span> label to any email thread in Gmail and it will be imported on the next sync.
            </p>
          </div>
        </div>
        <p className="font-mohave text-[11px] text-[#555] mt-2">
          New leads appear in your pipeline for review. You can adjust detection sensitivity in Settings.
        </p>
      </motion.div>

      {/* Sync frequency */}
      {!activated && (
        <motion.div variants={staggerItem} className="mb-6">
          <p className="font-kosugi text-[9px] tracking-[0.15em] uppercase text-[#999] mb-3">
            Sync Frequency
          </p>
          <div className="flex gap-2 flex-wrap">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedInterval(opt.value)}
                className="px-3 py-1.5 border transition-all font-mohave text-[12px]"
                style={{
                  borderRadius: 2,
                  borderColor:
                    selectedInterval === opt.value
                      ? "#597794"
                      : "rgba(255,255,255,0.1)",
                  background:
                    selectedInterval === opt.value
                      ? "rgba(89,119,148,0.15)"
                      : "transparent",
                  color:
                    selectedInterval === opt.value ? "#597794" : "#999",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="font-mohave text-[11px] text-[#666] mt-2">
            Real-time sync via push notifications is always active. Scheduled sync runs as a safety net.
          </p>
        </motion.div>
      )}

      {/* Activation error */}
      {activationError && (
        <motion.div
          variants={staggerItem}
          className="mb-4 p-3 border border-[#93321A]/30 bg-[#93321A]/10"
          style={{ borderRadius: 3 }}
        >
          <p className="font-mohave text-[13px] text-[#FF6B4A]">{activationError}</p>
        </motion.div>
      )}

      {/* Activate / Done */}
      <motion.div variants={staggerItem}>
        {activated ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-[#9DB582]" />
              <span className="font-mohave text-[13px] text-[#9DB582]">
                Pipeline sync is active
              </span>
            </div>
            <Button
              onClick={onComplete}
              className="font-kosugi text-[11px] tracking-[0.1em] uppercase bg-[#597794] hover:bg-[#6A88A5] text-white px-6 py-2"
              style={{ borderRadius: 3 }}
            >
              Done
            </Button>
          </div>
        ) : (
          <Button
            onClick={handleActivate}
            disabled={activating}
            className="font-kosugi text-[11px] tracking-[0.1em] uppercase bg-[#597794] hover:bg-[#6A88A5] text-white px-8 py-2.5 w-full disabled:opacity-40"
            style={{ borderRadius: 3 }}
          >
            {activating ? (
              <>
                <Loader2 size={14} className="animate-spin mr-2" />
                Activating...
              </>
            ) : (
              "Activate Pipeline Sync"
            )}
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}
