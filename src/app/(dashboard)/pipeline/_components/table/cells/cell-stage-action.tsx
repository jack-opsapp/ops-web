"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  getActiveStages,
  getStageDisplayName,
  OPPORTUNITY_STAGE_COLORS,
  OpportunityStage,
  type OpportunityStage as OpportunityStageType,
} from "@/lib/types/pipeline";
import { CellStage } from "./cell-stage";

/**
 * The stages selectable from the table's stage cell, in pipeline order:
 * every active stage, then the terminal Won / Lost. Mirrors the focused card's
 * `FOCUSED_STAGE_REASSIGN_ORDER` so both surfaces offer the same destinations.
 * Discarded is intentionally omitted here — like the focused reassign menu, it
 * is not a menu destination (discard is a distinct gesture in focused mode).
 */
const STAGE_MENU_ORDER: OpportunityStageType[] = [
  ...getActiveStages(),
  OpportunityStage.Won,
  OpportunityStage.Lost,
];

/**
 * Actionable stage cell for the pipeline table. The chip reuses {@link CellStage}'s
 * visual (a stage-colored dot + the stage label). When the operator can manage
 * the pipeline it becomes a button that opens a listbox of selectable stages;
 * choosing one calls {@link onSelectStage}. The selection is NEVER a silent
 * write — the shell routes it through the shared transition hook, so active
 * stages move directly (toast + undo) and Won / Lost open the terminal dialog.
 *
 * Without `pipeline.manage` the cell is the plain read-only chip — no button,
 * no menu. Idiom mirrors `projects` table-v2 `EditableCellStatus`: a trigger
 * button with `aria-haspopup="listbox"`, a `role="listbox"` popover of
 * `role="option"` rows, click-outside (`mousedown`) + Escape to close, and
 * `stopPropagation` on every interaction so the row's open-detail click and the
 * inline-edit affordances never fire underneath the menu.
 */
export function CellStageAction({
  stage,
  onSelectStage,
  canManage,
  wonUnconverted = false,
  onConvert,
}: {
  stage: OpportunityStageType;
  onSelectStage: (next: OpportunityStageType) => void;
  canManage: boolean;
  /** This row is `won` but has no linked project yet — offer `// CONVERT`. */
  wonUnconverted?: boolean;
  /** Opens the Won dialog to convert the already-won row (no re-win). */
  onConvert?: () => void;
}) {
  const { t } = useDictionary("pipeline");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: globalThis.MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // Read-only: lacking pipeline.manage renders the static chip, no affordance.
  if (!canManage) {
    return <CellStage stage={stage} />;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  function handleSelect(
    event: ReactMouseEvent<HTMLButtonElement>,
    next: OpportunityStageType,
  ) {
    event.stopPropagation();
    setOpen(false);
    if (next === stage) return;
    onSelectStage(next);
  }

  const triggerLabel = t("table.cell.stage.triggerLabel");
  const menuLabel = t("table.cell.stage.title");

  return (
    <div
      ref={menuRef}
      className="relative flex h-full w-full min-w-0 items-center"
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        data-testid="cell-stage-trigger"
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="flex h-full w-full min-w-0 items-center rounded-[5px] px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent"
      >
        <CellStage stage={stage} />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={menuLabel}
          className="glass-dense absolute left-0 top-full z-[1000] mt-1 min-w-[176px] rounded-modal border border-border p-1"
        >
          {STAGE_MENU_ORDER.map((option) => {
            const selected = option === stage;
            const color =
              OPPORTUNITY_STAGE_COLORS[option] ?? "#8A8A8A";
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={(event) => handleSelect(event, option)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-[6px] rounded-chip px-2 py-1.5 text-left font-mono text-micro uppercase tracking-wider transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                  selected ? "bg-surface-active text-text" : "text-text-2",
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{getStageDisplayName(option)}</span>
              </button>
            );
          })}

          {wonUnconverted && onConvert ? (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                data-testid="cell-stage-convert"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  onConvert();
                }}
                className="flex w-full min-w-0 items-center gap-[6px] rounded-chip px-2 py-1.5 text-left font-mono text-micro uppercase tracking-wider text-text-2 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
              >
                <span aria-hidden="true" className="text-text-mute">
                  {"//"}
                </span>
                <span className="truncate">
                  {t("table.cell.stage.convert", "Convert")}
                </span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
