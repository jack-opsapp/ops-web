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
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { OpportunityStage, isActiveStage } from "@/lib/types/pipeline";

interface PipelineCardActionsProps {
  opportunityId: string;
  stage: OpportunityStage;
  canManage: boolean;
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
      <div className="flex items-center gap-[2px]">
        <ActionIcon
          icon={<Phone className="w-[12px] h-[12px]" />}
          label={t("actions.logCall")}
          onClick={(e) => { e.stopPropagation(); if (canManage) onLogCall(); }}
          disabled={!canManage}
        />
        <ActionIcon
          icon={<MessageSquare className="w-[12px] h-[12px]" />}
          label={t("actions.logText")}
          onClick={(e) => { e.stopPropagation(); if (canManage) onLogText(); }}
          disabled={!canManage}
        />
        <ActionIcon
          icon={<ExternalLink className="w-[12px] h-[12px]" />}
          label={t("actions.openDetail")}
          onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
        />
        <ActionIcon
          icon={<StickyNote className="w-[12px] h-[12px]" />}
          label={t("actions.addNote")}
          onClick={(e) => {
            e.stopPropagation();
            if (canManage) setShowNoteInput((prev) => !prev);
          }}
          disabled={!canManage}
          isActive={showNoteInput}
        />

        {/* Spacer pushes More to the right */}
        <div className="flex-1" />

        {/* More menu */}
        <div ref={moreContainerRef} className="relative">
          <ActionIcon
            icon={<MoreHorizontal className="w-[12px] h-[12px]" />}
            label={t("actions.more")}
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
                label={t("actions.scheduleFollowUp")}
                onClick={(e) => handleDropdownAction(e, onScheduleFollowUp)}
              />
              <DropdownItem
                icon={<UserPlus size={13} />}
                label={t("actions.assignTo")}
                onClick={(e) => handleDropdownAction(e, onAssign)}
              />
              {isActiveStage(stage) && (
                <>
                  <div className="my-[2px] border-t border-[rgba(255,255,255,0.06)]" />
                  <DropdownItem
                    icon={<Trophy size={13} />}
                    label={t("actions.markWon")}
                    onClick={(e) => handleDropdownAction(e, onMarkWon)}
                  />
                  <DropdownItem
                    icon={<XCircle size={13} />}
                    label={t("actions.markLost")}
                    onClick={(e) => handleDropdownAction(e, onMarkLost)}
                  />
                  <DropdownItem
                    icon={<Ban size={13} />}
                    label={t("actions.discard")}
                    onClick={(e) => handleDropdownAction(e, onDiscard)}
                  />
                </>
              )}
              <div className="my-[2px] border-t border-[rgba(255,255,255,0.06)]" />
              <DropdownItem
                icon={<Archive size={13} />}
                label={t("actions.archive")}
                onClick={(e) => handleDropdownAction(e, onArchive)}
              />
            </PortaledDropdown>,
            document.body
          )}
        </div>
      </div>

      {/* Inline note input */}
      {showNoteInput && (
        <div className="mt-[4px] flex gap-[3px]">
          <input
            ref={noteInputRef}
            type="text"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onClick={stop}
            onKeyDown={handleNoteKeyDown}
            placeholder={t("actions.notePlaceholder")}
            className="flex-1 min-w-0 px-[6px] py-[4px] rounded-[3px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] font-mohave text-caption-sm text-text placeholder:text-text-3 focus:border-[rgba(255,255,255,0.2)] focus:outline-none"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (noteValue.trim()) onAddNote(noteValue.trim());
              setNoteValue("");
              setShowNoteInput(false);
            }}
            disabled={!noteValue.trim()}
            className="px-[6px] py-[4px] rounded-[3px] bg-ops-accent/20 text-ops-accent font-kosugi text-micro uppercase tracking-wider hover:bg-ops-accent/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {t("spatial.confirm")}
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
      className={cn(
        "p-[5px] rounded-[3px] transition-colors duration-150 cursor-pointer",
        isActive
          ? "text-ops-accent bg-ops-accent-muted/20"
          : "text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.06)]",
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
        background: "rgba(10, 10, 10, 0.90)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
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
      className="flex items-center gap-[8px] w-full px-[8px] py-[5px] font-mohave text-caption-sm text-text-2 hover:bg-[rgba(255,255,255,0.06)] rounded-[3px] transition-colors cursor-pointer"
    >
      <span className="text-text-3 shrink-0">{icon}</span>
      {label}
    </button>
  );
}
