"use client";

import { useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Archive, ChevronDown, ChevronUp } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { useDictionary } from "@/i18n/client";
import type { Project } from "@/lib/types/models";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { useProjectCanvasStore, CARD_WIDTH, CARD_HEIGHT, STACK_GAP } from "./project-canvas-store";

interface ProjectArchiveTrayProps {
  archivedProjects: Project[];
  clientNames: Map<string, string>;
  isDragActive: boolean;
  renderCard?: (project: Project) => React.ReactNode;
}

export function ProjectArchiveTray({
  archivedProjects,
  clientNames,
  isDragActive,
}: ProjectArchiveTrayProps) {
  const { t } = useDictionary("projects-canvas");
  const reduced = useReducedMotion();
  const isOpen = useProjectCanvasStore((s) => s.isArchiveTrayOpen);
  const toggleTray = useProjectCanvasStore((s) => s.toggleArchiveTray);

  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: "archive-drop",
    data: { isArchive: true },
  });

  const statusColor = PROJECT_STATUS_COLORS[ProjectStatus.Archived];

  return (
    <>
      {/* Drop zone — only visible during drag */}
      <AnimatePresence>
        {isDragActive && (
          <motion.div
            ref={dropRef}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-0 left-0 right-0 z-[200] flex items-center justify-center"
            style={{
              height: 64,
              background: isOver
                ? `rgba(161, 130, 181, 0.15)`
                : "rgba(10, 10, 10, 0.8)",
              backdropFilter: "blur(20px) saturate(1.2)",
              borderTop: isOver
                ? `2px solid ${statusColor}60`
                : "1px solid rgba(255,255,255,0.06)",
              transition: "background 0.2s ease-out, border 0.2s ease-out",
            }}
          >
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4" style={{ color: statusColor }} />
              <span className="font-kosugi text-micro-sm uppercase tracking-widest" style={{ color: statusColor }}>
                {t("tray.dropToArchive")}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tray toggle button — bottom-left, always visible */}
      {!isDragActive && (
        <button
          onClick={toggleTray}
          className="fixed bottom-4 left-4 z-[200] flex items-center gap-2 px-3 py-2 rounded-[4px] transition-colors duration-150"
          style={{
            background: "rgba(10, 10, 10, 0.8)",
            backdropFilter: "blur(20px) saturate(1.2)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <Archive className="w-3.5 h-3.5 text-text-disabled" />
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {t("archive.title")}
          </span>
          <span className="font-mohave text-body-sm text-text-tertiary">
            {archivedProjects.length}
          </span>
          {isOpen ? (
            <ChevronDown className="w-3 h-3 text-text-disabled" />
          ) : (
            <ChevronUp className="w-3 h-3 text-text-disabled" />
          )}
        </button>
      )}

      {/* Tray content */}
      <AnimatePresence>
        {isOpen && !isDragActive && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: reduced ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-14 left-4 z-[200] overflow-y-auto scrollbar-hide"
            style={{
              maxHeight: 320,
              width: 280,
              background: "rgba(10, 10, 10, 0.9)",
              backdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 6,
              padding: 12,
            }}
          >
            {archivedProjects.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                  {t("archive.empty")}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {archivedProjects.map((project) => {
                  const primaryLabel = project.title || project.address?.split(",")[0] || "Untitled";
                  const client = clientNames.get(project.clientId ?? "") ?? "";
                  return (
                    <div
                      key={project.id}
                      className="px-2 py-1.5 rounded-[3px] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150"
                      style={{
                        borderLeft: `2px solid ${statusColor}40`,
                      }}
                    >
                      <div className="font-mohave text-body-sm text-text-secondary truncate">
                        {primaryLabel}
                      </div>
                      {client && (
                        <div className="font-mohave text-[11px] text-text-disabled truncate">
                          {client}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
