"use client";

import { cn } from "@/lib/utils/cn";

// ─── Status -> color mapping ─────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  // Estimate statuses
  draft: { bg: "rgba(156,163,175,0.15)", text: "#9CA3AF", border: "rgba(156,163,175,0.3)" },
  sent: { bg: "rgba(129,149,181,0.15)", text: "#D99A3E", border: "rgba(129,149,181,0.3)" },
  viewed: { bg: "rgba(196,168,104,0.15)", text: "#C4A868", border: "rgba(196,168,104,0.3)" },
  approved: { bg: "rgba(157,181,130,0.15)", text: "#9DB582", border: "rgba(157,181,130,0.3)" },
  changes_requested: { bg: "rgba(181,163,129,0.15)", text: "#B6AC97", border: "rgba(181,163,129,0.3)" },
  declined: { bg: "rgba(181,130,137,0.15)", text: "#B58289", border: "rgba(181,130,137,0.3)" },
  expired: { bg: "rgba(107,114,128,0.15)", text: "#6B7280", border: "rgba(107,114,128,0.3)" },
  // Invoice statuses
  awaiting_payment: { bg: "rgba(196,168,104,0.15)", text: "#C4A868", border: "rgba(196,168,104,0.3)" },
  partially_paid: { bg: "rgba(181,163,129,0.15)", text: "#B6AC97", border: "rgba(181,163,129,0.3)" },
  past_due: { bg: "rgba(181,130,137,0.15)", text: "#B58289", border: "rgba(181,130,137,0.3)" },
  paid: { bg: "rgba(157,181,130,0.15)", text: "#9DB582", border: "rgba(157,181,130,0.3)" },
  // Project statuses
  RFQ: { bg: "rgba(156,163,175,0.15)", text: "#9CA3AF", border: "rgba(156,163,175,0.3)" },
  Estimated: { bg: "rgba(129,149,181,0.15)", text: "#D99A3E", border: "rgba(129,149,181,0.3)" },
  Accepted: { bg: "rgba(196,168,104,0.15)", text: "#C4A868", border: "rgba(196,168,104,0.3)" },
  "In Progress": { bg: "rgba(65,115,148,0.15)", text: "#417394", border: "rgba(65,115,148,0.3)" },
  Completed: { bg: "rgba(157,181,130,0.15)", text: "#9DB582", border: "rgba(157,181,130,0.3)" },
};

const DEFAULT_COLORS = { bg: "rgba(156,163,175,0.15)", text: "#9CA3AF", border: "rgba(156,163,175,0.3)" };

function formatStatusLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusStyle = "pill-rounded" | "pill-bordered" | "text-bold";

interface PortalStatusBadgeProps {
  status: string;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Portal status badge that reads `--portal-status-style` CSS var to determine rendering:
 * - `pill-rounded`: rounded-full background with text (default)
 * - `pill-bordered`: rounded-full border with text, no background fill
 * - `text-bold`: no pill, just bold colored text
 */
export function PortalStatusBadge({ status, className }: PortalStatusBadgeProps) {
  const colors = STATUS_COLORS[status] ?? DEFAULT_COLORS;

  return (
    <span
      className={cn("portal-status-badge inline-flex items-center text-xs font-medium", className)}
      data-status={status}
      style={
        {
          // Default pill-rounded styles (CSS var overrides applied via separate style blocks)
          "--_badge-bg": colors.bg,
          "--_badge-text": colors.text,
          "--_badge-border": colors.border,
        } as React.CSSProperties
      }
    >
      {/* Render all three variants; CSS custom property controls which is visible */}
      {/* We use a single render with dynamic inline styles based on the var */}
      <BadgeInner status={status} colors={colors} />
    </span>
  );
}

/**
 * Inner component that reads the CSS variable at render time.
 * Since CSS custom properties can't be read synchronously in React,
 * we use a technique: render all three and let a parent CSS rule toggle visibility.
 *
 * However, for simplicity and since the portal shell sets the var on the root,
 * we read it once from the computed style on mount.
 */
function BadgeInner({
  status,
  colors,
}: {
  status: string;
  colors: { bg: string; text: string; border: string };
}) {
  // Read --portal-status-style from the document root (set by portal shell)
  // Default to "pill-rounded" if not set
  const styleVariant = useStatusStyle();

  const label = formatStatusLabel(status);

  if (styleVariant === "text-bold") {
    return (
      <span
        className="font-bold text-xs"
        style={{ color: colors.text }}
      >
        {label}
      </span>
    );
  }

  if (styleVariant === "pill-bordered") {
    return (
      <span
        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
        style={{
          color: colors.text,
          backgroundColor: "transparent",
          border: `1px solid ${colors.border}`,
        }}
      >
        {label}
      </span>
    );
  }

  // Default: pill-rounded
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
      }}
    >
      {label}
    </span>
  );
}

// ─── Hook to read status style CSS var ───────────────────────────────────────

import { useState, useEffect } from "react";

function useStatusStyle(): StatusStyle {
  const [style, setStyle] = useState<StatusStyle>("pill-rounded");

  useEffect(() => {
    if (typeof document === "undefined") return;

    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue("--portal-status-style")
      .trim();

    if (computed === "pill-bordered" || computed === "text-bold" || computed === "pill-rounded") {
      setStyle(computed);
    }
  }, []);

  return style;
}
