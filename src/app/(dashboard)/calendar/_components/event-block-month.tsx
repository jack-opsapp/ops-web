"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type InternalCalendarEvent,
  getEventColors,
  formatTime24,
} from "@/lib/utils/calendar-utils";
import { EventTooltipContent } from "./event-tooltip";

interface EventBlockMonthProps {
  event: InternalCalendarEvent;
  onClick?: (event: InternalCalendarEvent) => void;
}

export function EventBlockMonth({ event, onClick }: EventBlockMonthProps) {
  const colors = getEventColors(event.taskType);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="px-[6px] py-[3px] rounded-sm text-[11px] font-mohave truncate cursor-pointer transition-all duration-100 hover:brightness-125"
            style={{
              backgroundColor: colors.bg,
              borderLeft: `2px solid ${colors.border}`,
              color: colors.text,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onClick?.(event);
            }}
          >
            <span className="font-mono text-[9px] opacity-70 mr-[4px]">
              {formatTime24(event.startDate)}
            </span>
            {event.title}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" align="start">
          <EventTooltipContent event={event} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
