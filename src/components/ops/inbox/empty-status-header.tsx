"use client";

/**
 * OPS Web — Inbox Empty-Status Header
 *
 * Tactical header at the top of the empty-status-view. Contains the
 * section identity (// INBOX STATUS), current date/time line, and
 * right-aligned aggregate unread count. Clock re-renders once per
 * minute (at the rollover, not on a 60s tick from mount).
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

const DAY_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function formatTactical(now: Date): string {
  const day = DAY_SHORT[now.getDay()];
  const month = MONTH_SHORT[now.getMonth()];
  const date = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${day} · ${month} ${date} · ${hh}:${mm}`;
}

export interface EmptyStatusHeaderProps {
  unreadCount: number;
}

export function EmptyStatusHeader({ unreadCount }: EmptyStatusHeaderProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      const msUntilNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
      timeout = setTimeout(tick, msUntilNextMinute);
    };
    const d = new Date();
    const msUntilNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
    timeout = setTimeout(tick, msUntilNextMinute);
    return () => clearTimeout(timeout);
  }, []);

  const unreadText = unreadCount === 0 ? "— UNREAD" : `${unreadCount} UNREAD`;

  return (
    <header className="px-3 py-3 border-b border-[rgba(255,255,255,0.10)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        <span className="text-text-mute">// </span>INBOX STATUS
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 tabular-nums",
            "[font-feature-settings:'tnum'_1,'zero'_1]"
          )}
        >
          {formatTactical(now)}
        </span>
        <span
          className={cn(
            "font-mono text-[13px] tabular-nums",
            unreadCount === 0 ? "text-text-3" : "text-text",
            "[font-feature-settings:'tnum'_1,'zero'_1]"
          )}
        >
          {unreadText}
        </span>
      </div>
    </header>
  );
}
