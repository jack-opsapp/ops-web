"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { getProjectStatusDisplayName } from "../project-stage-stack";

interface SpreadsheetBulkBarProps {
  selectedCount: number;
  canManage: boolean;
  canDelete: boolean;
  onChangeStatus: (status: ProjectStatus) => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}

const BULK_STATUSES = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
];

export function SpreadsheetBulkBar({
  selectedCount,
  canManage,
  canDelete,
  onChangeStatus,
  onArchive,
  onDelete,
  onClear,
}: SpreadsheetBulkBarProps) {
  const { t } = useDictionary("projects-canvas");
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-[4px] border border-border-subtle"
      style={{
        background: "var(--surface-glass)",
        backdropFilter: "blur(28px) saturate(1.3)",
      }}
    >
      <span className="font-mono text-data-sm text-ops-accent">
        {t("spreadsheet.bulk.selected").replace("{count}", String(selectedCount))}
      </span>

      {canManage && (
        <>
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              className="px-2 py-1 rounded-sm font-kosugi text-micro uppercase tracking-wider text-text-2 hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors"
            >
              {t("spreadsheet.bulk.changeStatus")}
            </button>
            {showStatusMenu && (
              <div
                className="absolute top-full left-0 mt-1 z-[1000] min-w-[140px] p-1 rounded-[4px]"
                style={{
                  background: "var(--surface-glass-dense)",
                  backdropFilter: "blur(28px) saturate(1.3)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                {BULK_STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => { onChangeStatus(s); setShowStatusMenu(false); }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-[2px] text-text-2 hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PROJECT_STATUS_COLORS[s] }} />
                    <span className="font-mohave text-body-sm">{getProjectStatusDisplayName(s)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={onArchive}
            className="px-2 py-1 rounded-sm font-kosugi text-micro uppercase tracking-wider text-text-2 hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            {t("spreadsheet.bulk.archive")}
          </button>
        </>
      )}

      {canDelete && (
        <button
          onClick={onDelete}
          className="px-2 py-1 rounded-sm font-kosugi text-micro uppercase tracking-wider text-[#93321A] hover:text-[#b5423a] hover:bg-[rgba(147,50,26,0.1)] transition-colors"
        >
          {t("spreadsheet.bulk.delete")}
        </button>
      )}

      <button
        onClick={onClear}
        className="ml-auto flex items-center gap-1 px-2 py-1 rounded-sm text-text-3 hover:text-text transition-colors"
      >
        <X className="w-3 h-3" />
        <span className="font-kosugi text-micro uppercase tracking-wider">{t("spreadsheet.bulk.clear")}</span>
      </button>
    </div>
  );
}
