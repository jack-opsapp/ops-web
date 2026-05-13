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
      className="flex items-center gap-1 px-[6px]"
      initial="hidden"
      animate="visible"
      variants={variants}
    >
      {reviewCount > 0 && onReviewEmails && (
        <>
          <ToolbarAction onClick={onReviewEmails}>
            <Mail className="h-[13px] w-[13px]" strokeWidth={1.5} />
            <span className="font-mono text-micro uppercase tracking-wider">
              {t("gmail.reviewEmails")}
            </span>
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-chip border border-line-hi bg-surface-active px-1 font-mono text-micro text-text">
              {reviewCount > 99 ? "99+" : reviewCount}
            </span>
          </ToolbarAction>
          <Divider />
        </>
      )}

      <ToolbarAction onClick={toggleMode}>
        <Maximize2 className="h-[13px] w-[13px]" strokeWidth={1.5} />
        <span className="font-mono text-micro uppercase tracking-wider">
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-[30px] items-center gap-[5px] rounded border px-2 transition-colors duration-150",
        isActive
          ? "border-line-hi bg-surface-active text-text"
          : "border-transparent text-text-3 hover:bg-surface-hover hover:text-text"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-[18px] w-px bg-border-subtle" />;
}
