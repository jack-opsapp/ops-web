"use client";

// ---------------------------------------------------------------------------
// PhaseCGatePrompt — centered frosted-glass modal for Phase C registration.
// Blocks ALL interaction when visible (full-screen backdrop).
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { X } from "lucide-react";
import { useIntelStore } from "@/stores/intel-store";
import { useDictionary } from "@/i18n/client";
import { RedactedText } from "../redacted-text";

interface PhaseCGatePromptProps {
  onRequestAccess: () => void;
}

export function PhaseCGatePrompt({ onRequestAccess }: PhaseCGatePromptProps) {
  const { t } = useDictionary("intel");
  const showGatePrompt = useIntelStore((s) => s.showGatePrompt);
  const setShowGatePrompt = useIntelStore((s) => s.setShowGatePrompt);

  const handleDismiss = useCallback(() => {
    setShowGatePrompt(false);
  }, [setShowGatePrompt]);

  const handleRequest = useCallback(() => {
    setShowGatePrompt(false);
    onRequestAccess();
  }, [setShowGatePrompt, onRequestAccess]);

  if (!showGatePrompt) return null;

  return (
    // Full-screen backdrop blocks ALL canvas interaction (scroll, pan, click)
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{ background: "rgba(10, 10, 10, 0.5)" }}
      onClick={handleDismiss}
    >
      <div
        className="relative max-w-[380px] w-full mx-6 px-8 py-7"
        style={{
          background: "var(--surface-glass-dense)",
          backdropFilter: "blur(24px) saturate(1.2)",
          WebkitBackdropFilter: "blur(24px) saturate(1.2)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "3px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dismiss X */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-[#666] hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Content */}
        <div className="text-left space-y-4">
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#6F94B0]">
            {t("gate.title")}
          </div>

          <div className="font-mohave text-base text-white leading-relaxed">
            <RedactedText>{t("gate.prompt")}</RedactedText>
          </div>

          <p className="font-mohave text-sm text-[#999] leading-relaxed">
            Phase C transforms your operations data into an intelligent network — mapping relationships, patterns, and insights across your entire business.
          </p>

          <button
            onClick={handleRequest}
            className="font-mono text-micro uppercase tracking-wider px-4 py-2 rounded-bar transition-colors"
            style={{
              background: "rgba(111, 148, 176, 0.2)",
              border: "1px solid rgba(111, 148, 176, 0.4)",
              color: "#6F94B0",
            }}
          >
            {t("gate.cta")}
          </button>
        </div>
      </div>
    </div>
  );
}
