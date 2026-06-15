"use client";

import { useEffect, useMemo, useState, type FocusEvent } from "react";
import { useDictionary } from "@/i18n/client";
import type {
  OpportunityCellUndoEntry,
} from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import type { PipelineTableEditableColumnId } from "@/lib/types/pipeline-table";

const UNDO_DISMISS_DELAY_MS = 10_000;

/** Editable column id → its `table.column.<id>` dictionary key. */
const COLUMN_LABEL_KEYS = {
  value: "table.column.value",
  next_follow_up: "table.column.next_follow_up",
  expected_close: "table.column.expected_close",
  assignee: "table.column.assignee",
} as const satisfies Record<PipelineTableEditableColumnId, string>;

function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => params[key] ?? match);
}

/**
 * Minimal pipeline-scoped undo toast. Mirrors the projects undo-toast visual
 * shell (glass-dense panel, tactical `//` voice, Undo + Dismiss buttons,
 * auto-dismiss after 10s, paused while hovered/focused) but is typed against
 * {@link OpportunityCellUndoEntry} and reads pipeline copy. Inlined rather than
 * reusing `ProjectsUndoToast` because that toast is coupled to the project undo
 * entry shape (incl. bulk entries) and `useDictionary("projects")`.
 */
export function PipelineUndoToast({
  entry,
  onUndo,
  onDismiss,
}: {
  entry: OpportunityCellUndoEntry | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const { t } = useDictionary("pipeline");
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const paused = hovered || focusedWithin;

  useEffect(() => {
    setHovered(false);
    setFocusedWithin(false);
  }, [entry?.id]);

  useEffect(() => {
    if (!entry || paused) return;
    const timeout = window.setTimeout(onDismiss, UNDO_DISMISS_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [entry, onDismiss, paused]);

  const body = useMemo(() => {
    if (!entry) return "";
    return interpolate(t("table.undo.body"), {
      column: t(COLUMN_LABEL_KEYS[entry.columnId]),
      deal: entry.dealTitle,
    });
  }, [entry, t]);

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    setFocusedWithin(false);
  }

  if (!entry) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusedWithin(true)}
      onBlurCapture={handleBlur}
      className="glass-dense absolute bottom-3 left-3 z-[1500] flex w-[360px] max-w-[calc(100%-24px)] overflow-hidden rounded-modal border border-border"
    >
      <div aria-hidden className="w-1 shrink-0" style={{ backgroundColor: "var(--text-2)" }} />
      <div className="relative flex min-w-0 flex-1 flex-col gap-2 p-2.5">
        <div className="min-w-0">
          <p className="font-mono text-micro uppercase tracking-[0.16em] text-text">
            {t("table.undo.label")}
          </p>
          <p className="mt-0.5 truncate font-mohave text-body-sm text-text-2">{body}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onUndo}
            className="rounded-[5px] border border-border px-2 py-1 font-cakemono text-cake-button font-light uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          >
            {t("table.undo.action")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-[5px] px-2 py-1 font-cakemono text-cake-button font-light uppercase text-text-mute transition-colors hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          >
            {t("table.undo.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
