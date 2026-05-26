"use client";

import { Mail, Maximize2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  spatialToolbarVariants,
  spatialToolbarVariantsReduced,
} from "@/lib/utils/motion";
import { usePipelineModeStore } from "./pipeline-mode-store";

interface PipelineFocusedToolbarProps {
  reviewCount?: number;
  onReviewEmails?: () => void;
}

export function PipelineFocusedToolbar({
  reviewCount = 0,
  onReviewEmails,
}: PipelineFocusedToolbarProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const variants = reduced
    ? spatialToolbarVariantsReduced
    : spatialToolbarVariants;
  const toggleMode = usePipelineModeStore((state) => state.toggleMode);

  return (
    <motion.div
      className="flex items-center gap-[8px]"
      initial="hidden"
      animate="visible"
      variants={variants}
    >
      {reviewCount > 0 && onReviewEmails && (
        <>
          <ToolbarAction onClick={onReviewEmails}>
            <Mail className="h-[11px] w-[11px]" strokeWidth={1.5} />
            <span className="font-mono uppercase leading-none tracking-[0.12em] [font-size:10px]">
              {t("gmail.reviewEmails")}
            </span>
            <span className="inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-chip border border-line-hi bg-surface-active px-1 font-mono leading-none text-text [font-size:9px]">
              {reviewCount > 99 ? "99+" : reviewCount}
            </span>
          </ToolbarAction>
          <Divider />
        </>
      )}

      <ToolbarAction onClick={toggleMode} isModeToggle>
        <Maximize2 className="h-[11px] w-[11px]" strokeWidth={1.5} />
        <span className="font-mono uppercase leading-none tracking-[0.12em] [font-size:10px]">
          {t("focused.modeButton.spatial")}
        </span>
      </ToolbarAction>
    </motion.div>
  );
}

function ToolbarAction({
  children,
  onClick,
  isActive,
  isModeToggle,
}: {
  children: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
  isModeToggle?: boolean;
}) {
  return (
    <button
      type="button"
      data-pipeline-mode-toggle={isModeToggle ? "true" : undefined}
      className={cn(
        "flex h-[26px] shrink-0 items-center gap-[4px] whitespace-nowrap rounded-[4px] px-[8px] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
        isModeToggle || isActive
          ? "bg-transparent text-text hover:bg-white/[0.04]"
          : "text-text-2 hover:bg-white/[0.04] hover:text-text"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-[16px] w-px bg-border-subtle" />;
}
