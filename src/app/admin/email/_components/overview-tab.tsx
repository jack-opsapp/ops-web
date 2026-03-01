"use client";

import { useState } from "react";
import { StatCard } from "../../_components/stat-card";
import { AdminBarChart } from "../../_components/charts/bar-chart";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  EmailOverviewStats,
  EmailEngagementStats,
  EmailDayDetail,
} from "@/lib/admin/types";

interface OverviewTabProps {
  stats: EmailOverviewStats;
  engagement: EmailEngagementStats;
}

const SEGMENT_COLORS: Record<string, string> = {
  lifecycle: "#597794",
  bubble: "#C4A868",
  unverified: "#9DB582",
  newsletter: "#93321A",
};

export function OverviewTab({ stats, engagement }: OverviewTabProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayEmails, setDayEmails] = useState<EmailDayDetail[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  const hasEngagement =
    engagement.totalDelivered > 0 ||
    engagement.uniqueOpens > 0 ||
    engagement.uniqueClicks > 0;

  async function openDayDetail(dateLabel: string) {
    // dailyVolume labels are formatted dates — parse to YYYY-MM-DD
    const parsed = new Date(dateLabel);
    if (isNaN(parsed.getTime())) return;
    const dateKey = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;

    setSelectedDate(dateKey);
    setDayLoading(true);
    try {
      const res = await fetch(`/api/admin/email/schedule?date=${dateKey}`);
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

  return (
    <div className="space-y-4">
      {/* Primary KPIs — single compact row */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="Total Sent" value={stats.totalSent.toLocaleString()} />
        <StatCard label="Delivered" value={stats.totalDelivered.toLocaleString()} accent />
        <StatCard label="Delivery Rate" value={`${stats.deliveryRate}%`} accent />
        <StatCard
          label="Failed"
          value={stats.totalFailed.toLocaleString()}
          danger={stats.totalFailed > 0}
          href="/admin/email"
        />
        {hasEngagement ? (
          <StatCard label="Open Rate" value={`${engagement.openRate}%`} accent />
        ) : (
          <StatCard label="Open Rate" value="—" caption="awaiting webhook" />
        )}
      </div>

      {/* Secondary engagement strip — compact inline row */}
      {hasEngagement && (
        <div className="flex items-center gap-6 px-4 py-2.5 border border-white/[0.08] rounded-lg bg-white/[0.02]">
          <Metric label="Opens" value={engagement.uniqueOpens} />
          <Metric label="Clicks" value={engagement.uniqueClicks} />
          <Metric label="Click Rate" value={`${engagement.clickRate}%`} accent />
          <Metric label="Bounces" value={engagement.totalBounces} danger={engagement.totalBounces > 0} />
          <Metric label="Spam" value={engagement.spamReports} danger={engagement.spamReports > 0} />
        </div>
      )}

      {/* Interactive daily volume chart */}
      <div className="border border-white/[0.08] rounded-lg p-5 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-3">
          Daily Send Volume (Last 30 Days)
          <span className="text-[11px] ml-2 normal-case tracking-normal text-[#597794]">
            click a bar for details
          </span>
        </p>
        {stats.dailyVolume.length > 0 ? (
          <AdminBarChart
            data={stats.dailyVolume}
            color="#597794"
            height={220}
            onBarClick={(point) => openDayDetail(point.label)}
          />
        ) : (
          <div className="flex items-center justify-center h-[220px]">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">
              No email data yet
            </p>
          </div>
        )}
      </div>

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

// ─── Compact Inline Metric ──────────────────────────────────────────────────

function Metric({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  danger?: boolean;
}) {
  const color = danger
    ? "text-[#93321A]"
    : accent
    ? "text-[#C4A868]"
    : "text-[#E5E5E5]";

  return (
    <div className="flex items-center gap-2">
      <span className="font-mohave text-[11px] uppercase tracking-wider text-[#6B6B6B]">
        {label}
      </span>
      <span className={`font-mohave text-[16px] font-semibold ${color}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
