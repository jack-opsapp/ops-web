"use client";

import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifCardVariants, notifCardVariantsReduced } from "@/lib/utils/motion";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";
import type { AppNotification } from "@/lib/api/services/notification-service";
import { useDictionary } from "@/i18n/client";

/**
 * Translate a notification string with graceful fallback. Mirrors the helper
 * in notification-card-full.tsx — keep in sync if behavior changes.
 */
function translateNotif(
  raw: string | null | undefined,
  t: (key: string) => string
): string | null {
  if (!raw) return null;
  const looksLikeKey =
    /^[a-z][a-zA-Z0-9._-]*$/.test(raw) && raw.includes(".");
  if (!looksLikeKey) return raw;
  return t(raw);
}

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
  const isDuplicateReview = notification.type === "duplicates_found";
  const hasAction = isDuplicateReview || (notification.actionUrl && notification.actionLabel);

  const { t } = useDictionary("common");
  const displayTitle = translateNotif(notification.title, t) ?? notification.title;
  const displayActionLabel = translateNotif(notification.actionLabel, t);

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
        cursor: notification.actionUrl || isDuplicateReview ? "pointer" : "default",
        background: "var(--surface-glass)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderLeft: notification.persistent
          ? "2px solid rgba(255, 255, 255, 0.30)"
          : "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      {/* Title */}
      <span className="font-mohave text-[12px] text-text truncate flex-1 text-left">
        {displayTitle}
      </span>

      {/* Action label (visual indicator only — whole card is clickable) */}
      {hasAction && (
        <span className="shrink-0 font-mono text-micro uppercase tracking-wider text-text">
          {isDuplicateReview ? "Review" : displayActionLabel}
        </span>
      )}

      {/* Dismiss button — only on non-persistent */}
      {!notification.persistent && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          className="shrink-0 p-[2px] text-text-mute hover:text-text-2 transition-colors duration-150"
          aria-label="Dismiss"
        >
          <X className="w-[12px] h-[12px]" />
        </button>
      )}
    </motion.div>
  );
}
