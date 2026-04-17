"use client";

import { ArrowLeft } from "lucide-react";
import { useIntelStore } from "@/stores/intel-store";
import { useDictionary } from "@/i18n/client";

export function BackButton() {
  const { t } = useDictionary("intel");
  const focusLevel = useIntelStore((s) => s.focusLevel);
  const focusBack = useIntelStore((s) => s.focusBack);

  if (focusLevel === 1) return null;

  return (
    <button
      onClick={focusBack}
      className="flex items-center gap-2 px-3 py-2 transition-colors group"
      style={{
        background: "var(--surface-glass)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "3px",
      }}
    >
      <ArrowLeft className="w-3.5 h-3.5 text-[#999] group-hover:text-white transition-colors" />
      <span className="font-kosugi text-micro uppercase tracking-wider text-[#999] group-hover:text-white transition-colors">
        {t("nav.back")}
      </span>
    </button>
  );
}
