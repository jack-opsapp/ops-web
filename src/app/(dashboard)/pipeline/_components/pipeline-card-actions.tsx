"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone,
  MessageSquare,
  FileText,
  MoreHorizontal,
  Calendar,
  UserPlus,
  Trophy,
  XCircle,
  Archive,
  Trash2,
} from "lucide-react";
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
  onAssign,
  onScheduleFollowUp,
  onOpenDetail,
}: PipelineCardActionsProps) {
  const { t } = useDictionary("pipeline");

  const [callFlash, setCallFlash] = useState(false);
  const [textFlash, setTextFlash] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteValue, setNoteValue] = useState("");
  const [showMore, setShowMore] = useState(false);

  const noteInputRef = useRef<HTMLInputElement>(null);
  const moreContainerRef = useRef<HTMLDivElement>(null);

  // Auto-focus note input when it appears
  useEffect(() => {
    if (showNoteInput && noteInputRef.current) {
      noteInputRef.current.focus();
    }
  }, [showNoteInput]);

  // Close dropdown on outside click — uses the entire More container as boundary
  useEffect(() => {
    if (!showMore) return;

    function handleOutsideClick(e: MouseEvent) {
      if (
        moreContainerRef.current &&
        !moreContainerRef.current.contains(e.target as Node)
      ) {
        setShowMore(false);
      }
    }

    // Delay registration by one frame to avoid catching the click that opened it
    const frame = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleOutsideClick);
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [showMore]);

  // -- Handlers (all stop propagation to prevent card collapse) --

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleCallClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!canManage) return;
      onLogCall();
      setCallFlash(true);
      setTimeout(() => setCallFlash(false), 150);
    },
    [canManage, onLogCall]
  );

  const handleTextClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!canManage) return;
      onLogText();
      setTextFlash(true);
      setTimeout(() => setTextFlash(false), 150);
    },
    [canManage, onLogText]
  );

  const handleNoteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!canManage) return;
      setShowNoteInput((prev) => !prev);
      if (showNoteInput) {
        setNoteValue("");
      }
    },
    [canManage, showNoteInput]
  );

  function handleNoteKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.key === "Enter") {
      if (noteValue.trim()) {
        onAddNote(noteValue.trim());
      }
      setNoteValue("");
      setShowNoteInput(false);
    } else if (e.key === "Escape") {
      setNoteValue("");
      setShowNoteInput(false);
    }
  }

  const handleMoreClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!canManage) return;
      setShowMore((prev) => !prev);
    },
    [canManage]
  );

  const handleDropdownAction = useCallback(
    (e: React.MouseEvent, action: () => void) => {
      e.stopPropagation();
      setShowMore(false);
      action();
    },
    []
  );

  const buttonBase =
    "flex-1 flex flex-col items-center gap-[2px] py-[8px] rounded-[4px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.10)] transition-all duration-150 cursor-pointer";

  const disabledClass = !canManage ? "opacity-50 pointer-events-none" : "";

  return (
    <div onClick={stop} onMouseDown={stop}>
      {/* Action bar */}
      <div className="flex items-center gap-[6px]">
        {/* Call button */}
        <button
          type="button"
          onClick={handleCallClick}
          className={[
            buttonBase,
            disabledClass,
            callFlash ? "bg-[rgba(165,179,104,0.2)]" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <Phone size={16} className="text-text-tertiary" />
          <span className="font-kosugi text-micro-sm text-text-disabled">
            {t("actions.call")}
          </span>
        </button>

        {/* Text button */}
        <button
          type="button"
          onClick={handleTextClick}
          className={[
            buttonBase,
            disabledClass,
            textFlash ? "bg-[rgba(165,179,104,0.2)]" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <MessageSquare size={16} className="text-text-tertiary" />
          <span className="font-kosugi text-micro-sm text-text-disabled">
            {t("actions.text")}
          </span>
        </button>

        {/* Note button */}
        <button
          type="button"
          onClick={handleNoteClick}
          className={[buttonBase, disabledClass].filter(Boolean).join(" ")}
        >
          <FileText size={16} className="text-text-tertiary" />
          <span className="font-kosugi text-micro-sm text-text-disabled">
            {t("actions.note")}
          </span>
        </button>

        {/* More button + dropdown */}
        <div ref={moreContainerRef} className="flex-1 relative">
          <button
            type="button"
            onClick={handleMoreClick}
            className={[
              "w-full flex flex-col items-center gap-[2px] py-[8px] rounded-[4px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.10)] transition-all duration-150 cursor-pointer",
              disabledClass,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <MoreHorizontal size={16} className="text-text-tertiary" />
            <span className="font-kosugi text-micro-sm text-text-disabled">
              {t("actions.more")}
            </span>
          </button>

          {/* Dropdown */}
          {showMore && (
            <div
              className="absolute top-full right-0 mt-[4px] z-10 min-w-[180px] bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)_saturate(1.2)] border border-[rgba(255,255,255,0.08)] rounded-[4px] p-[4px]"
            >
              <button
                type="button"
                onClick={(e) => handleDropdownAction(e, onScheduleFollowUp)}
                className="flex items-center gap-[8px] w-full px-[10px] py-[6px] font-mohave text-body-sm text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[4px] transition-colors"
              >
                <Calendar size={14} className="shrink-0" />
                {t("actions.scheduleFollowUp")}
              </button>

              <button
                type="button"
                onClick={(e) => handleDropdownAction(e, onAssign)}
                className="flex items-center gap-[8px] w-full px-[10px] py-[6px] font-mohave text-body-sm text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[4px] transition-colors"
              >
                <UserPlus size={14} className="shrink-0" />
                {t("actions.assignTo")}
              </button>

              {isActiveStage(stage) && (
                <button
                  type="button"
                  onClick={(e) => handleDropdownAction(e, onMarkWon)}
                  className="flex items-center gap-[8px] w-full px-[10px] py-[6px] font-mohave text-body-sm text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[4px] transition-colors"
                >
                  <Trophy size={14} className="shrink-0" />
                  {t("actions.markWon")}
                </button>
              )}

              {isActiveStage(stage) && (
                <button
                  type="button"
                  onClick={(e) => handleDropdownAction(e, onMarkLost)}
                  className="flex items-center gap-[8px] w-full px-[10px] py-[6px] font-mohave text-body-sm text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[4px] transition-colors"
                >
                  <XCircle size={14} className="shrink-0" />
                  {t("actions.markLost")}
                </button>
              )}

              <button
                type="button"
                onClick={(e) => handleDropdownAction(e, onArchive)}
                className="flex items-center gap-[8px] w-full px-[10px] py-[6px] font-mohave text-body-sm text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[4px] transition-colors"
              >
                <Archive size={14} className="shrink-0" />
                {t("actions.archive")}
              </button>

              <button
                type="button"
                onClick={(e) => handleDropdownAction(e, onOpenDetail)}
                className="flex items-center gap-[8px] w-full px-[10px] py-[6px] font-mohave text-body-sm text-[#93321A] hover:bg-[rgba(255,255,255,0.06)] rounded-[4px] transition-colors"
              >
                <Trash2 size={14} className="shrink-0" />
                {t("actions.delete")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline note input */}
      {showNoteInput && (
        <input
          ref={noteInputRef}
          type="text"
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          onClick={stop}
          onKeyDown={handleNoteKeyDown}
          placeholder={t("detail.addNotePlaceholder")}
          className="w-full mt-[6px] px-[8px] py-[6px] rounded-[4px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] font-mohave text-body-sm text-text-primary placeholder:text-text-placeholder focus:border-[rgba(255,255,255,0.2)] focus:outline-none"
        />
      )}
    </div>
  );
}
