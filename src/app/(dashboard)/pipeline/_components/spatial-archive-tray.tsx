"use client";

import { useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { Opportunity } from "@/lib/types/pipeline";
import {
  OPPORTUNITY_STAGE_COLORS,
  formatCurrency,
} from "@/lib/types/pipeline";
import { useSpatialCanvasStore } from "./spatial-canvas-store";
import {
  spatialArchiveTrayVariants,
  spatialArchiveTrayVariantsReduced,
} from "@/lib/utils/motion";

// ── Types ──

interface SpatialArchiveTrayProps {
  archivedOpportunities: Opportunity[];
  clients: Map<string, string>;
  onRestore: (id: string, toStage?: string) => void;
  onDeletePermanently: (id: string) => void;
}

// ── Component ──

export function SpatialArchiveTray({
  archivedOpportunities,
  clients,
  onRestore,
  onDeletePermanently,
}: SpatialArchiveTrayProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const variants = reduced
    ? spatialArchiveTrayVariantsReduced
    : spatialArchiveTrayVariants;

  const isOpen = useSpatialCanvasStore((s) => s.isArchiveTrayOpen);
  const toggleArchiveTray = useSpatialCanvasStore((s) => s.toggleArchiveTray);

  const handleRestore = useCallback(
    (id: string) => {
      onRestore(id);
    },
    [onRestore]
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed right-0 top-0 bottom-0 flex flex-col"
          style={{
            width: 280,
            zIndex: 500,
            background: "rgba(10, 10, 10, 0.70)",
            backdropFilter: "blur(20px) saturate(1.2)",
            WebkitBackdropFilter: "blur(20px) saturate(1.2)",
            borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
          }}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={variants}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <span className="font-kosugi text-[10px] text-[#666] uppercase tracking-widest">
              {t("archiveTray.title")}
            </span>
            <button
              className="p-1 text-[#555] hover:text-white transition-colors cursor-pointer"
              onClick={toggleArchiveTray}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {archivedOpportunities.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <span className="font-mohave text-sm text-[#444]">
                  {t("archiveTray.empty")}
                </span>
              </div>
            ) : (
              archivedOpportunities.map((opp) => {
                const clientName =
                  clients.get(opp.clientId ?? "") ??
                  opp.contactName ??
                  "Unknown";
                const stageColor =
                  OPPORTUNITY_STAGE_COLORS[opp.stage] ?? "#444";

                return (
                  <div
                    key={opp.id}
                    className="flex items-center gap-2 px-3 py-2 border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.04)] transition-colors group"
                  >
                    {/* Stage color dot */}
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: stageColor }}
                    />

                    {/* Name + value */}
                    <div className="flex-1 min-w-0">
                      <p className="font-mohave text-sm text-[#999] truncate">
                        {clientName}
                      </p>
                      <p className="font-mohave text-xs text-[#555]">
                        {opp.estimatedValue
                          ? formatCurrency(opp.estimatedValue)
                          : "$--"}
                      </p>
                    </div>

                    {/* Restore button */}
                    <button
                      className="font-kosugi text-[10px] text-[#597794] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer whitespace-nowrap"
                      onClick={() => handleRestore(opp.id)}
                    >
                      {t("archiveTray.restore")}
                    </button>
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
