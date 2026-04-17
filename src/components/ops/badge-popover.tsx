"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarScheduler } from "@/components/ops/calendar-scheduler";
import { UserAvatar } from "@/components/ops/user-avatar";
import {
  type ProjectTask,
  type User,
  getUserFullName,
} from "@/lib/types/models";

// ─── Mini Calendar Popover ───────────────────────────────────────────────────

export interface MiniCalendarPopoverProps {
  trigger: React.ReactNode;
  task: ProjectTask;
  projectTasks: ProjectTask[];
  teamConflicts: Array<{
    date: Date;
    memberName: string;
    projectTitle: string;
  }>;
  onSave: (startDate: string, endDate: string) => void;
  onEditFullTask: () => void;
}

export function MiniCalendarPopover({
  trigger,
  task,
  projectTasks,
  teamConflicts,
  onSave,
  onEditFullTask,
}: MiniCalendarPopoverProps) {
  const { t } = useDictionary("projects");
  const [open, setOpen] = useState(false);

  function toDateStr(d: Date | null): string {
    if (!d) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function handleDateChange(start: string, end: string) {
    onSave(start, end);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-[320px] p-3"
      >
        <CalendarScheduler
          startDate={toDateStr(task.startDate)}
          endDate={toDateStr(task.endDate)}
          onDateChange={handleDateChange}
          onClear={() => onSave("", "")}
          projectTasks={projectTasks.map((pt) => ({
            id: pt.id,
            startDate: pt.startDate,
            endDate: pt.endDate,
            taskColor: pt.taskColor,
            title: pt.customTitle || pt.taskTypeId,
          }))}
          teamConflicts={teamConflicts}
          alwaysExpanded
        />
        <button
          onClick={() => {
            setOpen(false);
            onEditFullTask();
          }}
          className="font-mohave text-caption-sm text-text-2 hover:text-text hover:underline mt-2 block"
        >
          {t("taskForm.editFullTask")} &rarr;
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Mini Team Picker Popover ────────────────────────────────────────────────

export interface MiniTeamPickerPopoverProps {
  trigger: React.ReactNode;
  selectedIds: string[];
  members: User[];
  onSave: (memberIds: string[]) => void;
  onEditFullTask: () => void;
}

export function MiniTeamPickerPopover({
  trigger,
  selectedIds: initialIds,
  members,
  onSave,
  onEditFullTask,
}: MiniTeamPickerPopoverProps) {
  const { t } = useDictionary("projects");
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(initialIds);

  function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((i) => i !== id)
      : [...selectedIds, id];
    setSelectedIds(next);
    onSave(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-[240px] p-2"
      >
        <div className="max-h-[240px] overflow-y-auto">
          {members.map((member) => {
            const isSelected = selectedIds.includes(member.id);
            return (
              <button
                key={member.id}
                onClick={() => toggle(member.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[2px] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              >
                <UserAvatar
                  name={getUserFullName(member)}
                  imageUrl={member.profileImageURL}
                  size="sm"
                  color={member.userColor ?? undefined}
                />
                <span
                  className={cn(
                    "flex-1 font-mohave text-body-sm text-left",
                    isSelected
                      ? "text-text"
                      : "text-text-2"
                  )}
                >
                  {getUserFullName(member)}
                </span>
                {isSelected && (
                  <Check className="w-[14px] h-[14px] text-text-2 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => {
            setOpen(false);
            onEditFullTask();
          }}
          className="font-mohave text-caption-sm text-text-2 hover:text-text hover:underline mt-2 block"
        >
          {t("taskForm.editFullTask")} &rarr;
        </button>
      </PopoverContent>
    </Popover>
  );
}
