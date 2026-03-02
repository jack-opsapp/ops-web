"use client";

import { Clock, Calendar as CalendarIcon, User } from "lucide-react";
import {
  type InternalCalendarEvent,
  getEventColors,
  formatTime24,
} from "@/lib/utils/calendar-utils";

export function EventTooltipContent({ event }: { event: InternalCalendarEvent }) {
  const colors = getEventColors(event.taskType);
  return (
    <div className="min-w-[200px] space-y-[6px]">
      <div className="flex items-center gap-[6px]">
        <div
          className="w-[8px] h-[8px] rounded-full shrink-0"
          style={{ backgroundColor: colors.border }}
        />
        <span className="font-mohave text-body-sm text-text-primary">
          {event.title}
        </span>
      </div>
      <div className="space-y-[3px] pl-[14px]">
        <div className="flex items-center gap-[4px]">
          <Clock className="w-[11px] h-[11px] text-text-tertiary" />
          <span className="font-mono text-[11px] text-text-secondary">
            {formatTime24(event.startDate)} - {formatTime24(event.endDate)}
          </span>
        </div>
        {event.project && (
          <div className="flex items-center gap-[4px]">
            <CalendarIcon className="w-[11px] h-[11px] text-text-tertiary" />
            <span className="font-mohave text-[12px] text-text-secondary">
              {event.project}
            </span>
          </div>
        )}
        {event.teamMember && (
          <div className="flex items-center gap-[4px]">
            <User className="w-[11px] h-[11px] text-text-tertiary" />
            <span className="font-mohave text-[12px] text-text-secondary">
              {event.teamMember}
            </span>
          </div>
        )}
      </div>
      <div className="pl-[14px]">
        <span
          className="inline-block font-kosugi text-[9px] uppercase tracking-widest px-[6px] py-[2px] rounded-sm"
          style={{
            backgroundColor: colors.bg,
            color: colors.text,
            border: `1px solid ${colors.border}40`,
          }}
        >
          {event.taskType}
        </span>
      </div>
    </div>
  );
}
