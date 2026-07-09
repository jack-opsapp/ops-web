"use client";

import { toast } from "@/components/ui/toast";

/** Show a widget action toast with undo button — returns toast id for dismissal */
export function showWidgetActionToast(options: {
  label: string;
  onUndo: () => void;
  /** How long the toast is visible (default 30s) */
  duration?: number;
}): string | number {
  return toast(options.label, {
    duration: options.duration ?? 30_000,
    action: {
      label: "Undo",
      onClick: options.onUndo,
    },
  });
}
