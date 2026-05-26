"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { useDictionary } from "@/i18n/client";
import type { ProjectTableConflict } from "@/lib/hooks/projects-table/use-cell-edit";
import { ProjectStatus } from "@/lib/types/models";
import type {
  ProjectTableEditableColumnId,
  ProjectTableEditValue,
} from "@/lib/types/project-table";
import { formatDate } from "@/lib/utils/project-table-formatters";

const EMPTY_VALUE = "—";

const STATUS_LABEL_KEYS = {
  [ProjectStatus.RFQ]: "status.rfq",
  [ProjectStatus.Estimated]: "status.estimated",
  [ProjectStatus.Accepted]: "status.accepted",
  [ProjectStatus.InProgress]: "status.inProgress",
  [ProjectStatus.Completed]: "status.completed",
  [ProjectStatus.Closed]: "status.closed",
  [ProjectStatus.Archived]: "status.archived",
} as const satisfies Record<ProjectStatus, string>;

function isProjectStatus(value: ProjectTableEditValue): value is ProjectStatus {
  return Object.values(ProjectStatus).includes(value as ProjectStatus);
}

function isClientValue(value: ProjectTableEditValue): value is { clientId: string | null; clientName: string | null } {
  return value !== null && typeof value === "object" && "clientName" in value;
}

function formatConflictValue({
  columnId,
  value,
  t,
}: {
  columnId: ProjectTableEditableColumnId;
  value: ProjectTableEditValue;
  t: (key: string) => string;
}) {
  if (value == null) return EMPTY_VALUE;

  if (columnId === "status") {
    return isProjectStatus(value) ? t(STATUS_LABEL_KEYS[value]) : String(value);
  }

  if (columnId === "start_date" || columnId === "end_date") {
    return formatDate(typeof value === "string" ? value : null);
  }

  if (columnId === "client") {
    return isClientValue(value) ? value.clientName || EMPTY_VALUE : String(value || EMPTY_VALUE);
  }

  return String(value) || EMPTY_VALUE;
}

function ConflictValueBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-[5px] border border-border bg-surface-input p-2">
      <p className="font-mono text-micro uppercase tracking-wider text-text-3">
        {label}
      </p>
      <p className="mt-1 min-h-[20px] break-words font-mohave text-body-sm text-text">
        {value}
      </p>
    </div>
  );
}

export function ProjectsConflictOverlay({
  conflict,
  currentValue,
  onUseMine,
  onUseCurrent,
  onCancel,
}: {
  conflict: ProjectTableConflict | null;
  currentValue: ProjectTableEditValue;
  onUseMine: () => void;
  onUseCurrent: () => void;
  onCancel: () => void;
}) {
  const { t } = useDictionary("projects");
  const primaryActionRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!conflict) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    primaryActionRef.current?.focus();

    return () => {
      if (
        previousFocusRef.current &&
        document.contains(previousFocusRef.current)
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [conflict]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }

    if (event.key !== "Tab") return;

    const actions = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[data-conflict-action]:not(:disabled)",
      ),
    );
    const firstAction = actions[0];
    const lastAction = actions.at(-1);
    if (!firstAction || !lastAction) return;

    if (event.shiftKey && document.activeElement === firstAction) {
      event.preventDefault();
      lastAction.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastAction) {
      event.preventDefault();
      firstAction.focus();
    }
  }

  if (!conflict) return null;

  const attemptedValue = formatConflictValue({
    columnId: conflict.columnId,
    value: conflict.attemptedValue,
    t,
  });
  const visibleCurrentValue = formatConflictValue({
    columnId: conflict.columnId,
    value: currentValue,
    t,
  });

  return (
    <div className="absolute inset-0 z-[3000] flex items-center justify-center bg-background/70 p-3">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="projects-conflict-overlay-title"
        aria-describedby="projects-conflict-overlay-body"
        onKeyDown={handleKeyDown}
        className="glass-dense w-[440px] max-w-full rounded-modal border border-border p-3"
      >
        <div className="relative">
          <p
            id="projects-conflict-overlay-title"
            className="font-mono text-micro uppercase tracking-wider text-text"
          >
            {t("table.conflict.genericTitle")}
          </p>
          <p
            id="projects-conflict-overlay-body"
            className="mt-1 font-mohave text-body-sm text-text-2"
          >
            {t("table.conflict.body")}
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ConflictValueBlock label={t("table.conflict.yourLabel")} value={attemptedValue} />
            <ConflictValueBlock label={t("table.conflict.theirLabel")} value={visibleCurrentValue} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              ref={primaryActionRef}
              type="button"
              data-conflict-action
              onClick={onUseMine}
              className="rounded-[5px] border border-border px-2 py-1.5 font-cakemono text-[12px] font-light uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
            >
              {t("table.conflict.useMine")}
            </button>
            <button
              type="button"
              data-conflict-action
              onClick={onUseCurrent}
              className="rounded-[5px] border border-border px-2 py-1.5 font-cakemono text-[12px] font-light uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
            >
              {t("table.conflict.useTheirs")}
            </button>
            <button
              type="button"
              data-conflict-action
              onClick={onCancel}
              className="rounded-[5px] px-2 py-1.5 font-cakemono text-[12px] font-light uppercase text-text-mute transition-colors hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
            >
              {t("table.conflict.cancel")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
