"use client";

// ---------------------------------------------------------------------------
// PhaseCGatePrompt — centered frosted-glass modal that appears when the user
// attempts to rotate the galaxy without Phase C enabled. Contains redacted
// copy to build intrigue.
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
    <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
      <div
        className="pointer-events-auto relative max-w-[280px] px-6 py-5"
        style={{
          background: "rgba(10, 10, 10, 0.85)",
          backdropFilter: "blur(20px) saturate(1.2)",
          WebkitBackdropFilter: "blur(20px) saturate(1.2)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "3px",
        }}
      >
        {/* Dismiss X */}
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 text-[#666] hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Content */}
        <div className="text-left space-y-3">
          <div className="font-kosugi text-[10px] uppercase tracking-wider text-[#597794]">
            {t("gate.title")}
          </div>

          <div className="font-mohave text-sm text-white leading-relaxed">
            <RedactedText>{t("gate.prompt")}</RedactedText>
          </div>

          <button
            onClick={handleRequest}
            className="font-kosugi text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-[2px] transition-colors"
            style={{
              background: "rgba(89, 119, 148, 0.15)",
              border: "1px solid rgba(89, 119, 148, 0.3)",
              color: "#597794",
            }}
          >
            {t("gate.cta")}
          </button>
        </div>
      </div>
    </div>
  );
}
