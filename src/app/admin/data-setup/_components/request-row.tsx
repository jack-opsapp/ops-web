"use client";

import { useState } from "react";
import { Calendar, Play, Check, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type {
  DataSetupQueueRow,
  DataSetupRequestStatus,
} from "@/lib/admin/data-setup-queries";
import { patchAndMerge } from "../actions";
import { StatusPill } from "./status-pill";

interface Props {
  row: DataSetupQueueRow;
  onClick: () => void;
  onUpdated: (next: DataSetupQueueRow) => void;
}

function formatAmount(cents: number | null): string {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(0)}`;
  }
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatScheduled(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RequestRow({ row, onClick, onUpdated }: Props) {
  const [busy, setBusy] = useState<DataSetupRequestStatus | null>(null);

  async function transition(
    nextStatus: DataSetupRequestStatus,
    extras: Record<string, unknown> = {}
  ) {
    setBusy(nextStatus);
    try {
      const updated = await patchAndMerge(row, {
        status: nextStatus,
        ...extras,
      });
      onUpdated(updated);
      toast.success(`${row.companyName} → ${nextStatus.replace("_", " ")}`);
    } catch (err) {
      toast.error("Couldn't update request", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  // Status-aware quick actions
  const showSchedule = row.status === "pending";
  const showStart =
    row.status === "scheduled" || row.status === "pending";
  const showComplete = row.status === "in_progress";

  return (
    <tr
      className="border-b border-line last:border-0 hover:bg-white/[0.03] cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="px-4 py-3">
        <div className="font-mohave text-body-sm text-text">
          {row.companyName}
        </div>
        {row.requesterName && (
          <div className="font-mono text-micro text-text-mute mt-0.5">
            {row.requesterName}
            {row.requesterEmail ? ` · ${row.requesterEmail}` : ""}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusPill status={row.status} />
      </td>
      <td className="px-4 py-3">
        <div className="font-mono text-data-sm text-text tabular-nums">
          {formatRelative(row.createdAt)}
        </div>
        <div className="font-mono text-micro text-text-mute mt-0.5">
          {new Date(row.createdAt).toLocaleDateString()}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="font-mono text-data-sm text-text tabular-nums">
          {formatScheduled(row.scheduledAt)}
        </div>
      </td>
      <td className="px-4 py-3">
        <div
          className="font-mono text-data-sm text-text tabular-nums"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {formatAmount(row.amountPaidCents)}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="font-mono text-micro text-text-2">
          {row.sourceSoftware ?? <span className="text-text-mute">—</span>}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="font-mono text-micro text-text-2">
          {row.contactEmail ?? row.companyEmail ?? "—"}
        </div>
        {(row.contactPhone ?? row.companyPhone) && (
          <div className="font-mono text-micro text-text-mute mt-0.5">
            {row.contactPhone ?? row.companyPhone}
          </div>
        )}
      </td>
      <td
        className="px-4 py-3 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inline-flex items-center gap-1">
          {showSchedule && (
            <QuickAction
              icon={<Calendar className="w-[12px] h-[12px]" />}
              label="Schedule"
              busy={busy === "scheduled"}
              onClick={() => onClick()}
            />
          )}
          {showStart && (
            <QuickAction
              icon={<Play className="w-[12px] h-[12px]" />}
              label="Start"
              busy={busy === "in_progress"}
              onClick={() => transition("in_progress")}
            />
          )}
          {showComplete && (
            <QuickAction
              icon={<Check className="w-[12px] h-[12px]" />}
              label="Complete"
              busy={busy === "completed"}
              onClick={() => transition("completed")}
            />
          )}
          <button
            type="button"
            onClick={onClick}
            className="p-1 rounded hover:bg-white/[0.06] text-text-3 hover:text-text-2 transition-colors"
            aria-label="Open detail"
          >
            <ArrowRight className="w-[14px] h-[14px]" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function QuickAction({
  icon,
  label,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        "inline-flex items-center gap-1 px-1.5 py-[5px] rounded-chip " +
        "font-cakemono font-light uppercase text-[10px] tracking-wider " +
        "border border-line text-text-2 " +
        "hover:text-text hover:border-[rgba(255,255,255,0.18)] hover:bg-white/[0.04] " +
        "disabled:opacity-50 transition-colors"
      }
    >
      {busy ? (
        <Loader2 className="w-[12px] h-[12px] animate-spin" />
      ) : (
        icon
      )}
      {label}
    </button>
  );
}
