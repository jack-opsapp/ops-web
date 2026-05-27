"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Phone,
  MessageSquare,
  ExternalLink,
  StickyNote,
  MoreHorizontal,
  Calendar,
  UserPlus,
  Trophy,
  XCircle,
  Ban,
  Archive,
  Send,
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
}

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
}: PipelineCardActionsProps) {
  const { t } = useDictionary("pipeline");

  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteValue, setNoteValue] = useState("");
  const [showMore, setShowMore] = useState(false);

  const noteInputRef = useRef<HTMLInputElement>(null);
  const moreContainerRef = useRef<HTMLDivElement>(null);

  // Auto-focus note input
  useEffect(() => {
    if (showNoteInput && noteInputRef.current) {
      noteInputRef.current.focus();
    }
  }, [showNoteInput]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!showMore) return;
    function handleOutsideClick(e: MouseEvent) {
      if (moreContainerRef.current && !moreContainerRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setShowMore(false);
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
  }, [showMore]);

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

  const handleDropdownAction = useCallback(
    (e: React.MouseEvent, action: () => void) => {
      e.stopPropagation();
      setShowMore(false);
      action();
    },
    []
  );

  return (
    <div onClick={stop} onMouseDown={stop}>
      {/* Compact icon action row */}
      <div
        data-testid="pipeline-card-action-row"
        className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-4"
      >
        <div className="flex min-w-0 items-center gap-[6px]">
          <ActionIcon
            icon={<Phone className="w-[12px] h-[12px]" />}
            label={t("actions.logCall", "Log call")}
            onClick={(e) => { e.stopPropagation(); if (canManage) onLogCall(); }}
            disabled={!canManage}
          />
          <ActionIcon
            icon={<MessageSquare className="w-[12px] h-[12px]" />}
            label={t("actions.logText", "Log text")}
            onClick={(e) => { e.stopPropagation(); if (canManage) onLogText(); }}
            disabled={!canManage}
          />
          <ActionIcon
            icon={<ExternalLink className="w-[12px] h-[12px]" />}
            label={t("actions.openDetail", "Details")}
            onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
          />
          <ActionIcon
            icon={<StickyNote className="w-[12px] h-[12px]" />}
            label={t("actions.addNote", "Add note")}
            onClick={(e) => {
              e.stopPropagation();
              if (canManage) setShowNoteInput((prev) => !prev);
            }}
            disabled={!canManage}
            isActive={showNoteInput}
          />
        </div>
        {stageActions ? (
          <div
            data-testid="pipeline-card-stage-actions"
            className="flex min-w-0 items-center justify-center gap-[6px]"
          >
            {stageActions}
          </div>
        ) : (
          <div />
        )}

        {/* More menu */}
        <div ref={moreContainerRef} className="relative flex justify-end">
          <ActionIcon
            icon={<MoreHorizontal className="w-[12px] h-[12px]" />}
            label={t("actions.more", "More")}
            onClick={(e) => { e.stopPropagation(); if (canManage) setShowMore((prev) => !prev); }}
            disabled={!canManage}
            isActive={showMore}
          />

          {showMore && createPortal(
            <PortaledDropdown
              anchorRef={moreContainerRef}
              onClose={() => setShowMore(false)}
            >
              <DropdownItem
                icon={<Calendar size={13} />}
                label={t("actions.scheduleFollowUp", "Schedule follow-up")}
                onClick={(e) => handleDropdownAction(e, onScheduleFollowUp)}
              />
              <DropdownItem
                icon={<UserPlus size={13} />}
                label={t("actions.assignTo", "Assign to")}
                onClick={(e) => handleDropdownAction(e, onAssign)}
              />
              {isActiveStage(stage) && (
                <>
                  <div className="my-[2px] border-t border-[rgba(255,255,255,0.06)]" />
                  <DropdownItem
                    icon={<Trophy size={13} />}
                    label={t("actions.markWon", "Mark won")}
                    onClick={(e) => handleDropdownAction(e, onMarkWon)}
                  />
                  <DropdownItem
                    icon={<XCircle size={13} />}
                    label={t("actions.markLost", "Mark lost")}
                    onClick={(e) => handleDropdownAction(e, onMarkLost)}
                  />
                  <DropdownItem
                    icon={<Ban size={13} />}
                    label={t("actions.discard", "Discard")}
                    onClick={(e) => handleDropdownAction(e, onDiscard)}
                  />
                </>
              )}
              <div className="my-[2px] border-t border-[rgba(255,255,255,0.06)]" />
              <DropdownItem
                icon={<Archive size={13} />}
                label={t("actions.archive", "Archive")}
                onClick={(e) => handleDropdownAction(e, onArchive)}
              />
            </PortaledDropdown>,
            document.body
          )}
        </div>
      </div>

      {/* Inline note input — submit button lives inside the input gutter so
          it can never be clipped by narrow card widths */}
      {showNoteInput && (
        <div className="mt-[4px] relative">
          <input
            ref={noteInputRef}
            type="text"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onClick={stop}
            onKeyDown={handleNoteKeyDown}
            placeholder={t("actions.notePlaceholder", "Type a note...")}
            className="w-full pl-[6px] pr-[26px] py-[4px] rounded-panel bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] font-mohave text-caption-sm text-text placeholder:text-text-3 focus:border-[rgba(255,255,255,0.2)] focus:outline-none"
          />
          <button
            type="button"
            aria-label={t("spatial.confirm", "Confirm")}
            onClick={(e) => {
              e.stopPropagation();
              if (!noteValue.trim()) return;
              onAddNote(noteValue.trim());
              setNoteValue("");
              setShowNoteInput(false);
            }}
            disabled={!noteValue.trim()}
            className="absolute right-[3px] top-1/2 -translate-y-1/2 p-[3px] rounded-panel text-text-2 hover:text-text hover:bg-[rgba(255,255,255,0.08)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-[12px] h-[12px]" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function ActionIcon({
  icon,
  label,
  onClick,
  disabled,
  isActive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "p-[5px] rounded-panel transition-colors duration-150 cursor-pointer",
        isActive
          ? "text-text bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.18)]"
          : "text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.06)] border border-transparent",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      {icon}
    </button>
  );
}

function PortaledDropdown({
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
      // Position above the anchor, right-aligned
      setPos({
        x: Math.max(0, rect.right - 180),
        y: Math.max(0, rect.top - 4),
      });
    }
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
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
      className="fixed z-[3000] min-w-[180px] rounded-[4px] p-[4px]"
      style={{
        left: pos.x,
        top: pos.y,
        transform: "translateY(-100%)",
        background: "var(--surface-glass-dense)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        border: "1px solid rgba(255, 255, 255, 0.10)",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function DropdownItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-[8px] w-full px-[8px] py-[5px] font-mohave text-caption-sm text-text-2 hover:bg-[rgba(255,255,255,0.06)] rounded-panel transition-colors cursor-pointer"
    >
      <span className="text-text-3 shrink-0">{icon}</span>
      {label}
    </button>
  );
}
