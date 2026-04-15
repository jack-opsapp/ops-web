"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useNotifications, useDismissNotification } from "@/lib/hooks/use-notifications";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";
import type { AppNotification } from "@/lib/api/services/notification-service";
import { NotificationPill } from "./notification-pill";
import { NotificationMiniCard } from "./notification-mini-card";
import { useDictionary } from "@/i18n/client";

const MAX_VISIBLE_PILLS = 15;
const SCROLL_STEP = 200;
const HOVER_PREVIEW_COUNT = 3;

export function NotificationRail() {
  const { t } = useDictionary("topbar");
  const router = useRouter();
  const { railState, expand, collapse, openModal } = useNotificationRailStore();
  const openDuplicateSheet = useDuplicateReviewStore((s) => s.openSheet);
  const { data: notifications = [] } = useNotifications();
  const dismissMutation = useDismissNotification();
  const railRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [countHovered, setCountHovered] = useState(false);

  const isExpanded = railState === "expanded";
  const count = notifications.length;

  // Stable dismiss handler
  const dismissRef = useRef(dismissMutation.mutate);
  dismissRef.current = dismissMutation.mutate;

  function handleDismiss(id: string) {
    dismissRef.current(id);
  }

  // Sort urgent-first: persistent first, then newest
  const urgentSorted = [...notifications].sort((a, b) => {
    if (a.persistent !== b.persistent) return a.persistent ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  // Measure scroll overflow to show/hide arrows
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  // Observe scroll position and container resize
  useEffect(() => {
    if (!isExpanded) return;
    const el = scrollRef.current;
    if (!el) return;

    const raf = requestAnimationFrame(updateScrollState);
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [isExpanded, updateScrollState, notifications.length]);

  function scrollBy(dir: -1 | 1) {
    scrollRef.current?.scrollBy({ left: dir * SCROLL_STEP, behavior: "smooth" });
  }

  // Click outside to collapse
  useEffect(() => {
    if (!isExpanded) return;
    function handleClickOutside(e: MouseEvent) {
      if (railRef.current && !railRef.current.contains(e.target as Node)) {
        collapse();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded, collapse]);

  const expandRail = useCallback(() => {
    setCountHovered(false);
    expand();
  }, [expand]);

  // Click a preview card in the collapsed-hover state → open the notification
  // directly on the first click instead of merely expanding the rail.
  const handlePreviewClick = useCallback(
    (n: AppNotification) => {
      setCountHovered(false);
      if (n.type === "duplicates_found") {
        if (!n.persistent) dismissRef.current(n.id);
        openDuplicateSheet();
        return;
      }
      if (n.actionUrl) {
        if (!n.persistent) dismissRef.current(n.id);
        router.push(n.actionUrl);
        return;
      }
      // No action target — fall back to expanding the rail for review.
      expand();
    },
    [expand, openDuplicateSheet, router]
  );

  if (count === 0) return null;

  const visiblePills = notifications.slice(0, MAX_VISIBLE_PILLS);
  const overflowCount = count - MAX_VISIBLE_PILLS;

  // The 3 most urgent for hover preview
  const previewIds = new Set(urgentSorted.slice(0, HOVER_PREVIEW_COUNT).map((n) => n.id));

  return (
    <div
      ref={railRef}
      className="flex flex-row-reverse items-center gap-[3px] h-[40px] px-[6px] rounded-[4px] min-w-0 overflow-hidden md:overflow-visible max-w-[50vw] md:max-w-none"
    >
      <AnimatePresence mode="popLayout">
        {isExpanded ? (
          /* ═══════════════════════ EXPANDED ═══════════════════════ */
          <motion.div key="expanded" className="flex flex-row-reverse items-center gap-[3px] min-w-0 overflow-hidden">
            {/* Close (X) button — count morphs into X */}
            <motion.button
              key="close-btn"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2, ease: EASE_SMOOTH }}
              onClick={collapse}
              className="shrink-0 w-[40px] h-[40px] flex items-center justify-center rounded-[4px] border border-[rgba(255,255,255,0.06)] bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)] text-text-secondary hover:text-text-primary hover:border-[rgba(255,255,255,0.2)] transition-colors duration-150"
              aria-label="Collapse notifications"
            >
              <X className="w-[13px] h-[13px]" />
            </motion.button>

            {/* VIEW ALL button */}
            <motion.button
              key="view-all-btn"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.15, ease: EASE_SMOOTH }}
              onClick={openModal}
              className="shrink-0 flex items-center gap-[5px] h-[40px] px-[10px] rounded-[4px] border border-[rgba(89,119,148,0.3)] hover:border-[rgba(89,119,148,0.5)] bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)] transition-colors duration-150 whitespace-nowrap"
            >
              <span className="font-mono text-[11px] text-ops-accent">{count}</span>
              <span className="font-kosugi text-[9px] uppercase tracking-[0.08em] text-text-secondary">{t("notifications.viewAll")}</span>
            </motion.button>

            {/* Left arrow */}
            <AnimatePresence>
              {canScrollLeft && (
                <motion.button
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 20 }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.12, ease: EASE_SMOOTH }}
                  onClick={() => scrollBy(-1)}
                  className="shrink-0 flex items-center justify-center text-text-disabled hover:text-text-secondary transition-colors duration-150"
                  aria-label="Scroll notifications left"
                >
                  <ChevronLeft className="w-[12px] h-[12px]" />
                </motion.button>
              )}
            </AnimatePresence>

            {/* Scrollable mini cards */}
            <div
              ref={scrollRef}
              className="flex items-center gap-[6px] overflow-x-auto scrollbar-hide pr-[4px] min-w-0"
            >
              {notifications.map((n, i) => (
                <NotificationMiniCard
                  key={n.id}
                  notification={n}
                  index={i}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>

            {/* Right arrow */}
            <AnimatePresence>
              {canScrollRight && (
                <motion.button
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 20 }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.12, ease: EASE_SMOOTH }}
                  onClick={() => scrollBy(1)}
                  className="shrink-0 flex items-center justify-center text-text-disabled hover:text-text-secondary transition-colors duration-150"
                  aria-label="Scroll notifications right"
                >
                  <ChevronRight className="w-[12px] h-[12px]" />
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          /* ═══════════════════════ COLLAPSED ═══════════════════════ */
          <motion.div
            key="collapsed"
            className="flex flex-row-reverse items-center gap-[4px]"
            onMouseLeave={() => setCountHovered(false)}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
          >
            {/* Count button — styled, bespoke */}
            <motion.button
              key="count-btn"
              className="shrink-0 w-[40px] h-[40px] flex items-center justify-center rounded-[4px] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(89,119,148,0.4)] bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)] font-mono text-[12px] text-text-secondary hover:text-ops-accent transition-all duration-150 cursor-pointer"
              style={{
                background: countHovered ? "rgba(89, 119, 148, 0.08)" : "transparent",
              }}
              onClick={expandRail}
              onMouseEnter={() => setCountHovered(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.05 } }}
              transition={{ duration: 0.15, ease: EASE_SMOOTH }}
              aria-label={`${count} notifications — click to expand`}
            >
              {count}
            </motion.button>

            {/* Pills — first 3 expand into mini previews on hover */}
            <div className="flex items-center gap-[3px]">
              {visiblePills.map((n) => {
                const isPreview = countHovered && previewIds.has(n.id);
                return isPreview ? (
                  <motion.div
                    key={n.id}
                    initial={false}
                    animate={{ width: 160, opacity: 1 }}
                    transition={{ duration: 0.25, ease: EASE_SMOOTH }}
                    onClick={() => handlePreviewClick(n)}
                    className="shrink-0 h-[40px] rounded-[4px] cursor-pointer overflow-hidden"
                    style={{
                      background: "rgba(10, 10, 10, 0.70)",
                      backdropFilter: "blur(20px) saturate(1.2)",
                      WebkitBackdropFilter: "blur(20px) saturate(1.2)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderLeft: n.persistent
                        ? "2px solid var(--ops-accent, #597794)"
                        : "1px solid rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    <div className="flex items-center gap-[6px] h-full px-[8px] whitespace-nowrap">
                      <span className="font-mohave text-[11px] text-text-primary truncate flex-1 min-w-0">
                        {n.title}
                      </span>
                      {n.actionLabel && (
                        <span className="font-kosugi text-[8px] uppercase tracking-wider text-ops-accent shrink-0">
                          {n.actionLabel}
                        </span>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={n.id}
                    initial={false}
                    animate={{ width: 6, opacity: countHovered ? 0.4 : 1 }}
                    transition={{ duration: 0.25, ease: EASE_SMOOTH }}
                    className="shrink-0"
                  >
                    <NotificationPill
                      persistent={n.persistent}
                      layoutId={`notif-pill-${n.id}`}
                      title={n.title}
                      body={n.body}
                    />
                  </motion.div>
                );
              })}

              {overflowCount > 0 && (
                <span className="font-mono text-[9px] text-text-disabled ml-[2px]">
                  +{overflowCount}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
