"use client";

import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCalendarStore } from "@/stores/calendar-store";

/**
 * CascadeConfirmBar — fixed bar at top of calendar canvas.
 *
 * Shows when a cascade preview is active. Provides Apply / Cancel actions.
 * Reads isConfirmBarVisible, confirmBarMessage, pendingCascadeAction from the store.
 */
export function CascadeConfirmBar() {
  const isVisible = useCalendarStore((s) => s.isConfirmBarVisible);
  const message = useCalendarStore((s) => s.confirmBarMessage);
  const pendingAction = useCalendarStore((s) => s.pendingCascadeAction);
  const hideConfirmBar = useCalendarStore((s) => s.hideConfirmBar);
  const clearGhostPreviews = useCalendarStore((s) => s.clearGhostPreviews);

  const handleApply = useCallback(async () => {
    if (pendingAction) {
      await pendingAction();
    }
    hideConfirmBar();
  }, [pendingAction, hideConfirmBar]);

  const handleCancel = useCallback(() => {
    clearGhostPreviews();
    hideConfirmBar();
  }, [clearGhostPreviews, hideConfirmBar]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -48, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="flex items-center justify-between"
          style={{
            height: 48,
            padding: "12px 16px",
            background: "#141414",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 3,
          }}
        >
          {/* Left — warning icon + message */}
          <div className="flex items-center gap-[8px] min-w-0">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="shrink-0"
            >
              <path
                d="M7 1L13 12H1L7 1Z"
                stroke="#597794"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <path
                d="M7 5.5V8"
                stroke="#597794"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <circle cx="7" cy="10" r="0.6" fill="#597794" />
            </svg>
            <span
              className="font-mohave text-[13px] leading-tight truncate"
              style={{ color: "#FFFFFF" }}
            >
              {message}
            </span>
          </div>

          {/* Right — action buttons */}
          <div className="flex items-center gap-[8px] shrink-0">
            {/* Apply button */}
            <button
              onClick={handleApply}
              className="font-kosugi text-[10px] uppercase tracking-wider leading-tight cursor-pointer"
              style={{
                padding: "5px 12px",
                background: "#597794",
                color: "#FFFFFF",
                border: "none",
                borderRadius: 3,
              }}
            >
              APPLY
            </button>

            {/* Cancel button — ghost / border-only */}
            <button
              onClick={handleCancel}
              className="font-kosugi text-[10px] uppercase tracking-wider leading-tight cursor-pointer"
              style={{
                padding: "5px 12px",
                background: "transparent",
                color: "#999999",
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 3,
              }}
            >
              CANCEL
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
