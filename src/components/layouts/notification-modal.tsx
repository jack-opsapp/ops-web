"use client";

import { useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, BellOff } from "lucide-react";
import { notifModalVariants, notifBackdropVariants } from "@/lib/utils/motion";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useNotifications, useDismissNotification, useDismissAllNotifications } from "@/lib/hooks/use-notifications";
import { NotificationCardFull } from "./notification-card-full";
import { useDictionary } from "@/i18n/client";
import type { AppNotification } from "@/lib/api/services/notification-service";

function groupByDate(
  notifications: AppNotification[],
  t: (key: string) => string
): { label: string; items: AppNotification[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);

  const groups: Record<string, AppNotification[]> = {};
  const order: string[] = [];

  for (const n of notifications) {
    const created = new Date(n.createdAt);
    let label: string;
    if (created >= today) {
      label = t("notifications.today");
    } else if (created >= yesterday) {
      label = t("notifications.yesterday");
    } else {
      label = t("notifications.earlier");
    }
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(n);
  }

  return order.map((label) => ({ label, items: groups[label] }));
}

export function NotificationModal() {
  const { t } = useDictionary("topbar");
  const { modalOpen, closeModal } = useNotificationRailStore();
  const { data: notifications = [] } = useNotifications();
  const dismissMutation = useDismissNotification();
  const dismissAllMutation = useDismissAllNotifications();

  // Sort newest first for modal view
  const sorted = useMemo(
    () => [...notifications].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [notifications]
  );

  const grouped = useMemo(() => groupByDate(sorted, t), [sorted, t]);

  const hasDismissible = sorted.some((n) => !n.persistent);

  const handleDismiss = useCallback(
    (id: string) => dismissMutation.mutate(id),
    [dismissMutation]
  );

  const handleDismissAll = useCallback(
    () => dismissAllMutation.mutate(),
    [dismissAllMutation]
  );

  return (
    <AnimatePresence>
      {modalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            variants={notifBackdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-[100]"
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
            onClick={closeModal}
          />

          {/* Modal */}
          <motion.div
            variants={notifModalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed z-[101] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[480px] max-h-[70vh] flex flex-col rounded-sm"
            style={{
              background: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-[12px] py-[10px] border-b border-[rgba(255,255,255,0.08)] shrink-0">
              <h2 className="font-mohave text-body-lg text-text-primary font-medium text-left">
                {t("notifications.title")}
              </h2>
              <div className="flex items-center gap-[8px]">
                {hasDismissible && (
                  <button
                    onClick={handleDismissAll}
                    className="font-kosugi text-[10px] uppercase tracking-wider text-text-disabled hover:text-text-secondary transition-colors duration-150"
                  >
                    {t("notifications.dismissAll")}
                  </button>
                )}
                <button
                  onClick={closeModal}
                  className="p-[4px] text-text-disabled hover:text-text-secondary transition-colors duration-150"
                  aria-label="Close"
                >
                  <X className="w-[14px] h-[14px]" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
              {sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 px-4 gap-2">
                  <BellOff className="w-[28px] h-[28px] text-text-disabled" />
                  <p className="font-kosugi text-[11px] text-text-disabled uppercase tracking-widest text-center">
                    {t("notifications.empty")}
                  </p>
                  <p className="font-mohave text-body-sm text-text-disabled text-center">
                    {t("notifications.emptyHint")}
                  </p>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {grouped.map((group) => (
                    <div key={group.label}>
                      {/* Group label */}
                      <div className="px-[12px] pt-[10px] pb-[4px]">
                        <span className="font-kosugi text-[10px] uppercase tracking-widest text-text-tertiary">
                          {group.label}
                        </span>
                      </div>

                      {/* Cards */}
                      {group.items.map((n) => (
                        <NotificationCardFull
                          key={n.id}
                          notification={n}
                          onDismiss={handleDismiss}
                        />
                      ))}
                    </div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
