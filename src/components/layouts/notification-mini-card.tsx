"use client";

import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifCardVariants, notifCardVariantsReduced } from "@/lib/utils/motion";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";
import type { AppNotification } from "@/lib/api/services/notification-service";

interface NotificationMiniCardProps {
  notification: AppNotification;
  index: number;
  onDismiss: (id: string) => void;
}

export function NotificationMiniCard({
  notification,
  index,
  onDismiss,
}: NotificationMiniCardProps) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const collapse = useNotificationRailStore((s) => s.collapse);
  const variants = reducedMotion ? notifCardVariantsReduced : notifCardVariants;
  const hasAction = notification.actionUrl && notification.actionLabel;

  const openDuplicateSheet = useDuplicateReviewStore((s) => s.openSheet);

  function handleCardClick() {
    // Duplicate review notifications open a sheet instead of navigating
    if (notification.type === "duplicates_found") {
      if (!notification.persistent) {
        onDismiss(notification.id);
      }
      collapse();
      openDuplicateSheet();
      return;
    }

    if (notification.actionUrl) {
      if (!notification.persistent) {
        onDismiss(notification.id);
      }
      collapse();
      router.push(notification.actionUrl);
    }
  }

  return (
    <motion.div
      layout
      layoutId={`notif-${notification.id}`}
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      custom={index}
      onClick={handleCardClick}
      className="shrink-0 flex items-center gap-[6px] h-[40px] px-[8px] rounded-[4px] snap-start w-max max-w-[240px]"
      style={{
        cursor: notification.actionUrl ? "pointer" : "default",
        background: "rgba(10, 10, 10, 0.70)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderLeft: notification.persistent
          ? "2px solid var(--ops-accent, #597794)"
          : "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      {/* Title */}
      <span className="font-mohave text-[12px] text-text-primary truncate flex-1 text-left">
        {notification.title}
      </span>

      {/* Action label (visual indicator only — whole card is clickable) */}
      {hasAction && (
        <span className="shrink-0 font-kosugi text-[9px] uppercase tracking-wider text-ops-accent">
          {notification.actionLabel}
        </span>
      )}

      {/* Dismiss button — only on non-persistent */}
      {!notification.persistent && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          className="shrink-0 p-[2px] text-text-disabled hover:text-text-secondary transition-colors duration-150"
          aria-label="Dismiss"
        >
          <X className="w-[12px] h-[12px]" />
        </button>
      )}
    </motion.div>
  );
}
