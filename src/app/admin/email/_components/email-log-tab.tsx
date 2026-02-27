"use client";

import { useState, useMemo } from "react";
import { SortableTableHeader, useSortState } from "../../_components/sortable-table-header";
import type { EmailLogRow } from "@/lib/admin/types";

interface EmailLogTabProps {
  entries: EmailLogRow[];
}

type SegmentFilter = "ALL" | "BUBBLE" | "UNVERIFIED" | "AUTH" | "NEWSLETTER";
type StatusFilter = "ALL" | "SENT" | "FAILED" | "DELIVERED" | "BOUNCED";

function deriveSegment(emailType: string): SegmentFilter {
  if (emailType.startsWith("bubble")) return "BUBBLE";
  if (emailType.startsWith("unverified")) return "UNVERIFIED";
  if (emailType.startsWith("newsletter")) return "NEWSLETTER";
  return "AUTH";
}

const STATUS_COLORS: Record<string, string> = {
  sent: "text-[#9DB582]",
  delivered: "text-[#597794]",
  failed: "text-[#93321A]",
  bounced: "text-[#C4A868]",
};

const COLUMNS = [
  { key: "recipient_email", label: "Recipient", sortable: true },
  { key: "email_type", label: "Type", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "sent_at", label: "Sent At", sortable: true },
];

export function EmailLogTab({ entries }: EmailLogTabProps) {
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sort = useSortState("sent_at");

  const filtered = useMemo(() => {
    let result = entries;
    if (segmentFilter !== "ALL") {
      result = result.filter((e) => deriveSegment(e.email_type) === segmentFilter);
    }
    if (statusFilter !== "ALL") {
      result = result.filter((e) => e.status.toUpperCase() === statusFilter);
    }
    return result;
  }, [entries, segmentFilter, statusFilter]);

  const sorted = sort.sorted(filtered);

  const segmentFilters: SegmentFilter[] = ["ALL", "BUBBLE", "UNVERIFIED", "AUTH", "NEWSLETTER"];
  const statusFilters: StatusFilter[] = ["ALL", "SENT", "FAILED", "DELIVERED", "BOUNCED"];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {segmentFilters.map((f) => (
            <button
              key={f}
              onClick={() => setSegmentFilter(f)}
              className={[
                "px-3 py-1.5 rounded-full font-mohave text-[12px] uppercase border transition-colors",
                segmentFilter === f
                  ? "text-[#E5E5E5] border-white/[0.12] bg-white/[0.05]"
                  : "text-[#6B6B6B] border-white/[0.05] hover:text-[#A0A0A0]",
              ].join(" ")}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="w-px h-5 bg-white/[0.08]" />
        <div className="flex gap-1">
          {statusFilters.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={[
                "px-3 py-1.5 rounded-full font-mohave text-[12px] uppercase border transition-colors",
                statusFilter === f
                  ? "text-[#E5E5E5] border-white/[0.12] bg-white/[0.05]"
                  : "text-[#6B6B6B] border-white/[0.05] hover:text-[#A0A0A0]",
              ].join(" ")}
            >
              {f}
            </button>
          ))}
        </div>
        {(segmentFilter !== "ALL" || statusFilter !== "ALL") && (
          <span className="font-kosugi text-[11px] text-[#6B6B6B]">
            [{sorted.length} of {entries.length}]
          </span>
        )}
      </div>

      {/* Table */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <SortableTableHeader
          columns={COLUMNS}
          sort={sort.sort}
          onSort={sort.toggle}
        />
        {sorted.map((entry) => (
          <div key={entry.id}>
            <div
              className="grid grid-cols-4 px-6 items-center h-14 border-b border-white/[0.05] cursor-pointer hover:bg-white/[0.02] transition-colors"
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            >
              <span className="font-kosugi text-[13px] text-[#E5E5E5] truncate">
                {entry.recipient_email}
              </span>
              <span className="font-mohave text-[13px] text-[#A0A0A0] uppercase">
                {entry.email_type}
              </span>
              <span className={`font-mohave text-[13px] uppercase ${STATUS_COLORS[entry.status] ?? "text-[#A0A0A0]"}`}>
                {entry.status}
              </span>
              <span className="font-kosugi text-[12px] text-[#6B6B6B]">
                [{new Date(entry.sent_at).toLocaleString()}]
              </span>
            </div>
            {expandedId === entry.id && (
              <div className="px-6 py-4 bg-white/[0.02] border-b border-white/[0.05]">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="font-mohave text-[11px] uppercase text-[#6B6B6B] mb-2">Subject</p>
                    <p className="text-[13px] text-[#A0A0A0] font-kosugi">{entry.subject}</p>
                    {entry.error_message && (
                      <>
                        <p className="font-mohave text-[11px] uppercase text-[#6B6B6B] mb-2 mt-3">Error</p>
                        <p className="text-[12px] text-[#93321A] font-kosugi">{entry.error_message}</p>
                      </>
                    )}
                  </div>
                  <div>
                    <p className="font-mohave text-[11px] uppercase text-[#6B6B6B] mb-2">Metadata</p>
                    <pre className="text-[12px] text-[#A0A0A0] bg-black/50 rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap font-mono">
                      {entry.metadata ? JSON.stringify(entry.metadata, null, 2) : "(none)"}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {sorted.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">
              No email log entries
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
