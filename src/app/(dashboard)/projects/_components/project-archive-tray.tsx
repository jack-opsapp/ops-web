"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, Trash2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { Project } from "@/lib/types/models";
import { formatCurrency } from "@/lib/utils/format";
import { useProjectCanvasStore } from "./project-canvas-store";
import {
  archiveTrayVariants,
  archiveTrayVariantsReduced,
} from "@/lib/utils/motion";

// ── Types ──

interface ProjectArchiveTrayProps {
  archivedProjects: Project[];
  clientNames: Map<string, string>;
  projectValues: Map<string, number>;
  canViewAccounting: boolean;
  onRestore: (id: string) => void;
  onDeletePermanently: (id: string) => void;
}

// ── Component ──

export function ProjectArchiveTray({
  archivedProjects,
  clientNames,
  projectValues,
  canViewAccounting,
  onRestore,
  onDeletePermanently,
}: ProjectArchiveTrayProps) {
  const { t } = useDictionary("projects-canvas");
  const reduced = useReducedMotion();
  const isOpen = useProjectCanvasStore((s) => s.isArchiveTrayOpen);
  const toggle = useProjectCanvasStore((s) => s.toggleArchiveTray);

  const variants = reduced
    ? archiveTrayVariantsReduced
    : archiveTrayVariants;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed right-0 bottom-0 flex flex-col"
          style={{
            width: 280,
            top: 56,
            zIndex: 500,
            background: "var(--surface-glass)",
            backdropFilter: "blur(28px) saturate(1.3)",
            WebkitBackdropFilter: "blur(28px) saturate(1.3)",
            borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
          }}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={variants}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <span className="font-mono text-micro text-text-3 uppercase tracking-widest">
              {t("archive.title")}
            </span>
            <button
              className="p-1 text-text-mute hover:text-text transition-colors cursor-pointer"
              onClick={toggle}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {archivedProjects.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <span className="font-mohave text-body-sm text-text-mute">
                  {t("archive.empty")}
                </span>
              </div>
            ) : (
              archivedProjects.map((project) => {
                const primaryLabel =
                  project.title ||
                  project.address?.split(",")[0] ||
                  t("card.untitledProject");
                const clientName =
                  clientNames.get(project.clientId ?? "") ?? "";
                const value = projectValues.get(project.id) ?? 0;

                return (
                  <div
                    key={project.id}
                    className="flex items-center gap-2 px-3 py-2 border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.04)] transition-colors group"
                  >
                    {/* Name + client + value */}
                    <div className="flex-1 min-w-0">
                      <p className="font-mohave text-body-sm text-text-2 truncate">
                        {primaryLabel}
                      </p>
                      {clientName && (
                        <p className="font-mohave text-caption-sm text-text-mute truncate">
                          {clientName}
                        </p>
                      )}
                      {canViewAccounting && (
                        <p className="font-mohave text-caption-sm text-text-mute">
                          {value > 0 ? formatCurrency(value) : "$--"}
                        </p>
                      )}
                    </div>

                    {/* Restore + Delete buttons */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="font-mono text-micro text-text-2 hover:text-text cursor-pointer whitespace-nowrap"
                        onClick={() => onRestore(project.id)}
                      >
                        {t("archive.restore")}
                      </button>
                      <button
                        className="p-0.5 text-text-mute hover:text-ops-error cursor-pointer transition-colors"
                        onClick={() => onDeletePermanently(project.id)}
                        title={t("archive.deletePermanently")}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
