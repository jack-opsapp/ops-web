"use client";

import { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Receipt, Archive, ExternalLink } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { Project } from "@/lib/types/models";
import { UserAvatar } from "@/components/ops/user-avatar";
import {
  pipelineCardContentVariants,
  pipelineCardContentVariantsReduced,
} from "@/lib/utils/motion";

interface ProjectCardExpandedProps {
  project: Project;
  canManage: boolean;
  canCreateTasks: boolean;
  canRecordPayment: boolean;
  completedTasks: number;
  totalTasks: number;
  teamMembers: { id: string; name: string; avatarUrl?: string }[];
  statusDisplayName: string;
  daysInStatus: number;
  onOpenDetail: () => void;
  onAddTask: () => void;
  onRecordPayment: () => void;
  onArchive: () => void;
}

export const ProjectCardExpanded = memo(function ProjectCardExpanded({
  project,
  canManage,
  canCreateTasks,
  canRecordPayment,
  completedTasks,
  totalTasks,
  teamMembers,
  statusDisplayName,
  daysInStatus,
  onOpenDetail,
  onAddTask,
  onRecordPayment,
  onArchive,
}: ProjectCardExpandedProps) {
  const { t } = useDictionary("projects-canvas");
  const reduced = useReducedMotion();
  const variants = reduced
    ? pipelineCardContentVariantsReduced
    : pipelineCardContentVariants;

  const startDate = project.startDate
    ? new Date(project.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  const endDate = project.endDate
    ? new Date(project.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  const dateRange = startDate && endDate
    ? `${startDate} → ${endDate}`
    : startDate
      ? startDate
      : t("card.noDatesSet");

  return (
    <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
      {/* Info rows */}
      <motion.div
        custom={0}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
        className="flex flex-col gap-[3px] mb-2"
      >
        {/* Task summary */}
        <span className="font-mono text-micro text-text-3">
          {totalTasks > 0
            ? t("card.tasksComplete")
                .replace("{completed}", String(completedTasks))
                .replace("{total}", String(totalTasks))
            : t("card.noTasks")}
        </span>

        {/* Team members */}
        {teamMembers.length > 0 && (
          <div className="flex items-center gap-1 mt-1">
            {teamMembers.slice(0, 3).map((member) => (
              <UserAvatar
                key={member.id}
                name={member.name}
                imageUrl={member.avatarUrl}
                size="sm"
              />
            ))}
            {teamMembers.length > 3 && (
              <span className="font-mono text-micro text-text-mute ml-1">
                +{teamMembers.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Date range + days in status */}
        <div className="flex items-center justify-between mt-1">
          <span className="font-mono text-micro text-text-mute">
            {dateRange}
          </span>
          <span className="font-mono text-micro text-text-mute">
            {t("card.daysInStatus")
              .replace("{count}", String(daysInStatus))
              .replace("{status}", statusDisplayName)}
          </span>
        </div>
      </motion.div>

      {/* Actions */}
      <motion.div
        custom={1}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
        className="flex items-center gap-1 flex-wrap"
      >
        <button
          onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
          className="flex items-center gap-1 px-2 py-1 rounded-panel text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
        >
          <ExternalLink className="w-3 h-3" />
          <span className="font-mono text-micro">{t("actions.openDetail")}</span>
        </button>

        {canCreateTasks && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddTask(); }}
            className="flex items-center gap-1 px-2 py-1 rounded-panel text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
          >
            <Plus className="w-3 h-3" />
            <span className="font-mono text-micro">{t("actions.addTask")}</span>
          </button>
        )}

        {canRecordPayment && (
          <button
            onClick={(e) => { e.stopPropagation(); onRecordPayment(); }}
            className="flex items-center gap-1 px-2 py-1 rounded-panel text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
          >
            <Receipt className="w-3 h-3" />
            <span className="font-mono text-micro">{t("actions.recordPayment")}</span>
          </button>
        )}

        {canManage && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="flex items-center gap-1 px-2 py-1 rounded-panel text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
          >
            <Archive className="w-3 h-3" />
            <span className="font-mono text-micro">{t("actions.archive")}</span>
          </button>
        )}
      </motion.div>
    </div>
  );
});
