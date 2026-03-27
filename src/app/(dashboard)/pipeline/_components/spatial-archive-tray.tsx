"use client";

import { useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, Trash2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { Opportunity } from "@/lib/types/pipeline";
import {
  OPPORTUNITY_STAGE_COLORS,
  formatCurrency,
} from "@/lib/types/pipeline";
import { formatTimeAgo } from "@/lib/utils/date";
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
          className="fixed right-0 bottom-0 flex flex-col"
          style={{
            width: 280,
            top: 56,
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
            <span className="font-kosugi text-micro-sm text-text-tertiary uppercase tracking-widest">
              {t("archiveTray.title")}
            </span>
            <button
              className="p-1 text-text-disabled hover:text-white transition-colors cursor-pointer"
              onClick={toggleArchiveTray}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {archivedOpportunities.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <span className="font-mohave text-body-sm text-text-disabled">
                  {t("archiveTray.empty")}
                </span>
              </div>
            ) : (
              archivedOpportunities.map((opp) => {
                const clientName =
                  clients.get(opp.clientId ?? "") ??
                  opp.contactName ??
                  t("card.unknown");
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
                      <p className="font-mohave text-body-sm text-text-secondary truncate">
                        {clientName}
                      </p>
                      <p className="font-mohave text-caption-sm text-text-disabled">
                        {opp.estimatedValue
                          ? formatCurrency(opp.estimatedValue)
                          : "$--"}
                      </p>
                      {opp.archivedAt && (
                        <p className="font-kosugi text-micro-sm text-text-disabled">
                          {formatTimeAgo(opp.archivedAt)}
                        </p>
                      )}
                    </div>

                    {/* Restore + Delete buttons */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="font-kosugi text-micro-sm text-ops-accent hover:text-white cursor-pointer whitespace-nowrap"
                        onClick={() => handleRestore(opp.id)}
                      >
                        {t("archiveTray.restore")}
                      </button>
                      <button
                        className="p-0.5 text-text-disabled hover:text-ops-error cursor-pointer transition-colors"
                        onClick={() => onDeletePermanently(opp.id)}
                        title={t("contextMenu.deletePermanently")}
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
