"use client";

import { motion, useReducedMotion } from "framer-motion";
import { notifPillVariants, notifPillVariantsReduced } from "@/lib/utils/motion";

interface NotificationPillProps {
  persistent: boolean;
  layoutId: string;
}

export function NotificationPill({ persistent, layoutId }: NotificationPillProps) {
  const reducedMotion = useReducedMotion();
  const variants = reducedMotion ? notifPillVariantsReduced : notifPillVariants;

  return (
    <motion.div
      layout
      layoutId={layoutId}
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="shrink-0 h-[14px] rounded-full"
      style={{
        width: 6,
        backgroundColor: persistent
          ? "#597794"
          : "rgba(255, 255, 255, 0.20)",
      }}
    />
  );
}
