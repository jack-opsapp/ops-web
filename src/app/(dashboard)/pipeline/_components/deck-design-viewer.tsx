"use client";

/* eslint-disable @next/next/no-img-element -- Deck thumbnails are arbitrary S3 URLs outside the Next image allowlist. */

/**
 * DeckDesignViewer — view-only modal for a lead-attached deck design.
 * Raster thumbnail when the row has one, large wireframe render otherwise.
 * Decks are authored on iOS; the web surface presents, it never edits.
 *
 * Motion: transition beat — fade + 0.98→1 scale over 200ms EASE_SMOOTH;
 * reduced motion falls back to a 150ms opacity-only fade (same beat,
 * different means).
 */

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { formatDate } from "@/lib/utils/date";
import type { OpportunityDeckDesign } from "@/lib/api/services/deck-design-service";
import { buildWireframeModel } from "@/lib/utils/deck-wireframe";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { DeckWireframe } from "./deck-wireframe";

export function DeckDesignViewer({
  design,
  onClose,
}: {
  design: OpportunityDeckDesign;
  onClose: () => void;
}) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const model = useMemo(
    () => buildWireframeModel(design.vertices, design.edges),
    [design.vertices, design.edges]
  );

  // Focus the close control on open; hand focus back on close.
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    return () => origin?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const meta = `V${design.version} · ${formatDate(
    design.updatedAt ?? design.createdAt,
    "MMM d"
  )}`;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[3000] flex items-center justify-center bg-background/80 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0.15 : 0.2, ease: EASE_SMOOTH }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={design.title || t("overview.deckDesign", "Deck design")}
        data-keyboard-scope="modal-or-menu"
        className="glass-dense flex max-h-[86vh] w-[90vw] max-w-[720px] flex-col overflow-hidden rounded-modal border border-border"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        transition={{ duration: reduced ? 0.15 : 0.2, ease: EASE_SMOOTH }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 className="truncate font-cakemono text-[14px] font-light uppercase text-text">
              {design.title || t("overview.deckDesign", "Deck design")}
            </h2>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-3 [font-feature-settings:'tnum'_1,'zero'_1]">
              {meta}
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={t("focused.detailPanel.close", "Close")}
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          {design.thumbnailUrl ? (
            <img
              src={design.thumbnailUrl}
              alt=""
              className="max-h-full w-full rounded object-contain"
            />
          ) : model ? (
            <DeckWireframe
              model={model}
              className="max-h-full w-full text-text"
            />
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
              {t("overview.deckNoPreview", "[ no preview ]")}
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
