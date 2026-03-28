"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone,
  MessageSquare,
  Mail,
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
          icon={<Mail className="w-[12px] h-[12px]" />}
          label={t("actions.email")}
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

          {showMore && (
            <div
              className="absolute bottom-full right-0 mb-[4px] z-50 min-w-[180px] rounded-[4px] p-[4px]"
              style={{
                background: "rgba(10, 10, 10, 0.90)",
                backdropFilter: "blur(20px) saturate(1.2)",
                WebkitBackdropFilter: "blur(20px) saturate(1.2)",
                border: "1px solid rgba(255, 255, 255, 0.10)",
              }}
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
            </div>
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
            className="flex-1 min-w-0 px-[6px] py-[4px] rounded-[3px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] font-mohave text-caption-sm text-text-primary placeholder:text-text-placeholder focus:border-[rgba(255,255,255,0.2)] focus:outline-none"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (noteValue.trim()) onAddNote(noteValue.trim());
              setNoteValue("");
              setShowNoteInput(false);
            }}
            disabled={!noteValue.trim()}
            className="px-[6px] py-[4px] rounded-[3px] bg-ops-accent/20 text-ops-accent font-kosugi text-micro-xs uppercase tracking-wider hover:bg-ops-accent/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
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
          : "text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)]",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      {icon}
    </button>
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
      className="flex items-center gap-[8px] w-full px-[8px] py-[5px] font-mohave text-caption-sm text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[3px] transition-colors cursor-pointer"
    >
      <span className="text-text-tertiary shrink-0">{icon}</span>
      {label}
    </button>
  );
}
