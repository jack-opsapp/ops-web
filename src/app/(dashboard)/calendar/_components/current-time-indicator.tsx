"use client";

import { useState, useEffect } from "react";
import { getHours } from "date-fns";
import { getCurrentTimeOffset, isWithinVisibleHours } from "@/lib/utils/calendar-utils";

export function CurrentTimeIndicator() {
  const [offset, setOffset] = useState(getCurrentTimeOffset());

  useEffect(() => {
    const interval = setInterval(() => {
      setOffset(getCurrentTimeOffset());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  if (!isWithinVisibleHours(now)) return null;

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top: `${offset}px` }}
    >
      <div className="relative flex items-center">
        <div className="w-[8px] h-[8px] rounded-full bg-red-500 -ml-[4px] shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
        <div className="flex-1 h-[1.5px] bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]" />
      </div>
    </div>
  );
}
