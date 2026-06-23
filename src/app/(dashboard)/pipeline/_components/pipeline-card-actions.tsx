"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Phone,
  MessageSquare,
  ExternalLink,
  StickyNote,
  ChevronDown,
  Calendar,
  UserPlus,
  Trophy,
  XCircle,
  Ban,
  Archive,
  Send,
  FolderInput,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { OpportunityStage, isActiveStage } from "@/lib/types/pipeline";

interface PipelineCardActionsProps {
  opportunityId: string;
  stage: OpportunityStage;
  canManage: boolean;
  stageActions?: React.ReactNode;
  onLogCall: () => void;
  onLogText: () => void;
  onAddNote: (note: string) => void;
  onArchive: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onDiscard: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
  onOpenDetail: () => void;
  /**
   * Convert an already-won, unconverted deal — opens the Won dialog directly.
   * Only the parent of a won + unlinked card passes this; its presence is what
   * surfaces the `// Convert` entry.
   */
  onConvert?: () => void;
}

/**
 * Card action row — rows are for scanning; verbs live in ONE labelled `ACTIONS`
 * overflow (DESIGN.md §11 — icons are metadata, not actions). Matches the Books
 * register row treatment: stage-advance affordances stay visible (moving a deal
 * is the kanban's primary verb), everything else folds behind the overflow.
 * The menu stays a portaled popover (not the Radix primitive) because cards live
 * in a drag/scroll context and the menu must open above its anchor near the
 * board's bottom edge — but the trigger + items match the shared treatment.
 */
export function PipelineCardActions({
  opportunityId: _opportunityId,
  stage,
  canManage,
  stageActions,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onMarkWon,
  onMarkLost,
  onDiscard,
  onAssign,
  onScheduleFollowUp,
  onOpenDetail,
  onConvert,
}: PipelineCardActionsProps) {
  const { t } = useDictionary("pipeline");

  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteValue, setNoteValue] = useState("");
  const [showMenu, setShowMenu] = useState(false);

  const noteInputRef = useRef<HTMLInputElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  // Auto-focus note input
  useEffect(() => {
    if (showNoteInput && noteInputRef.current) {
      noteInputRef.current.focus();
    }
  }, [showNoteInput]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!showMenu) return;
    function handleOutsideClick(e: MouseEvent) {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setShowMenu(false);
    }
    const frame = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", handleEscape);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showMenu]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleNoteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter" && noteValue.trim()) {
      onAddNote(noteValue.trim());
      setNoteValue("");
      setShowNoteInput(false);
    } else if (e.key === "Escape") {
      setNoteValue("");
      setShowNoteInput(false);
    }
  };

  const handleMenuAction = useCallback(
    (e: React.MouseEvent, action: () => void) => {
      e.stopPropagation();
      setShowMenu(false);
      action();
    },
    []
  );

  const showActiveActions = isActiveStage(stage);
  const showConvert = stage === OpportunityStage.Won && Boolean(onConvert);

  return (
    <div onClick={stop} onMouseDown={stop}>
      {/* Stage affordances (left) + one labelled ACTIONS overflow (right) */}
      <div
        data-testid="pipeline-card-action-row"
        className="flex min-w-0 items-center justify-between gap-2"
      >
        {stageActions ? (
          <div
            data-testid="pipeline-card-stage-actions"
            className="flex min-w-0 items-center gap-[6px]"
          >
            {stageActions}
          </div>
        ) : (
          <span aria-hidden="true" />
        )}

        <div ref={menuContainerRef} className="relative flex shrink-0 justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu((prev) => !prev);
            }}
            aria-haspopup="menu"
            aria-expanded={showMenu}
            className={cn(
              "inline-flex h-[28px] items-center gap-[4px] rounded border px-[8px]",
              "font-mono text-micro font-medium uppercase tracking-[0.12em]",
              "transition-colors duration-150 ease-smooth",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
              showMenu
                ? "border-line-hi bg-surface-active text-text"
                : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2"
            )}
          >
            {t("actions.menu", "Actions")}
            <ChevronDown
              className={cn(
                "h-[12px] w-[12px] shrink-0 transition-transform duration-150",
                showMenu && "rotate-180"
              )}
              strokeWidth={1.5}
            />
          </button>

          {showMenu &&
            createPortal(
              <PortaledMenu
                anchorRef={menuContainerRef}
                onClose={() => setShowMenu(false)}
              >
                <MenuItem
                  icon={<Phone size={14} />}
                  label={t("actions.logCall", "Log call")}
                  onClick={(e) => handleMenuAction(e, onLogCall)}
                  disabled={!canManage}
                />
                <MenuItem
                  icon={<MessageSquare size={14} />}
                  label={t("actions.logText", "Log text")}
                  onClick={(e) => handleMenuAction(e, onLogText)}
                  disabled={!canManage}
                />
                <MenuItem
                  icon={<StickyNote size={14} />}
                  label={t("actions.addNote", "Add note")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    setShowNoteInput(true);
                  }}
                  disabled={!canManage}
                />
                <MenuItem
                  icon={<ExternalLink size={14} />}
                  label={t("actions.openDetail", "Details")}
                  onClick={(e) => handleMenuAction(e, onOpenDetail)}
                />

                {canManage && (
                  <>
                    <MenuDivider />
                    <MenuItem
                      icon={<Calendar size={14} />}
                      label={t("actions.scheduleFollowUp", "Schedule follow-up")}
                      onClick={(e) => handleMenuAction(e, onScheduleFollowUp)}
                    />
                    <MenuItem
                      icon={<UserPlus size={14} />}
                      label={t("actions.assignTo", "Assign to")}
                      onClick={(e) => handleMenuAction(e, onAssign)}
                    />
                  </>
                )}

                {canManage && showActiveActions && (
                  <>
                    <MenuDivider />
                    <MenuItem
                      icon={<Trophy size={14} />}
                      label={t("actions.markWon", "Mark won")}
                      onClick={(e) => handleMenuAction(e, onMarkWon)}
                    />
                    <MenuItem
                      icon={<XCircle size={14} />}
                      label={t("actions.markLost", "Mark lost")}
                      onClick={(e) => handleMenuAction(e, onMarkLost)}
                    />
                    <MenuItem
                      icon={<Ban size={14} />}
                      label={t("actions.discard", "Discard")}
                      onClick={(e) => handleMenuAction(e, onDiscard)}
                    />
                  </>
                )}

                {canManage && showConvert && (
                  <>
                    <MenuDivider />
                    <MenuItem
                      icon={<FolderInput size={14} />}
                      label={t("actions.convert", "Convert")}
                      onClick={(e) => handleMenuAction(e, onConvert!)}
                      testId="card-action-convert"
                    />
                  </>
                )}

                {canManage && (
                  <>
                    <MenuDivider />
                    <MenuItem
                      icon={<Archive size={14} />}
                      label={t("actions.archive", "Archive")}
                      onClick={(e) => handleMenuAction(e, onArchive)}
                    />
                  </>
                )}
              </PortaledMenu>,
              document.body
            )}
        </div>
      </div>

      {/* Inline note input — submit button lives inside the input gutter so
          it can never be clipped by narrow card widths */}
      {showNoteInput && (
        <div className="relative mt-[4px]">
          <input
            ref={noteInputRef}
            type="text"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onClick={stop}
            onKeyDown={handleNoteKeyDown}
            placeholder={t("actions.notePlaceholder", "Type a note...")}
            className="w-full rounded-panel border border-line bg-fill-neutral-dim py-[4px] pl-[6px] pr-[26px] font-mohave text-caption-sm text-text outline-none transition-colors duration-150 placeholder:text-text-3 focus:border-line-hi"
          />
          <button
            type="button"
            aria-label={t("card.confirm", "Confirm")}
            onClick={(e) => {
              e.stopPropagation();
              if (!noteValue.trim()) return;
              onAddNote(noteValue.trim());
              setNoteValue("");
              setShowNoteInput(false);
            }}
            disabled={!noteValue.trim()}
            className="absolute right-[3px] top-1/2 -translate-y-1/2 rounded-panel p-[3px] text-text-2 transition-colors hover:bg-surface-active hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Send className="h-[12px] w-[12px]" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function PortaledMenu({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      // Position above the anchor, right-aligned (cards sit near the board edge).
      setPos({
        x: Math.max(0, rect.right - 200),
        y: Math.max(0, rect.top - 4),
      });
    }
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    const frame = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleClick);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose, anchorRef]);

  return (
    <div
      ref={menuRef}
      role="menu"
      className="glass-dense fixed z-[3000] min-w-[200px] overflow-hidden p-0.5 [&::before]:rounded-modal"
      style={{
        left: pos.x,
        top: pos.y,
        transform: "translateY(-100%)",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  testId?: string;
}) {
  if (disabled) return null;
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      className="flex w-full cursor-pointer select-none items-center gap-[8px] rounded-sm px-[8px] py-[6px] font-mohave text-body-sm text-text-2 transition-colors duration-100 hover:bg-fill-neutral-dim hover:text-text"
    >
      <span className="shrink-0 text-text-3">{icon}</span>
      {label}
    </button>
  );
}

function MenuDivider() {
  return <div className="-mx-0.5 my-0.5 h-px bg-border" />;
}
