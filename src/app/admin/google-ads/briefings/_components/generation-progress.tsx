"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { BriefingProgress } from "@/lib/admin/briefing-types";

interface GenerationProgressProps {
  onComplete: () => void;
}

const STEPS = [
  "Pulling ad performance data",
  "Researching competitor ads",
  "Scanning market sentiment",
  "Generating insights and recommendations",
  "Delivering briefing",
];

export function GenerationProgress({ onComplete }: GenerationProgressProps) {
  const [progress, setProgress] = useState<BriefingProgress | null>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "complete" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((id: string) => {
    startTimeRef.current = Date.now();

    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/google-ads/briefing/${id}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === "complete") {
          setStatus("complete");
          setProgress(null);
          onComplete();
          return;
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error);
          return;
        } else if (data.progress) {
          setProgress(data.progress);
        }
      } catch { /* silent */ }

      // Back off from 3s to 5s after 30 seconds
      const delay = Date.now() - startTimeRef.current > 30000 ? 5000 : 3000;
      pollRef.current = setTimeout(poll, delay);
    };

    poll();
  }, [onComplete]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleGenerate = useCallback(async () => {
    setStatus("generating");
    setError(null);
    try {
      const res = await fetch("/api/admin/google-ads/briefing/generate", { method: "POST" });
      if (!res.ok) throw new Error("Failed to start briefing");
      const { id } = await res.json();
      startPolling(id);
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [startPolling]);

  if (status === "idle") {
    return (
      <button
        onClick={handleGenerate}
        className="font-mohave text-[13px] uppercase tracking-wider px-4 py-2 border border-[#597794] text-[#597794] rounded hover:bg-[#597794]/10 transition-colors duration-100"
      >
        Generate Briefing Now
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {STEPS.map((label, i) => {
        const stepNum = i + 1;
        const isDone = progress ? stepNum < progress.step : status === "complete";
        const isActive = progress?.step === stepNum;

        return (
          <div key={i} className="flex items-center gap-3 font-mohave text-[13px]">
            <span className={isDone ? "text-[#9DB582]" : isActive ? "text-[#597794]" : "text-[#444444]"}>
              {isDone ? "\u2713" : isActive ? "\u25CF" : "\u25CB"}
            </span>
            <span className={isDone ? "text-[#6B6B6B]" : isActive ? "text-[#E5E5E5]" : "text-[#444444]"}>
              Step {stepNum}/5: {label}
            </span>
          </div>
        );
      })}

      {status === "failed" && error && (
        <div className="mt-3 p-3 border border-[#93321A]/30 rounded bg-[#93321A]/5">
          <p className="font-mohave text-[13px] text-[#93321A]">{error}</p>
          <button onClick={handleGenerate} className="font-mohave text-[12px] text-[#A0A0A0] mt-2 hover:text-[#E5E5E5] transition-colors duration-100">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
