"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { StatCard } from "../../_components/stat-card";
import { RequestRow } from "./request-row";
import { RequestDetailDrawer } from "./request-detail-drawer";
import {
  computeQueueStats,
  type DataSetupQueueRow,
  type DataSetupQueueStats,
  type DataSetupRequestStatus,
} from "@/lib/admin/data-setup-queries";

const STATUS_FILTERS: Array<{
  key: "all" | DataSetupRequestStatus;
  label: string;
}> = [
  { key: "all", label: "ALL" },
  { key: "pending", label: "PENDING" },
  { key: "scheduled", label: "SCHEDULED" },
  { key: "in_progress", label: "IN PROGRESS" },
  { key: "completed", label: "COMPLETED" },
  { key: "cancelled", label: "CANCELLED" },
];

interface Props {
  initialRows: DataSetupQueueRow[];
  initialStats: DataSetupQueueStats;
}

export function DataSetupQueue({ initialRows, initialStats }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<DataSetupQueueRow[]>(initialRows);
  const [stats, setStats] = useState<DataSetupQueueStats>(initialStats);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | DataSetupRequestStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return rows.filter((r) => {
      const matchesFilter = filter === "all" || r.status === filter;
      if (!matchesFilter) return false;
      if (!s) return true;
      return (
        r.companyName.toLowerCase().includes(s) ||
        (r.contactEmail ?? "").toLowerCase().includes(s) ||
        (r.requesterEmail ?? "").toLowerCase().includes(s) ||
        (r.requesterName ?? "").toLowerCase().includes(s) ||
        (r.sourceSoftware ?? "").toLowerCase().includes(s)
      );
    });
  }, [rows, filter, search]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId]
  );

  const onRowUpdated = useCallback((updated: DataSetupQueueRow) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === updated.id ? updated : r));
      setStats(computeQueueStats(next));
      return next;
    });
    // Pull fresh server data (companies cascades + completed_at populated by API).
    router.refresh();
  }, [router]);

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Pending"
          value={stats.pending}
          caption={
            stats.pendingSlaBreach > 0
              ? `${stats.pendingSlaBreach} past 24h SLA`
              : "all within 24h SLA"
          }
          danger={stats.pendingSlaBreach > 0}
        />
        <StatCard
          label="Scheduled"
          value={stats.scheduled}
          caption="dates booked"
        />
        <StatCard
          label="In progress"
          value={stats.inProgress}
          caption="migration running"
          accent={stats.inProgress > 0}
        />
        <StatCard
          label="Completed (mo)"
          value={stats.completed}
          caption="this calendar month"
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_FILTERS.map((f) => {
            const isActive = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={
                  "font-cakemono font-light uppercase text-[12px] tracking-wider " +
                  "px-2 py-[5px] rounded-chip border transition-colors duration-150 " +
                  (isActive
                    ? "bg-surface-active text-text border-[rgba(255,255,255,0.18)]"
                    : "border-line text-text-3 hover:text-text-2 hover:border-[rgba(255,255,255,0.18)]")
                }
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, contact, source software..."
          className={
            "font-mohave text-body-sm bg-surface-input " +
            "border border-line rounded-[5px] " +
            "px-2 py-1.5 min-w-[260px] " +
            "text-text placeholder:text-text-3 " +
            "focus:outline-none focus:border-[rgba(255,255,255,0.20)]"
          }
        />
      </div>

      {/* Table */}
      <div className="border border-line rounded-panel overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line bg-white/[0.02]">
              <Th>Company</Th>
              <Th>Status</Th>
              <Th>Purchased</Th>
              <Th>Scheduled</Th>
              <Th>Amount</Th>
              <Th>Source</Th>
              <Th>Contact</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="py-12 text-center font-mono text-micro text-text-mute uppercase tracking-wider"
                >
                  No requests match this filter
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <RequestRow
                  key={r.id}
                  row={r}
                  onClick={() => setSelectedId(r.id)}
                  onUpdated={onRowUpdated}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <RequestDetailDrawer
          row={selected}
          onClose={() => setSelectedId(null)}
          onUpdated={(updated) => {
            onRowUpdated(updated);
            setSelectedId(updated.id);
          }}
        />
      )}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={
        "px-4 py-2 font-mono text-micro uppercase tracking-wider " +
        "text-text-mute font-normal " +
        (align === "right" ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}
