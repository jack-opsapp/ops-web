"use client";

/**
 * showUndoToast — the ONE undo toast for OPS-Web, on the canonical Sonner
 * wrapper (`@/components/ui/toast`).
 *
 * Every mutation that offers undo (table cell edits, bulk status changes,
 * widget quick-actions, inbox triage) renders through this helper so undo
 * affordances share the tokenized surface: glass-dense, 3px status rail,
 * uppercase Mohave title, mono description, accent-bordered action button.
 *
 * Sonner provides hover-pause, stacking, Esc dismissal, and `role="status"`
 * announcements for free — none of that is re-implemented here.
 *
 * Callers keep their own undo-entry state (it drives the mutation); this
 * helper owns only the presentation. `onDismiss` fires when the toast leaves
 * the screen for any reason other than programmatic `toast.dismiss` — manual
 * close or auto-close — so callers can release that state.
 */

import { toast } from "@/components/ui/toast";

const DEFAULT_UNDO_DURATION_MS = 10_000;

export interface UndoToastOptions {
  /** Uppercase tactical headline, e.g. `t("table.undo.label")`. */
  title: string;
  /** Optional sentence-case detail line naming the thing that changed. */
  description?: string;
  /** Localized action label — always pass through the dictionary. */
  undoLabel: string;
  /** Invoked when the user clicks the undo action. */
  onUndo: () => void | Promise<void>;
  /**
   * Optional localized label for an explicit dismiss button (Sonner cancel).
   * Omit to rely on auto-close + Esc only.
   */
  dismissLabel?: string;
  /** Visibility window in ms. Defaults to 10s (Sonner pauses on hover). */
  duration?: number;
  /** Fired on manual dismissal AND auto-close — release undo UI state here. */
  onDismiss?: () => void;
}

export function showUndoToast({
  title,
  description,
  undoLabel,
  onUndo,
  dismissLabel,
  duration = DEFAULT_UNDO_DURATION_MS,
  onDismiss,
}: UndoToastOptions): string | number {
  return toast(title, {
    description,
    duration,
    action: {
      label: undoLabel,
      onClick: () => void onUndo(),
    },
    // Sonner dismisses on cancel click and fires onDismiss itself — the
    // click handler stays empty so state release isn't double-fired.
    cancel: dismissLabel ? { label: dismissLabel, onClick: () => {} } : undefined,
    onDismiss: onDismiss ? () => onDismiss() : undefined,
    onAutoClose: onDismiss ? () => onDismiss() : undefined,
  });
}
