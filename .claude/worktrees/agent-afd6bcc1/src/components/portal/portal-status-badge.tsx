"use client";

import { cn } from "@/lib/utils/cn";

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  // Estimate statuses
  draft: { bg: "rgba(156,163,175,0.15)", text: "#9CA3AF" },
  sent: { bg: "rgba(129,149,181,0.15)", text: "#8195B5" },
  viewed: { bg: "rgba(196,168,104,0.15)", text: "#C4A868" },
  approved: { bg: "rgba(157,181,130,0.15)", text: "#9DB582" },
  changes_requested: { bg: "rgba(181,163,129,0.15)", text: "#B5A381" },
  declined: { bg: "rgba(181,130,137,0.15)", text: "#B58289" },
  expired: { bg: "rgba(107,114,128,0.15)", text: "#6B7280" },
  // Invoice statuses
  awaiting_payment: { bg: "rgba(196,168,104,0.15)", text: "#C4A868" },
  partially_paid: { bg: "rgba(181,163,129,0.15)", text: "#B5A381" },
  past_due: { bg: "rgba(181,130,137,0.15)", text: "#B58289" },
  paid: { bg: "rgba(157,181,130,0.15)", text: "#9DB582" },
  // Project statuses
  RFQ: { bg: "rgba(156,163,175,0.15)", text: "#9CA3AF" },
  Estimated: { bg: "rgba(129,149,181,0.15)", text: "#8195B5" },
  Accepted: { bg: "rgba(196,168,104,0.15)", text: "#C4A868" },
  "In Progress": { bg: "rgba(65,115,148,0.15)", text: "#417394" },
  Completed: { bg: "rgba(157,181,130,0.15)", text: "#9DB582" },
};

const DEFAULT_STYLE = { bg: "rgba(156,163,175,0.15)", text: "#9CA3AF" };

function formatStatusLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface PortalStatusBadgeProps {
  status: string;
  className?: string;
}

export function PortalStatusBadge({ status, className }: PortalStatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? DEFAULT_STYLE;

  return (
    <span
      className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium", className)}
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {formatStatusLabel(status)}
    </span>
  );
}
