"use client";

import { useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDictionary } from "@/i18n/client";

const DISMISS_KEY = "ops-task-type-nudge-dismissed";

interface TaskTypeNudgeBannerProps {
  variant?: "inline" | "dashboard";
}

export function TaskTypeNudgeBanner({ variant = "inline" }: TaskTypeNudgeBannerProps) {
  const { t } = useDictionary("settings");
  const router = useRouter();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(DISMISS_KEY) === "true";
  });

  if (dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-[8px] rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)]">
      <p className="flex-1 font-mohave text-body-sm text-text-2">
        {t("wizard.nudge.message")}
      </p>
      <button
        onClick={() => router.push("/settings?tab=task-types&wizard=true")}
        className="flex items-center gap-[4px] px-2 py-[4px] rounded font-mohave text-body-sm text-text-2 hover:text-text transition-colors shrink-0"
      >
        {t("wizard.nudge.cta")}
        <ArrowRight className="w-[12px] h-[12px]" />
      </button>
      <button
        onClick={handleDismiss}
        className="p-[2px] text-text-mute hover:text-text-2 transition-colors shrink-0"
      >
        <X className="w-[12px] h-[12px]" />
      </button>
    </div>
  );
}
