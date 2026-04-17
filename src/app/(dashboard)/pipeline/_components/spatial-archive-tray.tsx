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

interface SpatialDealTrayProps {
  opportunities: Opportunity[];
  clients: Map<string, string>;
  isOpen: boolean;
  onClose: () => void;
  title: string;
  emptyLabel: string;
  onRestore: (id: string) => void;
  onDeletePermanently: (id: string) => void;
  showStageDot?: boolean;
}

// ── Shared tray component ──

function SpatialDealTray({
  opportunities,
  clients,
  isOpen,
  onClose,
  title,
  emptyLabel,
  onRestore,
  onDeletePermanently,
  showStageDot = true,
}: SpatialDealTrayProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const variants = reduced
    ? spatialArchiveTrayVariantsReduced
    : spatialArchiveTrayVariants;

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
              {title}
            </span>
            <button
              className="p-1 text-text-mute hover:text-text transition-colors cursor-pointer"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {opportunities.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <span className="font-mohave text-body-sm text-text-mute">
                  {emptyLabel}
                </span>
              </div>
            ) : (
              opportunities.map((opp) => {
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
                    {/* Stage color dot — hidden for single-stage trays */}
                    {showStageDot && (
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: stageColor }}
                      />
                    )}

                    {/* Name + value + date */}
                    <div className="flex-1 min-w-0">
                      <p className="font-mohave text-body-sm text-text-2 truncate">
                        {clientName}
                      </p>
                      <p className="font-mohave text-caption-sm text-text-mute">
                        {opp.estimatedValue
                          ? formatCurrency(opp.estimatedValue)
                          : "$--"}
                      </p>
                      {opp.archivedAt && (
                        <p className="font-mono text-micro text-text-mute">
                          {formatTimeAgo(opp.archivedAt)}
                        </p>
                      )}
                    </div>

                    {/* Restore + Delete buttons */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="font-mono text-micro text-text-2 hover:text-text cursor-pointer whitespace-nowrap"
                        onClick={() => onRestore(opp.id)}
                      >
                        {t("archiveTray.restore")}
                      </button>
                      <button
                        className="p-0.5 text-text-mute hover:text-ops-error cursor-pointer transition-colors"
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

// ── Public exports: Archive + Discard trays ──

interface SpatialArchiveTrayProps {
  archivedOpportunities: Opportunity[];
  clients: Map<string, string>;
  onRestore: (id: string, toStage?: string) => void;
  onDeletePermanently: (id: string) => void;
}

export function SpatialArchiveTray({
  archivedOpportunities,
  clients,
  onRestore,
  onDeletePermanently,
}: SpatialArchiveTrayProps) {
  const { t } = useDictionary("pipeline");
  const isOpen = useSpatialCanvasStore((s) => s.isArchiveTrayOpen);
  const toggle = useSpatialCanvasStore((s) => s.toggleArchiveTray);

  return (
    <SpatialDealTray
      opportunities={archivedOpportunities}
      clients={clients}
      isOpen={isOpen}
      onClose={toggle}
      title={t("archiveTray.title")}
      emptyLabel={t("archiveTray.empty")}
      onRestore={(id) => onRestore(id)}
      onDeletePermanently={onDeletePermanently}
    />
  );
}

interface SpatialDiscardTrayProps {
  discardedOpportunities: Opportunity[];
  clients: Map<string, string>;
  onRestore: (id: string) => void;
  onDeletePermanently: (id: string) => void;
}

export function SpatialDiscardTray({
  discardedOpportunities,
  clients,
  onRestore,
  onDeletePermanently,
}: SpatialDiscardTrayProps) {
  const { t } = useDictionary("pipeline");
  const isOpen = useSpatialCanvasStore((s) => s.isDiscardTrayOpen);
  const toggle = useSpatialCanvasStore((s) => s.toggleDiscardTray);

  return (
    <SpatialDealTray
      opportunities={discardedOpportunities}
      clients={clients}
      isOpen={isOpen}
      onClose={toggle}
      title={t("discardTray.title")}
      emptyLabel={t("discardTray.empty")}
      onRestore={onRestore}
      showStageDot={false}
      onDeletePermanently={onDeletePermanently}
    />
  );
}
