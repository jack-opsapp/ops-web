"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifCardFullVariants } from "@/lib/utils/motion";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";
import type { AppNotification } from "@/lib/api/services/notification-service";
import { useDictionary } from "@/i18n/client";

/**
 * Translate a notification string with graceful fallback.
 *
 * Services that emit notifications can use i18n dot-notation keys
 * (e.g. "notification.confirmedTaskRescheduled.title") as the title/body
 * and the rail component will resolve them at render time. Pre-i18n code
 * that passes raw English strings still renders correctly — the fallback
 * is "return raw if no translation exists".
 */
function translateNotif(
  raw: string | null | undefined,
  t: (key: string) => string
): string | null {
  if (!raw) return null;
  // Only attempt translation if the string looks like a dot-key
  // (contains '.', starts with a lowercase letter, no spaces). This
  // guards existing notifications whose titles contain legitimate dots
  // or sentences.
  const looksLikeKey =
    /^[a-z][a-zA-Z0-9._-]*$/.test(raw) && raw.includes(".");
  if (!looksLikeKey) return raw;
  const translated = t(raw);
  // Our useDictionary returns the key itself when not found — that means
  // "no translation". In that case we fall back to showing the raw key,
  // which is still better than a missing notification.
  return translated;
}

interface NotificationCardFullProps {
  notification: AppNotification;
  onDismiss: (id: string) => void;
}

function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "1d ago";
  return `${diffDays}d ago`;
}

export function NotificationCardFull({
  notification,
  onDismiss,
}: NotificationCardFullProps) {
  const router = useRouter();
  const closeModal = useNotificationRailStore((s) => s.closeModal);
  const openDuplicateSheet = useDuplicateReviewStore((s) => s.openSheet);
  const isDuplicateReview = notification.type === "duplicates_found";
  const { t } = useDictionary("common");

  // Translate key-shaped title/body/action if they look like i18n dot-keys
  const displayTitle = translateNotif(notification.title, t) ?? notification.title;
  const displayBody = translateNotif(notification.body, t);
  const displayActionLabel = translateNotif(notification.actionLabel, t);

  function handleCardClick() {
    if (isDuplicateReview) {
      if (!notification.persistent) {
        onDismiss(notification.id);
      }
      closeModal();
      openDuplicateSheet();
      return;
    }

    if (notification.actionUrl) {
      if (!notification.persistent) {
        onDismiss(notification.id);
      }
      closeModal();
      router.push(notification.actionUrl);
    }
  }

  return (
    <motion.div
      layout
      variants={notifCardFullVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={handleCardClick}
      className="relative px-[12px] py-[10px] border-b border-[rgba(255,255,255,0.06)]"
      style={{
        cursor: notification.actionUrl || isDuplicateReview ? "pointer" : "default",
        borderLeft: notification.persistent
          ? "2px solid var(--ops-accent, #597794)"
          : undefined,
      }}
    >
      {/* Dismiss X — top right, only non-persistent */}
      {!notification.persistent && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          className="absolute top-[8px] right-[8px] p-[2px] text-text-disabled hover:text-text-secondary transition-colors duration-150"
          aria-label="Dismiss"
        >
          <X className="w-[12px] h-[12px]" />
        </button>
      )}

      {/* Row 1: Title + timestamp */}
      <div className="flex items-center gap-[8px] pr-[20px]">
        <span className="font-mohave text-body-sm text-text-primary text-left flex-1">
          {displayTitle}
        </span>
        <span className="font-mono text-[10px] text-text-disabled shrink-0">
          {formatTimestamp(notification.createdAt)}
        </span>
      </div>

      {/* Row 2: Body */}
      {displayBody && (
        <p className="font-mohave text-[12px] text-text-secondary text-left line-clamp-2 mt-[2px]">
          {displayBody}
        </p>
      )}

      {/* Row 3: Action label (visual indicator — whole card is clickable) */}
      {(isDuplicateReview || (displayActionLabel && notification.actionUrl)) && (
        <span className="font-kosugi text-[10px] uppercase tracking-wider text-ops-accent inline-block mt-[4px]">
          {isDuplicateReview ? "REVIEW" : displayActionLabel}
        </span>
      )}
    </motion.div>
  );
}
