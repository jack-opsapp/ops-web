"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifCardFullVariants } from "@/lib/utils/motion";
import type { AppNotification } from "@/lib/api/services/notification-service";

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

  return (
    <motion.div
      layout
      variants={notifCardFullVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="relative px-[12px] py-[10px] border-b border-[rgba(255,255,255,0.06)]"
      style={{
        borderLeft: notification.persistent
          ? "2px solid #597794"
          : undefined,
      }}
    >
      {/* Dismiss X — top right, only non-persistent */}
      {!notification.persistent && (
        <button
          onClick={() => onDismiss(notification.id)}
          className="absolute top-[8px] right-[8px] p-[2px] text-text-disabled hover:text-text-secondary transition-colors duration-150"
          aria-label="Dismiss"
        >
          <X className="w-[12px] h-[12px]" />
        </button>
      )}

      {/* Row 1: Title + timestamp */}
      <div className="flex items-center gap-[8px] pr-[20px]">
        <span className="font-mohave text-body-sm text-text-primary text-left flex-1">
          {notification.title}
        </span>
        <span className="font-mono text-[10px] text-text-disabled shrink-0">
          {formatTimestamp(notification.createdAt)}
        </span>
      </div>

      {/* Row 2: Body */}
      {notification.body && (
        <p className="font-mohave text-[12px] text-text-secondary text-left line-clamp-2 mt-[2px]">
          {notification.body}
        </p>
      )}

      {/* Row 3: Action button */}
      {notification.actionLabel && notification.actionUrl && (
        <button
          onClick={() => router.push(notification.actionUrl!)}
          className="font-kosugi text-[10px] uppercase tracking-wider text-[#597794] hover:text-text-primary transition-colors duration-150 mt-[4px]"
        >
          {notification.actionLabel}
        </button>
      )}
    </motion.div>
  );
}
