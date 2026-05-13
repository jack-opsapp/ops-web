"use client";

import { useEffect, useMemo, useState, type FocusEvent } from "react";
import { useDictionary } from "@/i18n/client";
import type { ProjectTableUndoEntry } from "@/lib/hooks/projects-table/use-cell-edit";
import type { ProjectTableEditableColumnId } from "@/lib/types/project-table";

const UNDO_DISMISS_DELAY_MS = 10_000;

const COLUMN_LABEL_KEYS = {
  name: "table.column.name",
  status: "table.column.status",
  address: "table.column.address",
  start_date: "table.column.startDate",
  end_date: "table.column.endDate",
} as const satisfies Record<ProjectTableEditableColumnId, string>;

function interpolateDictionaryTemplate(
  template: string,
  params: Record<string, string>,
) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => params[key] ?? match);
}

export function ProjectsUndoToast({
  entry,
  onUndo,
  onDismiss,
}: {
  entry: ProjectTableUndoEntry | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const { t } = useDictionary("projects");
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
    return interpolateDictionaryTemplate(t("table.undo.body"), {
      column: t(COLUMN_LABEL_KEYS[entry.columnId]),
      project: entry.projectTitle,
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
          <p className="font-mono text-micro uppercase tracking-wider text-text">
            {t("table.undo.toastTitle")}
          </p>
          <p className="mt-0.5 truncate font-mohave text-body-sm text-text-2">
            {body}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onUndo}
            className="rounded-[5px] border border-border px-2 py-1 font-cakemono text-[12px] font-light uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          >
            {t("table.undo.action")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-[5px] px-2 py-1 font-cakemono text-[12px] font-light uppercase text-text-mute transition-colors hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          >
            {t("table.undo.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
