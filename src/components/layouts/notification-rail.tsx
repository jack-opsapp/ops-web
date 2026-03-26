"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useNotifications, useDismissNotification } from "@/lib/hooks/use-notifications";
import { NotificationPill } from "./notification-pill";
import { NotificationMiniCard } from "./notification-mini-card";
import { useDictionary } from "@/i18n/client";

const MAX_VISIBLE_PILLS = 15;
const SCROLL_STEP = 200;

export function NotificationRail() {
  const { t } = useDictionary("topbar");
  const { railState, expand, collapse, openModal } = useNotificationRailStore();
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

  if (count === 0) return null;

  const visiblePills = notifications.slice(0, MAX_VISIBLE_PILLS);
  const overflowCount = count - MAX_VISIBLE_PILLS;

  // Most urgent 2 notifications for hover preview (persistent first, then newest)
  const urgentPreview = [...notifications]
    .sort((a, b) => {
      if (a.persistent !== b.persistent) return a.persistent ? -1 : 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, 2);

  return (
    <div
      ref={railRef}
      className="flex items-center gap-[3px] h-[40px] px-[6px] rounded-[4px] bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)] border border-[rgba(255,255,255,0.06)] min-w-0 overflow-hidden"
    >
      <AnimatePresence mode="popLayout">
        {isExpanded ? (
          <motion.div key="expanded" className="flex items-center gap-[3px] min-w-0 overflow-hidden">
            {/* VIEW ALL — left side, replaces count when expanded */}
            <motion.button
              key="view-all-btn"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.15, ease: EASE_SMOOTH }}
              onClick={openModal}
              className="shrink-0 flex items-center gap-[6px] px-[8px] py-[4px] rounded-sm font-kosugi text-[10px] uppercase tracking-[0.08em] text-ops-accent hover:text-white transition-colors duration-150 whitespace-nowrap"
            >
              <span>{count}</span>
              <span className="text-text-secondary">{t("notifications.viewAll")}</span>
            </motion.button>

            {/* Collapse chevron */}
            <motion.button
              key="collapse-btn"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: EASE_SMOOTH }}
              onClick={collapse}
              className="shrink-0 p-[4px] text-text-disabled hover:text-text-secondary transition-colors duration-150"
              aria-label="Collapse notifications"
            >
              <ChevronLeft className="w-[14px] h-[14px]" />
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
          <motion.div key="collapsed" className="flex items-center gap-[3px]">
            {/* Count — left side, hover to preview, click to expand */}
            <div
              className="relative shrink-0"
              onMouseEnter={() => setCountHovered(true)}
              onMouseLeave={() => setCountHovered(false)}
            >
              <motion.button
                key="count-btn"
                className="shrink-0 font-mono text-[11px] text-text-secondary hover:text-text-primary px-[6px] py-[4px] rounded-sm transition-colors duration-150 cursor-pointer"
                onClick={expand}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: EASE_SMOOTH }}
                aria-label={`${count} notifications — click to expand`}
              >
                {count}
              </motion.button>

              {/* Hover preview — 2 most urgent notifications */}
              <AnimatePresence>
                {countHovered && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15, ease: EASE_SMOOTH }}
                    className="absolute top-full left-0 mt-[6px] z-[1000] pointer-events-none"
                  >
                    <div
                      className="flex flex-col gap-[4px] p-[6px] min-w-[220px] max-w-[280px]"
                      style={{
                        borderRadius: 4,
                        background: "rgba(10, 10, 10, 0.85)",
                        backdropFilter: "blur(16px) saturate(1.2)",
                        WebkitBackdropFilter: "blur(16px) saturate(1.2)",
                        border: "1px solid rgba(255, 255, 255, 0.10)",
                      }}
                    >
                      {urgentPreview.map((n) => (
                        <div
                          key={n.id}
                          className="px-[6px] py-[4px]"
                          style={{
                            borderLeft: n.persistent ? "2px solid var(--ops-accent, #597794)" : undefined,
                          }}
                        >
                          <p className="font-mohave text-[11px] text-text-primary text-left leading-tight truncate">
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="font-mohave text-[10px] text-text-secondary text-left leading-tight mt-[1px] line-clamp-1">
                              {n.body}
                            </p>
                          )}
                        </div>
                      ))}
                      <p className="font-kosugi text-[8px] uppercase tracking-wider text-text-disabled text-center mt-[2px]">
                        {t("notifications.clickToExpand")}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Collapsed pills — click to expand */}
            <motion.button
              key="pill-row"
              className="flex items-center gap-[3px] py-[4px] px-[4px] rounded-sm hover:brightness-110 transition-all duration-150 cursor-pointer"
              onClick={expand}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: EASE_SMOOTH }}
              aria-label={`${count} notifications — click to expand`}
            >
              {visiblePills.map((n) => (
                <NotificationPill
                  key={n.id}
                  persistent={n.persistent}
                  layoutId={`notif-pill-${n.id}`}
                  title={n.title}
                  body={n.body}
                />
              ))}

              {overflowCount > 0 && (
                <span className="font-mono text-[9px] text-text-disabled ml-[2px]">
                  +{overflowCount}
                </span>
              )}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
