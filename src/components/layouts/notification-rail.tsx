"use client";

import { useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useNotifications, useDismissNotification } from "@/lib/hooks/use-notifications";
import { NotificationPill } from "./notification-pill";
import { NotificationMiniCard } from "./notification-mini-card";
import { useDictionary } from "@/i18n/client";

const MAX_VISIBLE_PILLS = 15;

export function NotificationRail() {
  const { t } = useDictionary("topbar");
  const { railState, expand, collapse, openModal } = useNotificationRailStore();
  const { data: notifications = [] } = useNotifications();
  const dismissMutation = useDismissNotification();
  const railRef = useRef<HTMLDivElement>(null);

  const isExpanded = railState === "expanded";
  const count = notifications.length;

  const handleDismiss = useCallback(
    (id: string) => dismissMutation.mutate(id),
    [dismissMutation]
  );

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

  if (count === 0) return <div />;

  const visiblePills = notifications.slice(0, MAX_VISIBLE_PILLS);
  const overflowCount = count - MAX_VISIBLE_PILLS;

  return (
    <div ref={railRef} className="flex items-center gap-[3px] h-[40px]">
      <AnimatePresence mode="popLayout">
        {isExpanded ? (
          <>
            {/* Collapse chevron */}
            <motion.button
              key="collapse-btn"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.15, ease: EASE_SMOOTH }}
              onClick={collapse}
              className="shrink-0 p-[4px] text-text-disabled hover:text-text-secondary transition-colors duration-150"
              aria-label="Collapse notifications"
            >
              <ChevronLeft className="w-[14px] h-[14px]" />
            </motion.button>

            {/* Scrollable mini cards */}
            <div className="flex items-center gap-[6px] overflow-x-auto scrollbar-hide snap-x snap-mandatory pr-[4px]">
              {notifications.map((n, i) => (
                <NotificationMiniCard
                  key={n.id}
                  notification={n}
                  index={i}
                  onDismiss={handleDismiss}
                />
              ))}

              {/* View all button */}
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.2, ease: EASE_SMOOTH }}
                onClick={openModal}
                className="shrink-0 font-kosugi text-[9px] uppercase tracking-wider text-text-disabled hover:text-text-secondary transition-colors duration-150 px-[8px] snap-start whitespace-nowrap"
              >
                {t("notifications.viewAll")}
              </motion.button>
            </div>
          </>
        ) : (
          <>
            {/* Collapsed pills — click to expand */}
            <motion.button
              key="pill-row"
              className="flex items-center gap-[3px] py-[4px] px-[4px] rounded-sm hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 cursor-pointer"
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
                />
              ))}

              {overflowCount > 0 && (
                <span className="font-mono text-[9px] text-text-disabled ml-[2px]">
                  +{overflowCount}
                </span>
              )}
            </motion.button>

            {/* Count label */}
            <span className="font-mono text-[10px] text-text-disabled ml-[4px]">
              {count}
            </span>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
