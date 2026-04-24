"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { CalibrationSection } from "@/lib/types/calibration";

const LABEL: Record<CalibrationSection, string> = {
  inputs: "Inputs",
  corpus: "Corpus",
  config: "Config",
  activity: "Activity",
  milestones: "Milestones",
};

interface Props {
  currentSection: CalibrationSection;
}

export function SectionBreadcrumb({ currentSection }: Props) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push("/calibration")}
      className="flex items-center gap-2 mb-6 text-text-3 hover:text-text-2 transition-colors group"
    >
      <ChevronLeft className="w-4 h-4" />
      <span className="font-mono text-micro uppercase tracking-wider">
        <span className="text-text-mute">COMMAND // CALIBRATION //</span>{" "}
        <span className="text-text-2 group-hover:text-text">
          {LABEL[currentSection]}
        </span>
      </span>
    </button>
  );
}
