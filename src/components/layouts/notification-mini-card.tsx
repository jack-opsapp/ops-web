"use client";

import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifCardVariants, notifCardVariantsReduced } from "@/lib/utils/motion";
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
  const variants = reducedMotion ? notifCardVariantsReduced : notifCardVariants;

  return (
    <motion.div
      layout
      layoutId={`notif-${notification.id}`}
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      custom={index}
      className="shrink-0 flex items-center gap-[6px] h-[36px] px-[8px] rounded-sm snap-start"
      style={{
        width: 180,
        background: "rgba(10, 10, 10, 0.70)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderLeft: notification.persistent
          ? "2px solid #597794"
          : "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      {/* Title */}
      <span className="font-mohave text-[12px] text-text-primary truncate flex-1 text-left">
        {notification.title}
      </span>

      {/* Action button */}
      {notification.actionLabel && notification.actionUrl && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            router.push(notification.actionUrl!);
          }}
          className="shrink-0 font-kosugi text-[9px] uppercase tracking-wider text-[#597794] hover:text-text-primary transition-colors duration-150"
        >
          {notification.actionLabel}
        </button>
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
