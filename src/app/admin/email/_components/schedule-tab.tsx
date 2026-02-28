"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EmailScheduleDay, EmailDayDetail } from "@/lib/admin/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const SEGMENT_COLORS: Record<string, string> = {
  lifecycle: "#597794",
  bubble: "#C4A868",
  unverified: "#9DB582",
  newsletter: "#93321A",
};

const SEGMENT_LABELS: Record<string, string> = {
  lifecycle: "Lifecycle",
  bubble: "Bubble",
  unverified: "Unverified",
  newsletter: "Newsletter",
};

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAILY_SEGMENTS = ["lifecycle", "unverified"]; // run every day
// Bubble reauth runs every Friday
// Newsletter runs 2nd Friday of each month

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startOffset = firstDay.getDay(); // 0=Sun
  const totalDays = lastDay.getDate();
  return { startOffset, totalDays };
}

function formatMonthYear(year: number, month: number): string {
  return new Date(year, month - 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** Get the date of the 2nd Friday of a month */
function getSecondFriday(year: number, month: number): number {
  const first = new Date(year, month - 1, 1);
  const firstFridayOffset = (5 - first.getDay() + 7) % 7;
  return firstFridayOffset + 1 + 7; // +7 for 2nd Friday, +1 because dates are 1-indexed
}

function isToday(year: number, month: number, day: number): boolean {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() + 1 === month && now.getDate() === day;
}

function isFuture(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today;
}

function dateToKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ScheduleTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [scheduleData, setScheduleData] = useState<EmailScheduleDay[]>([]);
  const [loading, setLoading] = useState(false);

  // Day detail popup
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayEmails, setDayEmails] = useState<EmailDayDetail[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/email/schedule?month=${month}&year=${year}`);
      if (res.ok) {
        const data = await res.json();
        setScheduleData(data.days ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  function prevMonth() {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  }

  function nextMonth() {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  }

  async function openDayDetail(date: string) {
    setSelectedDate(date);
    setDayLoading(true);
    try {
      const res = await fetch(`/api/admin/email/schedule?date=${date}`);
      if (res.ok) {
        const data = await res.json();
        setDayEmails(data.emails ?? []);
      }
    } catch {
      setDayEmails([]);
    } finally {
      setDayLoading(false);
    }
  }

  // Build lookup from schedule data
  const dataByDate: Record<string, EmailScheduleDay> = {};
  for (const d of scheduleData) {
    dataByDate[d.date] = d;
  }

  const { startOffset, totalDays } = getMonthDays(year, month);
  const secondFriday = getSecondFriday(year, month);

  // Build calendar cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="space-y-4">
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="p-1.5 rounded hover:bg-white/[0.04] transition-colors text-[#6B6B6B] hover:text-[#E5E5E5]"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h2 className="font-mohave text-[16px] uppercase tracking-wider text-[#E5E5E5]">
          {formatMonthYear(year, month)}
        </h2>
        <button
          onClick={nextMonth}
          className="p-1.5 rounded hover:bg-white/[0.04] transition-colors text-[#6B6B6B] hover:text-[#E5E5E5]"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {Object.entries(SEGMENT_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: SEGMENT_COLORS[key] }}
            />
            <span className="font-kosugi text-[10px] text-[#6B6B6B]">{label}</span>
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-white/[0.08]">
          {DAY_HEADERS.map((d) => (
            <div
              key={d}
              className="py-2 text-center font-mohave text-[10px] uppercase tracking-wider text-[#6B6B6B]"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} className="min-h-[72px] border-b border-r border-white/[0.04]" />;
            }

            const key = dateToKey(year, month, day);
            const data = dataByDate[key];
            const future = isFuture(year, month, day);
            const today = isToday(year, month, day);

            // For future days, show projected schedule
            const segments = future
              ? getFutureSegments(year, month, day, secondFriday)
              : data?.counts ?? {};

            const hasData = Object.keys(segments).length > 0;

            return (
              <div
                key={key}
                className={`min-h-[72px] border-b border-r border-white/[0.04] p-1.5 transition-colors ${
                  hasData && !future ? "cursor-pointer hover:bg-white/[0.04]" : ""
                } ${today ? "ring-1 ring-inset ring-[#597794]/50 bg-[#597794]/5" : ""}`}
                onClick={() => {
                  if (hasData && !future) openDayDetail(key);
                }}
              >
                <span className={`font-mohave text-[12px] ${today ? "text-[#597794]" : "text-[#A0A0A0]"}`}>
                  {day}
                </span>
                {Object.keys(segments).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(segments).map(([segment, count]) => (
                      <span
                        key={segment}
                        className={`inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded-full font-kosugi text-[9px] text-white ${
                          future ? "opacity-30" : ""
                        }`}
                        style={{ backgroundColor: SEGMENT_COLORS[segment] ?? "#6B6B6B" }}
                        title={`${SEGMENT_LABELS[segment] ?? segment}: ${count}`}
                      >
                        {future ? "" : count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="w-4 h-4 border-2 border-[#597794] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Day Detail Dialog */}
      <Dialog open={!!selectedDate} onOpenChange={(open) => { if (!open) setSelectedDate(null); }}>
        <DialogContent className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle>
              Emails — {selectedDate ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              }) : ""}
            </DialogTitle>
          </DialogHeader>

          {dayLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[#597794] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : dayEmails.length === 0 ? (
            <p className="font-kosugi text-[12px] text-[#6B6B6B] text-center py-6">
              No emails sent on this day
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              {/* Group by type */}
              {groupByType(dayEmails).map(([type, emails]) => (
                <div key={type} className="mb-4 last:mb-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getSegmentColor(type) }}
                    />
                    <span className="font-mohave text-[12px] uppercase tracking-wider text-[#A0A0A0]">
                      {type}
                    </span>
                    <span className="font-kosugi text-[10px] text-[#6B6B6B]">
                      ({emails.length})
                    </span>
                  </div>
                  <div className="border border-white/[0.08] rounded-lg overflow-hidden">
                    {emails.map((email, i) => (
                      <div
                        key={`${email.recipient_email}-${email.sent_at}-${i}`}
                        className="flex items-center gap-3 px-3 py-2 border-b border-white/[0.05] last:border-0"
                      >
                        <span className="font-kosugi text-[11px] text-[#A0A0A0] w-40 truncate flex-shrink-0">
                          {email.recipient_email}
                        </span>
                        <span className="font-kosugi text-[11px] text-[#6B6B6B] flex-1 truncate">
                          {email.subject}
                        </span>
                        <span className={`font-mohave text-[10px] uppercase flex-shrink-0 ${
                          email.status === "sent" || email.status === "delivered"
                            ? "text-[#9DB582]"
                            : "text-[#93321A]"
                        }`}>
                          {email.status}
                        </span>
                        <span className="font-kosugi text-[10px] text-[#6B6B6B] flex-shrink-0 w-16 text-right">
                          {new Date(email.sent_at).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFutureSegments(year: number, month: number, day: number, secondFriday: number): Record<string, number> {
  const segments: Record<string, number> = {};
  const dayOfWeek = new Date(year, month - 1, day).getDay(); // 0=Sun, 5=Fri
  const isFriday = dayOfWeek === 5;

  // Daily triggers run every day
  for (const s of DAILY_SEGMENTS) {
    segments[s] = 0; // 0 = scheduled but no count yet
  }
  // Bubble reauth runs every Friday
  if (isFriday) {
    segments.bubble = 0;
  }
  // Newsletter only on 2nd Friday
  if (day === secondFriday) {
    segments.newsletter = 0;
  }
  return segments;
}

function groupByType(emails: EmailDayDetail[]): [string, EmailDayDetail[]][] {
  const groups: Record<string, EmailDayDetail[]> = {};
  for (const e of emails) {
    const type = e.email_type;
    if (!groups[type]) groups[type] = [];
    groups[type].push(e);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

function getSegmentColor(emailType: string): string {
  if (emailType.startsWith("lifecycle")) return SEGMENT_COLORS.lifecycle;
  if (emailType.startsWith("bubble")) return SEGMENT_COLORS.bubble;
  if (emailType.startsWith("unverified")) return SEGMENT_COLORS.unverified;
  if (emailType.startsWith("newsletter")) return SEGMENT_COLORS.newsletter;
  return "#6B6B6B";
}
