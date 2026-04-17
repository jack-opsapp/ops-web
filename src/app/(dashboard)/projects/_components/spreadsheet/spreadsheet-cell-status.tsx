"use client";

import { useState, useRef, useEffect } from "react";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { getProjectStatusDisplayName } from "../project-stage-stack";

interface SpreadsheetCellStatusProps {
  status: ProjectStatus;
  canEdit: boolean;
  onCommit: (status: ProjectStatus) => void;
}

const ALL_STATUSES = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
];

export function SpreadsheetCellStatus({ status, canEdit, onCommit }: SpreadsheetCellStatusProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const color = PROJECT_STATUS_COLORS[status];

  return (
    <div className="relative" ref={menuRef}>
      <span
        className={`flex items-center gap-1.5 ${canEdit ? "cursor-pointer" : ""}`}
        onClick={canEdit ? (e) => { e.stopPropagation(); setOpen(!open); } : undefined}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{getProjectStatusDisplayName(status)}</span>
      </span>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-[1000] min-w-[140px] p-1 rounded-[4px]"
          style={{
            background: "var(--surface-glass-dense)",
            backdropFilter: "blur(28px) saturate(1.3)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={(e) => {
                e.stopPropagation();
                if (s !== status) onCommit(s);
                setOpen(false);
              }}
              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-[2px] transition-colors ${
                s === status
                  ? "text-text bg-[rgba(255,255,255,0.08)]"
                  : "text-text-2 hover:bg-[rgba(255,255,255,0.06)]"
              }`}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: PROJECT_STATUS_COLORS[s] }}
              />
              <span className="font-mohave text-body-sm">{getProjectStatusDisplayName(s)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
