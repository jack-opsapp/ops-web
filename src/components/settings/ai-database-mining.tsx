"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Database,
  Loader2,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  DollarSign,
  Users,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { getIdToken } from "@/lib/firebase/auth";

// ─── Animation ──────────────────────────────────────────────────────────────────

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

// ─── Types ──────────────────────────────────────────────────────────────────────

interface MiningStats {
  pricingFacts: number;
  clientRelationships: number;
  seasonalPatterns: number;
  errors: string[];
  durationMs: number;
}

type MiningPhase = "idle" | "mining" | "complete" | "error";

// ─── Component ──────────────────────────────────────────────────────────────────

interface AiDatabaseMiningProps {
  onComplete?: (stats: MiningStats) => void;
}

export function AiDatabaseMining({ onComplete }: AiDatabaseMiningProps) {
  const { t } = useDictionary("ai-setup");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [phase, setPhase] = useState<MiningPhase>("idle");
  const [currentStep, setCurrentStep] = useState<string>("");
  const [stats, setStats] = useState<MiningStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const startMining = useCallback(async () => {
    if (!companyId) return;

    setPhase("mining");
    setError(null);
    setStats(null);

    // Show progressive steps for visual feedback
    const steps = [
      t("mining.estimates"),
      t("mining.clients"),
      t("mining.projects"),
    ];

    // Simulate progressive step advancement while the actual request runs
    let stepIndex = 0;
    setCurrentStep(steps[0]);
    const stepTimer = setInterval(() => {
      stepIndex++;
      if (stepIndex < steps.length) {
        setCurrentStep(steps[stepIndex]);
      }
    }, 3000);

    try {
      const idToken = await getIdToken();
      abortRef.current = new AbortController();

      const res = await fetch("/api/integrations/ai-setup/mine-database", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ companyId }),
        signal: abortRef.current.signal,
      });

      clearInterval(stepTimer);

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Mining failed" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const miningStats: MiningStats = {
        pricingFacts: data.pricingFacts ?? 0,
        clientRelationships: data.clientRelationships ?? 0,
        seasonalPatterns: data.seasonalPatterns ?? 0,
        errors: data.errors ?? [],
        durationMs: data.durationMs ?? 0,
      };

      setStats(miningStats);
      setPhase("complete");
      onComplete?.(miningStats);
    } catch (err) {
      clearInterval(stepTimer);
      if (err instanceof Error && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setPhase("error");
      console.error("[database-mining]", err);
    }
  }, [companyId, t, onComplete]);

  // ─── Idle state ─────────────────────────────────────────────────────────────

  if (phase === "idle") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Database className="w-[16px] h-[16px] text-text-tertiary" />
          <span className="font-mohave text-body font-medium uppercase tracking-wide text-text-primary">
            {t("mining.title")}
          </span>
        </div>
        <p className="font-mohave text-body-sm text-text-secondary">
          {t("mining.description")}
        </p>
        <button
          onClick={startMining}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.1)] text-text-primary font-mohave text-body-sm transition-colors"
        >
          <Database className="w-[14px] h-[14px] text-[#597794]" />
          {t("mining.start")}
        </button>
      </div>
    );
  }

  // ─── Mining in progress ─────────────────────────────────────────────────────

  if (phase === "mining") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Loader2 className="w-[16px] h-[16px] text-[#597794] animate-spin" />
          <span className="font-mohave text-body font-medium uppercase tracking-wide text-text-primary">
            {t("mining.title")}
          </span>
        </div>

        <div className="space-y-1.5">
          {/* Current step */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-[rgba(89,119,148,0.2)] bg-[rgba(89,119,148,0.06)]">
            <Loader2 className="w-[12px] h-[12px] text-[#597794] animate-spin shrink-0" />
            <span className="font-mohave text-body-sm text-[#597794]">
              {currentStep}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-[3px] rounded-full overflow-hidden bg-[rgba(255,255,255,0.06)]">
            <motion.div
              className="h-full bg-[#597794] rounded-full"
              initial={{ width: "5%" }}
              animate={{ width: "85%" }}
              transition={{
                duration: 15,
                ease: prefersReducedMotion ? "linear" : EASE_SMOOTH,
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ─── Error state ────────────────────────────────────────────────────────────

  if (phase === "error") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-[16px] h-[16px] text-[#93321A]" />
          <span className="font-mohave text-body font-medium uppercase tracking-wide text-text-primary">
            {t("mining.title")}
          </span>
        </div>
        <div className="px-2 py-1.5 rounded border border-[rgba(147,50,26,0.3)] bg-[rgba(147,50,26,0.08)]">
          <span className="font-mohave text-body-sm text-[#FF6B4A]">
            {error}
          </span>
        </div>
        <button
          onClick={startMining}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.1)] text-text-primary font-mohave text-body-sm transition-colors"
        >
          <RotateCcw className="w-[14px] h-[14px]" />
          Retry
        </button>
      </div>
    );
  }

  // ─── Complete state ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <CheckCircle className="w-[16px] h-[16px] text-[#9DB582]" />
        <span className="font-mohave text-body font-medium uppercase tracking-wide text-text-primary">
          {t("mining.complete")}
        </span>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-1.5">
          <div className="px-2 py-1.5 rounded border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-1 mb-[2px]">
              <DollarSign className="w-[11px] h-[11px] text-text-disabled" />
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                {t("mining.pricingFacts")}
              </span>
            </div>
            <span className="font-mohave text-[18px] font-semibold text-text-primary">
              {stats.pricingFacts}
            </span>
          </div>
          <div className="px-2 py-1.5 rounded border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-1 mb-[2px]">
              <Users className="w-[11px] h-[11px] text-text-disabled" />
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                {t("mining.clientRelationships")}
              </span>
            </div>
            <span className="font-mohave text-[18px] font-semibold text-text-primary">
              {stats.clientRelationships}
            </span>
          </div>
          <div className="px-2 py-1.5 rounded border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-1 mb-[2px]">
              <TrendingUp className="w-[11px] h-[11px] text-text-disabled" />
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                {t("mining.seasonalPatterns")}
              </span>
            </div>
            <span className="font-mohave text-[18px] font-semibold text-text-primary">
              {stats.seasonalPatterns}
            </span>
          </div>
        </div>
      )}

      {stats && stats.errors.length > 0 && (
        <div className="px-2 py-1 rounded border border-[rgba(196,168,104,0.2)] bg-[rgba(196,168,104,0.06)]">
          <span className="font-kosugi text-[10px] text-[#C4A868]">
            {stats.errors.length} warning{stats.errors.length !== 1 ? "s" : ""} during mining
          </span>
        </div>
      )}

      <button
        onClick={startMining}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] text-text-secondary font-mohave text-[13px] transition-colors"
      >
        <RotateCcw className="w-[12px] h-[12px]" />
        {t("mining.remine")}
      </button>
    </div>
  );
}
