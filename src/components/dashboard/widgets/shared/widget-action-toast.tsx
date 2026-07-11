"use client";

import { showUndoToast } from "@/components/ui/toast-undo";

/**
 * Widget quick-action undo toast — a thin delegate over the shared
 * `showUndoToast` so widget undos share the tokenized surface, status rail,
 * and motion. Keeps the widget tier's longer 30s window (quick actions fire
 * from the dashboard where attention is split across widgets).
 * Returns the toast id for programmatic dismissal.
 *
 * Only for actions that genuinely support undo — plain confirmations use
 * `toast.success` from the canonical wrapper directly.
 */
export function showWidgetActionToast(options: {
  label: string;
  /** Localized undo button label — always pass through the dictionary. */
  undoLabel: string;
  onUndo: () => void;
  /** How long the toast is visible (default 30s) */
  duration?: number;
}): string | number {
  return showUndoToast({
    title: options.label,
    undoLabel: options.undoLabel,
    onUndo: options.onUndo,
    duration: options.duration ?? 30_000,
  });
}
